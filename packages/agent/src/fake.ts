import type { ChatProvider, ChatRequest, ProviderEvent, ToolCall } from "./types.js";

export interface FakeTurn {
  /** Optional guard: the last message's content must match, or the turn throws. */
  expect?: RegExp;
  text?: string;
  toolCalls?: { name: string; arguments: unknown }[];
}

/**
 * A scripted provider for evals (docs/mvp/12-agent-evaluations.md) and local
 * development without an API key. Turns are consumed in order and a turn that
 * does not match its `expect` throws rather than silently drifting, because an
 * eval that quietly takes a different path proves nothing.
 */
export class FakeProvider implements ChatProvider {
  readonly name = "fake";
  private turn = 0;

  constructor(private readonly turns: FakeTurn[]) {}

  /** Names of the tools the script asked for, in order. Handy in assertions. */
  readonly requested: string[] = [];

  async *chat(request: ChatRequest): AsyncIterable<ProviderEvent> {
    const turn = this.turns[this.turn++];
    if (!turn) throw new Error(`FakeProvider ran out of turns after ${this.turns.length}`);

    const last = request.messages.at(-1);
    if (turn.expect && !turn.expect.test(last?.content ?? "")) {
      throw new Error(`FakeProvider turn ${this.turn} expected ${turn.expect} but got: ${last?.content}`);
    }

    if (turn.text) yield { type: "text", delta: turn.text };

    const calls: ToolCall[] = (turn.toolCalls ?? []).map((call, index) => ({
      id: `call_${this.turn}_${index}`,
      name: call.name,
      arguments: JSON.stringify(call.arguments),
    }));
    for (const call of calls) {
      this.requested.push(call.name);
      yield { type: "tool_call", call };
    }

    yield { type: "done", finishReason: calls.length ? "tool_calls" : "stop" };
  }
}
