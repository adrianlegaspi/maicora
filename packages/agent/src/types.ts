import type { ToolDefinition } from "@maicora/capabilities";

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string as the model emitted it; parsed at the capability boundary. */
  arguments: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  toolCalls?: ToolCall[];
  /** Set on tool messages: which call this answers. */
  toolCallId?: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools: ToolDefinition[];
}

/** What a provider streams back. Deliberately provider-neutral (non-negotiable #3). */
export type ProviderEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "done"; finishReason: "stop" | "tool_calls" | "length" };

export interface ChatProvider {
  readonly name: string;
  chat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ProviderEvent>;
}

/** What the API streams to the browser. */
export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; name: string; input: unknown }
  | { type: "tool_result"; name: string; ok: true; output: unknown }
  | { type: "tool_error"; name: string; ok: false; error: string }
  | { type: "done"; conversationId: string };
