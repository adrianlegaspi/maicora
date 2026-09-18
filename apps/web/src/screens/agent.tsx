import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { streamAgent } from "../api.js";
import type { Proposal } from "../types.js";
import { Badge, Card, Empty, Page, errorMessage } from "../ui.js";
import { DiffView } from "./proposals.js";

interface Turn {
  role: "user" | "assistant";
  text: string;
  tools: { name: string; state: "running" | "ok" | "error"; detail?: string }[];
  proposals: Proposal[];
}

/**
 * Screen 3. The agent writes nothing itself: every proposal it produces is
 * shown here as a diff with the same approve/reject buttons the proposal
 * screen has (docs/mvp/09-proposals-and-governance.md).
 */
export function AgentWorkspace() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [turns]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;

    setMessage("");
    setError(null);
    setBusy(true);
    setTurns((previous) => [
      ...previous,
      { role: "user", text, tools: [], proposals: [] },
      { role: "assistant", text: "", tools: [], proposals: [] },
    ]);

    const controller = new AbortController();
    try {
      for await (const event of streamAgent({ message: text, conversationId }, controller.signal)) {
        setTurns((previous) => {
          const turns = [...previous];
          const last = { ...turns[turns.length - 1]! };
          turns[turns.length - 1] = last;

          if (event.type === "text") last.text += event.delta ?? "";
          if (event.type === "tool_start") last.tools = [...last.tools, { name: event.name!, state: "running" }];
          if (event.type === "tool_result") {
            last.tools = markTool(last.tools, event.name!, "ok");
            const proposal = asProposal(event.output);
            if (proposal) last.proposals = [...last.proposals, proposal];
          }
          if (event.type === "tool_error") {
            last.tools = markTool(last.tools, event.name!, "error", event.error);
          }
          return turns;
        });

        if (event.type === "done") setConversationId(event.conversationId);
        if (event.type === "error") setError(event.message ?? "The agent failed");
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Agent">
      <div className="chat">
        {turns.length === 0 ? (
          <Empty>
            Ask for something in plain language - "invoice 3 Dragon XL to Acme", "what should this sell for at 35%
            margin", "I counted 37 on the shelf". Anything that changes money or stock comes back as a proposal you
            approve.
          </Empty>
        ) : null}

        {turns.map((turn, index) => (
          <div key={index} className={`bubble ${turn.role}`}>
            {turn.tools.map((tool, toolIndex) => (
              <div key={toolIndex} className="bubble tool" style={{ border: "none", padding: "2px 0" }}>
                {tool.state === "running" ? "…" : tool.state === "ok" ? "✓" : "✕"} {tool.name}
                {tool.detail ? ` - ${tool.detail}` : ""}
              </div>
            ))}
            {turn.text}
            {turn.proposals.map((proposal) => (
              <div key={proposal.id} style={{ marginTop: 12 }}>
                <Card>
                  <div className="spread">
                    <strong>{proposal.diff.title}</strong>
                    <Badge value={proposal.status} />
                  </div>
                  <DiffView diff={proposal.diff} />
                  <Link className="button primary" to={`/proposals/${proposal.id}`} style={{ marginTop: 10 }}>
                    Review it
                  </Link>
                </Card>
              </div>
            ))}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {error ? <p className="banner banner-error" style={{ marginTop: 12 }}>{error}</p> : null}

      <form className="composer" onSubmit={submit}>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask the agent…"
          disabled={busy}
          autoFocus
        />
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Working…" : "Send"}
        </button>
      </form>
    </Page>
  );
}

function markTool(tools: Turn["tools"], name: string, state: "ok" | "error", detail?: string): Turn["tools"] {
  // The most recent running call with that name: the same tool can be called
  // more than once in a turn, and the results arrive in order.
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    if (tools[index]!.name === name && tools[index]!.state === "running") {
      const next = [...tools];
      next[index] = { name, state, detail };
      return next;
    }
  }
  return tools;
}

/** A tool result is a proposal when it carries a diff; everything else is data. */
function asProposal(output: unknown): Proposal | null {
  const candidate = output as Proposal | null;
  return candidate && typeof candidate === "object" && "diff" in candidate && "status" in candidate
    ? candidate
    : null;
}
