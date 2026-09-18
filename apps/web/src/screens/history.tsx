import { useState } from "react";
import { get, send } from "../api.js";
import { useSession } from "../app.js";
import type { AuditEntry, Changeset } from "../types.js";
import { Empty, Loaded, Page, datetime, useAsync } from "../ui.js";

/**
 * Screen 20. Two ledgers, deliberately side by side: ChangeSets are what the
 * system did to business data and carry the before/after that makes a revert
 * possible; the audit log is who asked for what, and is never rewritten.
 */
export function History() {
  const { can } = useSession();
  const [tab, setTab] = useState<"changesets" | "audit">("changesets");
  const changesets = useAsync(() => get<Changeset[]>("/changesets"), []);
  const audit = useAsync(() => get<AuditEntry[]>("/audit", { limit: "200" }), []);

  return (
    <Page
      title="History"
      actions={
        <div className="row">
          <button className={tab === "changesets" ? "primary" : ""} onClick={() => setTab("changesets")}>
            Changes
          </button>
          <button className={tab === "audit" ? "primary" : ""} onClick={() => setTab("audit")}>
            Activity
          </button>
        </div>
      }
    >
      {tab === "changesets" ? (
        <Loaded state={changesets}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty>Nothing has been applied yet.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Entity</th>
                    <th>Action</th>
                    <th>Reversible</th>
                    <th>Before and after</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="muted">{datetime(row.createdAt)}</td>
                      <td>
                        {row.entityType}
                        <div className="muted">{row.entityId}</div>
                      </td>
                      <td>{row.action}</td>
                      <td>{row.reversible ? (row.revertedAt ? "undone" : "yes") : "no"}</td>
                      <td>
                        <pre className="json" style={{ maxWidth: 420 }}>
                          {JSON.stringify({ before: row.before, after: row.after }, null, 2)}
                        </pre>
                      </td>
                      <td>
                        {can("proposals.approve") && row.reversible && !row.revertedAt ? (
                          <Undo changesetId={row.id} onDone={changesets.reload} />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Loaded>
      ) : (
        <Loaded state={audit}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No activity recorded yet.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="muted">{datetime(row.createdAt)}</td>
                      <td>{row.action}</td>
                      <td className="muted">
                        {row.entityType ?? "-"} {row.entityId ?? ""}
                      </td>
                      <td className="muted">{row.metadata ? JSON.stringify(row.metadata) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Loaded>
      )}
    </Page>
  );
}

/**
 * Undo is only ever offered for a ChangeSet the domain marked reversible.
 * The backend re-checks that, so a stale row here cannot rewrite the history
 * of a stock movement or a stamped CFDI.
 */
function Undo({ changesetId, onDone }: { changesetId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function undo() {
    setBusy(true);
    setError(undefined);
    try {
      await send("POST", `/changesets/${changesetId}/revert`, {});
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button disabled={busy} onClick={() => void undo()}>
        {busy ? "Undoing..." : "Undo"}
      </button>
      {error ? <div className="error">{error}</div> : null}
    </>
  );
}
