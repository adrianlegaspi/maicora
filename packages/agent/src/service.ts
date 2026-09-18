import { and, asc, eq } from "drizzle-orm";
import { schema, type Database } from "@maicora/database";
import { CapabilityRegistry } from "@maicora/capabilities";
import { MemoryService } from "@maicora/memory";
import { newId, NotFoundError, type ActorContext } from "@maicora/shared";
import { systemPrompt } from "./prompt.js";
import type { AgentEvent, ChatMessage, ChatProvider, ToolCall } from "./types.js";

export interface SendInput {
  conversationId?: string;
  message: string;
}

export interface AgentServiceOptions {
  /**
   * How many provider round trips one user message may cost. A model that
   * loops on tool calls burns money silently, so the loop is bounded rather
   * than trusted to stop.
   */
  maxSteps?: number;
}

export class AgentService {
  private readonly memory: MemoryService;

  constructor(
    private readonly db: Database,
    private readonly registry: CapabilityRegistry,
    private readonly provider: ChatProvider,
    private readonly options: AgentServiceOptions = {},
  ) {
    this.memory = new MemoryService(db);
  }

  async listConversations(actor: ActorContext) {
    return this.db
      .select()
      .from(schema.agentConversations)
      .where(
        and(
          eq(schema.agentConversations.tenantId, actor.tenantId),
          eq(schema.agentConversations.userId, actor.userId),
        ),
      )
      .orderBy(asc(schema.agentConversations.updatedAt));
  }

  async getMessages(actor: ActorContext, conversationId: string) {
    await this.requireConversation(actor, conversationId);
    return this.db
      .select()
      .from(schema.agentMessages)
      .where(
        and(
          eq(schema.agentMessages.tenantId, actor.tenantId),
          eq(schema.agentMessages.conversationId, conversationId),
        ),
      )
      .orderBy(asc(schema.agentMessages.createdAt));
  }

  /**
   * One user message, streamed. The loop is: ask the provider, run whatever
   * tools it asks for through the capability registry, feed the results back,
   * repeat until it answers in prose. Tools are the only reach the model has
   * into the business (non-negotiable #2) and every one of them is permission
   * checked inside `registry.invoke`.
   */
  async *send(actor: ActorContext, input: SendInput, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const conversationId = input.conversationId
      ? (await this.requireConversation(actor, input.conversationId)).id
      : await this.createConversation(actor, input.message);

    await this.appendMessage(actor, conversationId, { role: "user", content: input.message });

    const messages: ChatMessage[] = [
      { role: "system", content: await this.buildSystemPrompt(actor) },
      ...(await this.history(actor, conversationId)),
    ];
    const tools = this.registry.toolDefinitions(actor);
    const maxSteps = this.options.maxSteps ?? 8;

    for (let step = 0; step < maxSteps; step += 1) {
      let text = "";
      const calls: ToolCall[] = [];

      for await (const event of this.provider.chat({ messages, tools }, signal)) {
        if (event.type === "text") {
          text += event.delta;
          yield { type: "text", delta: event.delta };
        } else if (event.type === "tool_call") {
          calls.push(event.call);
        }
      }

      const assistant: ChatMessage = {
        role: "assistant",
        content: text || null,
        toolCalls: calls.length ? calls : undefined,
      };
      messages.push(assistant);
      await this.appendMessage(actor, conversationId, assistant);

      if (!calls.length) break;

      for (const call of calls) {
        const toolInput = safeParseArguments(call.arguments);
        yield { type: "tool_start", name: call.name, input: toolInput };

        try {
          const output = await this.registry.invoke(actor, call.name, toolInput, { channel: "agent" });
          yield { type: "tool_result", name: call.name, ok: true, output };
          await this.pushToolMessage(actor, conversationId, messages, call, { ok: true, result: output });
        } catch (error) {
          // The model sees the failure and can recover: a missing permission
          // or a validation error is an answer, not a crashed conversation.
          const message = error instanceof Error ? error.message : String(error);
          yield { type: "tool_error", name: call.name, ok: false, error: message };
          await this.pushToolMessage(actor, conversationId, messages, call, { ok: false, error: message });
        }
      }
    }

    yield { type: "done", conversationId };
  }

  private async buildSystemPrompt(actor: ActorContext): Promise<string> {
    const [tenant] = await this.db
      .select({ name: schema.tenants.name })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, actor.tenantId))
      .limit(1);

    return systemPrompt({
      tenantName: tenant?.name ?? "this company",
      actor,
      memories: await this.memory.list(actor),
      today: new Date().toISOString().slice(0, 10),
    });
  }

  private async history(actor: ActorContext, conversationId: string): Promise<ChatMessage[]> {
    const rows = await this.getMessages(actor, conversationId);
    return rows.map((row) => ({
      role: row.role as ChatMessage["role"],
      content: row.content,
      toolCalls: (row.toolCalls as ToolCall[] | null) ?? undefined,
      toolCallId: (row.toolResult as { toolCallId?: string } | null)?.toolCallId,
    }));
  }

  private async requireConversation(actor: ActorContext, conversationId: string) {
    const [row] = await this.db
      .select()
      .from(schema.agentConversations)
      .where(
        and(
          eq(schema.agentConversations.id, conversationId),
          eq(schema.agentConversations.tenantId, actor.tenantId),
          eq(schema.agentConversations.userId, actor.userId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundError("Conversation", conversationId);
    return row;
  }

  private async createConversation(actor: ActorContext, firstMessage: string): Promise<string> {
    const id = newId();
    await this.db.insert(schema.agentConversations).values({
      id,
      tenantId: actor.tenantId,
      userId: actor.userId,
      title: firstMessage.slice(0, 80),
    });
    return id;
  }

  private async appendMessage(actor: ActorContext, conversationId: string, message: ChatMessage) {
    await this.db.insert(schema.agentMessages).values({
      id: newId(),
      tenantId: actor.tenantId,
      conversationId,
      role: message.role,
      content: message.content ?? null,
      toolCalls: message.toolCalls ?? null,
      toolResult: message.toolCallId ? { toolCallId: message.toolCallId } : null,
    });
    await this.db
      .update(schema.agentConversations)
      .set({ updatedAt: new Date() })
      .where(eq(schema.agentConversations.id, conversationId));
  }

  private async pushToolMessage(
    actor: ActorContext,
    conversationId: string,
    messages: ChatMessage[],
    call: ToolCall,
    payload: unknown,
  ) {
    const message: ChatMessage = {
      role: "tool",
      toolCallId: call.id,
      content: JSON.stringify(payload),
    };
    messages.push(message);
    await this.appendMessage(actor, conversationId, message);
  }
}

/** A model can emit malformed JSON; the schema of the capability rejects it either way. */
function safeParseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}
