import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { get, send } from "../api.js";
import { useSession } from "../app.js";
import type { DiffSection, Proposal } from "../types.js";
import { Badge, Banner, Card, Empty, Loaded, Page, datetime, errorMessage, useAsync } from "../ui.js";

/** The business diff, rendered the way docs/mvp/09-proposals-and-governance.md prints it. */
export function DiffView({ diff }: { diff: { title: string; sections: DiffSection[] } }) {
  return (
    <div className="diff">
      <h3>{diff.title}</h3>
      {diff.sections.map((section, index) => (
        <div className="section" key={index}>
          {section.heading ? <div className="heading">{section.heading}</div> : null}
          {(section.lines ?? []).map((line, lineIndex) => (
            <div className="line" key={lineIndex}>
              {line}
            </div>
          ))}
          {(section.changes ?? []).map((change, changeIndex) => (
            <div className="change" key={changeIndex}>
              {change.label}
              {change.before !== undefined && change.after !== undefined ? (
                <>
                  : <span className="before">{change.before}</span> → <span className="after">{change.after}</span>
                </>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Screen 19, list half. */
export function ProposalList() {
  const [status, setStatus] = useState("PENDING_APPROVAL");
  const state = useAsync(() => get<Proposal[]>("/proposals", { status: status || undefined }), [status]);

  return (
    <Page
      title="Proposals"
      actions={
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 220 }}>
          <option value="PENDING_APPROVAL">Pending approval</option>
          <option value="DRAFT">Draft</option>
          <option value="APPROVED">Approved, not applied</option>
          <option value="EXECUTED">Applied</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All</option>
        </select>
      }
    >
      <Loaded state={state}>
        {(proposals) =>
          proposals.length === 0 ? (
            <Empty>Nothing here.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>What</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {proposals.map((proposal) => (
                  <tr key={proposal.id}>
                    <td>{proposal.diff.title}</td>
                    <td className="muted">{proposal.kind}</td>
                    <td>
                      <Badge value={proposal.status} />
                    </td>
                    <td className="muted">
                      {datetime(proposal.createdAt)}
                      {proposal.requestedByAgent ? " · by the agent" : ""}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link className="button" to={`/proposals/${proposal.id}`}>
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Loaded>
    </Page>
  );
}

/**
 * Screen 19, review half. Approval and execution are two separate clicks on
 * purpose: approving says the change is right, applying is what stamps the
 * CFDI or moves the stock (non-negotiable #6).
 */
export function ProposalDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const navigate = useNavigate();
  const state = useAsync(() => get<Proposal>(`/proposals/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<string | null>(null);

  async function act(action: "approve" | "reject" | "execute") {
    setBusy(true);
    setError(null);
    try {
      if (action === "reject") {
        const reason = window.prompt("Why is this rejected? The reason is recorded.");
        if (!reason) return;
        await send("POST", `/proposals/${id}/reject`, { reason });
      } else {
        const outcome = await send<{ changeset?: { id: string } }>("POST", `/proposals/${id}/${action}`, {});
        if (action === "execute") setResult(`Applied. ChangeSet ${outcome.changeset?.id ?? "-"}.`);
      }
      state.reload();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Proposal" actions={<button onClick={() => navigate(-1)}>Back</button>}>
      <Loaded state={state}>
        {(proposal) => (
          <>
            <Card>
              <div className="spread">
                <div>
                  <strong>{proposal.kind}</strong>
                  <div className="muted">
                    {datetime(proposal.createdAt)}
                    {proposal.requestedByAgent ? " · requested by the agent" : " · requested by a person"}
                  </div>
                </div>
                <div className="row">
                  <Badge value={proposal.status} />
                  <Badge value={proposal.risk} />
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <DiffView diff={proposal.diff} />
              </div>

              {proposal.rejectionReason ? <Banner kind="warn">Rejected: {proposal.rejectionReason}</Banner> : null}
              {error ? <Banner kind="error">{errorMessage(error)}</Banner> : null}
              {result ? <Banner kind="ok">{result}</Banner> : null}

              <div className="row" style={{ marginTop: 12 }}>
                {proposal.status === "PENDING_APPROVAL" && can("proposals.approve") ? (
                  <button className="primary" disabled={busy} onClick={() => act("approve")}>
                    Approve
                  </button>
                ) : null}
                {proposal.status === "PENDING_APPROVAL" && can("proposals.reject") ? (
                  <button className="danger" disabled={busy} onClick={() => act("reject")}>
                    Reject
                  </button>
                ) : null}
                {(proposal.status === "APPROVED" || proposal.status === "DRAFT") && can("proposals.approve") ? (
                  <button className="primary" disabled={busy} onClick={() => act("execute")}>
                    Apply it
                  </button>
                ) : null}
                {proposal.status === "PENDING_APPROVAL" && !can("proposals.approve") ? (
                  <span className="muted">Your role can draft this but not approve it.</span>
                ) : null}
              </div>
            </Card>

            <Card title="Payload">
              <pre className="json">{JSON.stringify(proposal.payload, null, 2)}</pre>
            </Card>
          </>
        )}
      </Loaded>
    </Page>
  );
}
