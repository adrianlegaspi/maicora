import type { ChatProvider, ChatRequest, ProviderEvent, ToolCall } from "./types.js";

export interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
}

/**
 * Any OpenAI-compatible chat completions endpoint: OpenAI, Groq, OpenRouter,
 * a local vLLM or Ollama. Non-negotiable #3 forbids a provider-specific
 * architecture, and the wire format is the one thing they all agree on, so
 * this is a fetch call rather than a vendor SDK.
 */
export class OpenAICompatibleProvider implements ChatProvider {
  readonly name: string;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.name = `openai-compatible:${options.model}`;
  }

  async *chat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: this.options.temperature ?? 0,
        stream: true,
        messages: request.messages.map(toWireMessage),
        tools: request.tools.length
          ? request.tools.map((tool) => ({
              type: "function",
              function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
            }))
          : undefined,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`AI provider returned ${response.status}: ${await response.text()}`);
    }

    // Tool calls arrive as deltas keyed by index, so they are assembled here
    // and only emitted once the turn ends.
    const pending = new Map<number, ToolCall>();
    let finishReason: "stop" | "tool_calls" | "length" = "stop";

    for await (const data of sseData(response.body)) {
      if (data === "[DONE]") break;
      const chunk = JSON.parse(data) as WireChunk;
      const choice = chunk.choices?.[0];
      if (!choice) continue;

      if (choice.delta?.content) yield { type: "text", delta: choice.delta.content };

      for (const delta of choice.delta?.tool_calls ?? []) {
        const call = pending.get(delta.index) ?? { id: "", name: "", arguments: "" };
        if (delta.id) call.id = delta.id;
        if (delta.function?.name) call.name += delta.function.name;
        if (delta.function?.arguments) call.arguments += delta.function.arguments;
        pending.set(delta.index, call);
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    for (const call of pending.values()) yield { type: "tool_call", call };
    yield { type: "done", finishReason: pending.size ? "tool_calls" : finishReason };
  }
}

interface WireChunk {
  choices?: {
    delta?: {
      content?: string;
      tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: "stop" | "tool_calls" | "length";
  }[];
}

function toWireMessage(message: ChatRequest["messages"][number]) {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content ?? "" };
  }
  return {
    role: message.role,
    content: message.content ?? "",
    tool_calls: message.toolCalls?.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    })),
  };
}

/** Yields the payload of each `data:` line of a text/event-stream body. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
      newline = buffer.indexOf("\n");
    }
  }
}
