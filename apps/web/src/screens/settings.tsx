import { useState, type FormEvent } from "react";
import { get, send } from "../api.js";
import { useSession } from "../app.js";
import type { FiscalSettings, Member, Role } from "../types.js";
import { Badge, Banner, Card, Empty, Field, Loaded, Page, errorMessage, useAsync } from "../ui.js";

const ROLES: Role[] = ["OWNER", "ADMIN", "STAFF", "VIEWER"];

/** Screen 17. */
export function FiscalSettingsScreen() {
  const [environment, setEnvironment] = useState<"SANDBOX" | "PRODUCTION">("SANDBOX");
  const existing = useAsync(
    () => get<FiscalSettings | null>("/fiscal-settings", { environment }),
    [environment],
  );
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const loaded = existing.data;
  const values = form ?? {
    rfcEmisor: loaded?.rfcEmisor ?? "",
    legalNameEmisor: loaded?.legalNameEmisor ?? "",
    regimenFiscal: loaded?.regimenFiscal ?? "",
    lugarExpedicion: loaded?.lugarExpedicion ?? "",
    pacProvider: loaded?.pacProvider ?? "mock",
  };

  function set(key: string, value: string) {
    setForm({ ...values, [key]: value });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // The CSD references are managed on their own screen; sending them
      // here would blank them out whenever this form is saved.
      await send("PUT", "/fiscal-settings", {
        environment,
        ...values,
        ...(loaded?.csdCertRef ? { csdCertRef: loaded.csdCertRef } : {}),
        ...(loaded?.csdKeyRef ? { csdKeyRef: loaded.csdKeyRef } : {}),
      });
      setSaved(true);
      existing.reload();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Fiscal settings"
      actions={
        <select
          value={environment}
          onChange={(e) => {
            setEnvironment(e.target.value as "SANDBOX" | "PRODUCTION");
            setForm(null);
          }}
        >
          <option value="SANDBOX">Sandbox</option>
          <option value="PRODUCTION">Production</option>
        </select>
      }
    >
      <Loaded state={existing}>
        {() => (
          <Card title="Who issues the invoices">
            <form onSubmit={submit}>
              <div className="grid">
                <Field label="RFC">
                  <input
                    value={values.rfcEmisor}
                    onChange={(e) => set("rfcEmisor", e.target.value.toUpperCase())}
                    required
                  />
                </Field>
                <Field label="Legal name" hint="Exactly as the SAT holds it, without the company type suffix.">
                  <input
                    value={values.legalNameEmisor}
                    onChange={(e) => set("legalNameEmisor", e.target.value)}
                    required
                  />
                </Field>
                <Field label="Tax regime" hint="c_RegimenFiscal, e.g. 601.">
                  <input value={values.regimenFiscal} onChange={(e) => set("regimenFiscal", e.target.value)} required />
                </Field>
                <Field label="Place of issuance" hint="The postal code the CFDI is issued from.">
                  <input
                    value={values.lugarExpedicion}
                    onChange={(e) => set("lugarExpedicion", e.target.value)}
                    required
                  />
                </Field>
                <Field label="PAC">
                  <input value={values.pacProvider} onChange={(e) => set("pacProvider", e.target.value)} />
                </Field>
              </div>

              {environment === "PRODUCTION" ? (
                <Banner kind="warn">
                  Invoices stamped in production are real fiscal documents. They cannot be deleted, only cancelled
                  with the SAT.
                </Banner>
              ) : null}
              {error ? <Banner kind="error">{errorMessage(error)}</Banner> : null}
              {saved ? <Banner kind="ok">Saved.</Banner> : null}
              <button className="primary" type="submit" disabled={busy} style={{ marginTop: 12 }}>
                {busy ? "Saving…" : "Save"}
              </button>
            </form>
          </Card>
        )}
      </Loaded>
    </Page>
  );
}

/**
 * Screen 18. The certificate and key themselves never pass through this
 * screen or this database: what is stored is an opaque reference into the
 * secret store, and only the fiscal engine can resolve it.
 */
export function CsdSetup() {
  const [environment, setEnvironment] = useState<"SANDBOX" | "PRODUCTION">("SANDBOX");
  const existing = useAsync(() => get<FiscalSettings | null>("/fiscal-settings", { environment }), [environment]);
  const [certRef, setCertRef] = useState<string | null>(null);
  const [keyRef, setKeyRef] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(settings: FiscalSettings) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await send("PUT", "/fiscal-settings", {
        environment: settings.environment,
        rfcEmisor: settings.rfcEmisor,
        legalNameEmisor: settings.legalNameEmisor,
        regimenFiscal: settings.regimenFiscal,
        lugarExpedicion: settings.lugarExpedicion,
        pacProvider: settings.pacProvider ?? undefined,
        csdCertRef: certRef ?? settings.csdCertRef,
        csdKeyRef: keyRef ?? settings.csdKeyRef,
      });
      setSaved(true);
      existing.reload();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Stamping certificate"
      actions={
        <select
          value={environment}
          onChange={(e) => {
            setEnvironment(e.target.value as "SANDBOX" | "PRODUCTION");
            setCertRef(null);
            setKeyRef(null);
          }}
        >
          <option value="SANDBOX">Sandbox</option>
          <option value="PRODUCTION">Production</option>
        </select>
      }
    >
      <Loaded state={existing}>
        {(settings) =>
          !settings ? (
            <Empty>Fill in the fiscal settings for this environment first.</Empty>
          ) : (
            <Card title="CSD references">
              <p className="muted">
                Upload the .cer and .key to the secret store, then record the references here. Neither file is ever
                sent to this application, and no certificate is stored in the database.
              </p>
              <div className="grid">
                <Field label="Certificate reference">
                  <input
                    value={certRef ?? settings.csdCertRef ?? ""}
                    onChange={(e) => setCertRef(e.target.value)}
                    placeholder="secret://csd/cert"
                  />
                </Field>
                <Field label="Key reference">
                  <input
                    value={keyRef ?? settings.csdKeyRef ?? ""}
                    onChange={(e) => setKeyRef(e.target.value)}
                    placeholder="secret://csd/key"
                  />
                </Field>
              </div>

              <p>
                Stamping is {settings.csdCertRef && settings.csdKeyRef ? "configured" : "not configured"} for{" "}
                {settings.environment.toLowerCase()}.
              </p>

              {error ? <Banner kind="error">{errorMessage(error)}</Banner> : null}
              {saved ? <Banner kind="ok">Saved.</Banner> : null}
              <button className="primary" disabled={busy} onClick={() => save(settings)}>
                {busy ? "Saving…" : "Save"}
              </button>
            </Card>
          )
        }
      </Loaded>
    </Page>
  );
}

/** Screen 21. */
export function TeamSettings() {
  const { me } = useSession();
  const members = useAsync(() => get<Member[]>("/members"), []);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("STAFF");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      members.reload();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Team">
      <Card title="Who has access">
        <Loaded state={members}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty>Nobody yet.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((member) => {
                    const isSelf = member.userId === me.userId;
                    return (
                      <tr key={member.membershipId}>
                        <td>
                          {member.email}
                          {isSelf ? <span className="muted"> · you</span> : null}
                        </td>
                        <td>
                          <select
                            value={member.role}
                            disabled={isSelf || busy}
                            onChange={(e) =>
                              act(() => send("PATCH", `/members/${member.membershipId}`, { role: e.target.value }))
                            }
                          >
                            {ROLES.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <Badge value={member.isActive ? "ACTIVE" : "DISABLED"} />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {isSelf ? (
                            // Locking yourself out would leave a company with
                            // nobody who can let anyone back in.
                            <span className="muted">Ask another owner</span>
                          ) : (
                            <button
                              disabled={busy}
                              onClick={() =>
                                act(() =>
                                  send("PATCH", `/members/${member.membershipId}`, { isActive: !member.isActive }),
                                )
                              }
                            >
                              {member.isActive ? "Disable" : "Enable"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          }
        </Loaded>
      </Card>

      <Card title="Add someone">
        <p className="muted">They need to have signed in once before they can be added to a company.</p>
        <div className="row">
          <input
            type="email"
            placeholder="their@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ flex: 1 }}
          />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            className="primary"
            disabled={busy || !email}
            onClick={() =>
              act(async () => {
                await send("POST", "/members", { email, role });
                setEmail("");
              })
            }
          >
            Add
          </button>
        </div>
        {error ? <Banner kind="error">{errorMessage(error)}</Banner> : null}
      </Card>
    </Page>
  );
}

interface AiStatus {
  configured: boolean;
  model: string | null;
  baseUrl: string | null;
  mcpEnabled: boolean;
}

/** Screen 22. */
export function AiSettings() {
  const state = useAsync(() => get<AiStatus>("/ai-settings"), []);

  return (
    <Page title="AI">
      <Loaded state={state}>
        {(status) => (
          <Card title="What the assistant is running on">
            <div className="grid">
              <Field label="Status">
                <div>{status.configured ? "Connected" : "No provider configured"}</div>
              </Field>
              <Field label="Model">
                <div>{status.model ?? "-"}</div>
              </Field>
              <Field label="Endpoint">
                <div>{status.baseUrl ?? "-"}</div>
              </Field>
              <Field label="MCP access">
                <div>{status.mcpEnabled ? "Allowed for your role" : "Not allowed for your role"}</div>
              </Field>
            </div>

            {status.configured ? null : (
              <Banner kind="warn">
                Without a provider the assistant answers from a deterministic stub. Set AI_API and AI_API_KEY on the
                API service.
              </Banner>
            )}
            <p className="muted">
              The provider, the model and the API key are server configuration. The key is never sent to the browser,
              so it cannot be edited here.
            </p>
          </Card>
        )}
      </Loaded>
    </Page>
  );
}
