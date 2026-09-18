import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { call, send } from "../api.js";
import { useSession } from "../app.js";
import type { Customer, FiscalReadiness, Invoice, Proposal } from "../types.js";
import {
  Badge,
  Banner,
  Card,
  Empty,
  Field,
  Loaded,
  Page,
  datetime,
  errorMessage,
  money,
  useAsync,
} from "../ui.js";

/** Screen 4. */
export function CustomerList() {
  const { can } = useSession();
  const [query, setQuery] = useState("");
  const customers = useAsync(() => call<Customer[]>("customers.search", { query: query || undefined }), [query]);
  const incomplete = useAsync(() => call<FiscalReadiness[]>("customers.find_missing_fiscal_data", {}), []);

  return (
    <Page
      title="Customers"
      actions={
        <>
          <input
            placeholder="Search name or RFC"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 240 }}
          />
          {can("customers.write") ? (
            <Link className="button primary" to="/customers/new">
              New customer
            </Link>
          ) : null}
        </>
      }
    >
      <Loaded state={incomplete}>
        {(rows) =>
          rows.length === 0 ? null : (
            <Banner kind="warn">
              {rows.length} customer{rows.length === 1 ? "" : "s"} cannot be invoiced yet - missing fiscal data.
            </Banner>
          )
        }
      </Loaded>

      <Loaded state={customers}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No customers match.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>RFC</th>
                  <th>Email</th>
                  <th>Kind</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <Link to={`/customers/${customer.id}`}>{customer.displayName}</Link>
                      {customer.isArchived ? <span className="muted"> · archived</span> : null}
                    </td>
                    <td>{customer.rfc ?? <span className="muted">-</span>}</td>
                    <td>{customer.email ?? <span className="muted">-</span>}</td>
                    <td className="muted">{customer.kind}</td>
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

/** Screen 5. */
export function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const navigate = useNavigate();
  const customer = useAsync(() => call<Customer>("customers.get", { customerId: id }), [id]);
  const history = useAsync(
    () => call<Invoice[]>("customers.get_invoice_history", { customerId: id, limit: 20 }),
    [id],
  );

  async function archive(isArchived: boolean) {
    await send("POST", `/customers/${id}/archive`, { isArchived });
    customer.reload();
  }

  return (
    <Page
      title="Customer"
      actions={
        <>
          <button onClick={() => navigate("/customers")}>Back</button>
          {can("customers.write") ? (
            <Link className="button" to={`/customers/${id}/edit`}>
              Edit
            </Link>
          ) : null}
        </>
      }
    >
      <Loaded state={customer}>
        {(row) => (
          <>
            <Card title={row.displayName}>
              <div className="grid">
                <Field label="Legal name">
                  <div>{row.legalName ?? "-"}</div>
                </Field>
                <Field label="RFC">
                  <div>{row.rfc ?? "-"}</div>
                </Field>
                <Field label="Tax regime">
                  <div>{row.taxRegime ?? "-"}</div>
                </Field>
                <Field label="Fiscal postal code">
                  <div>{row.fiscalPostalCode ?? "-"}</div>
                </Field>
                <Field label="Default CFDI use">
                  <div>{row.cfdiUseDefault ?? "-"}</div>
                </Field>
                <Field label="Email">
                  <div>{row.email ?? "-"}</div>
                </Field>
                <Field label="Phone">
                  <div>{row.phone ?? "-"}</div>
                </Field>
              </div>
              {can("customers.write") ? (
                <button onClick={() => archive(!row.isArchived)}>
                  {row.isArchived ? "Restore" : "Archive"}
                </button>
              ) : null}
            </Card>

            <Card title="Invoices">
              <Loaded state={history}>
                {(invoices) =>
                  invoices.length === 0 ? (
                    <Empty>No invoices yet.</Empty>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Status</th>
                          <th className="num">Total</th>
                          <th>UUID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoices.map((invoice) => (
                          <tr key={invoice.id}>
                            <td>
                              <Link to={`/invoices/${invoice.id}`}>{datetime(invoice.createdAt)}</Link>
                            </td>
                            <td>
                              <Badge value={invoice.status} />
                            </td>
                            <td className="num">{money(invoice.total, invoice.currency)}</td>
                            <td className="muted">{invoice.uuidFiscal ?? "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                }
              </Loaded>
            </Card>
          </>
        )}
      </Loaded>
    </Page>
  );
}

const BLANK = {
  displayName: "",
  kind: "BUSINESS",
  legalName: "",
  rfc: "",
  taxRegime: "",
  fiscalPostalCode: "",
  cfdiUseDefault: "",
  email: "",
  phone: "",
  notes: "",
};

/**
 * Screen 6. Saving does not write the customer: it drafts a proposal. For a
 * customer that proposal is self-approving (a typo in an address is not a
 * fiscal act), so the screen sends it straight through and reports what was
 * applied.
 */
export function CustomerForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const existing = useAsync(
    async () => (id ? call<Customer>("customers.get", { customerId: id }) : null),
    [id],
  );
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const values = form ?? {
    ...BLANK,
    ...Object.fromEntries(
      Object.entries(existing.data ?? {})
        .filter(([key]) => key in BLANK)
        .map(([key, value]) => [key, value === null ? "" : String(value)]),
    ),
  };

  function set(key: string, value: string) {
    setForm({ ...values, [key]: value });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    // Empty strings are "not set", not "set to blank": sending "" would wipe
    // an RFC the user never touched.
    const payload = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""));

    try {
      const proposal = id
        ? await send<Proposal>("PATCH", `/customers/${id}`, payload)
        : await send<Proposal>("POST", "/customers", payload);

      if (proposal.status === "PENDING_APPROVAL") {
        navigate(`/proposals/${proposal.id}`);
        return;
      }
      const applied = await send<{ changeset?: { entityId: string } }>(
        "POST",
        `/proposals/${proposal.id}/execute`,
        {},
      );
      navigate(`/customers/${applied.changeset?.entityId ?? id}`);
    } catch (cause) {
      setError(cause);
      setBusy(false);
    }
  }

  return (
    <Page title={id ? "Edit customer" : "New customer"} actions={<button onClick={() => navigate(-1)}>Cancel</button>}>
      <Loaded state={existing}>
        {() => (
          <Card>
            <form onSubmit={submit}>
              <div className="grid">
                <Field label="Display name">
                  <input value={values.displayName} onChange={(e) => set("displayName", e.target.value)} required />
                </Field>
                <Field label="Kind">
                  <select value={values.kind} onChange={(e) => set("kind", e.target.value)}>
                    <option value="BUSINESS">Business</option>
                    <option value="INDIVIDUAL">Individual</option>
                    <option value="PUBLICO_GENERAL">Publico en general</option>
                  </select>
                </Field>
                <Field label="Legal name" hint="Exactly as it appears in the SAT's records.">
                  <input value={values.legalName} onChange={(e) => set("legalName", e.target.value)} />
                </Field>
                <Field label="RFC">
                  <input value={values.rfc} onChange={(e) => set("rfc", e.target.value.toUpperCase())} />
                </Field>
                <Field label="Tax regime" hint="SAT c_RegimenFiscal code, e.g. 601.">
                  <input value={values.taxRegime} onChange={(e) => set("taxRegime", e.target.value)} />
                </Field>
                <Field label="Fiscal postal code">
                  <input
                    value={values.fiscalPostalCode}
                    onChange={(e) => set("fiscalPostalCode", e.target.value)}
                  />
                </Field>
                <Field label="Default CFDI use" hint="e.g. G03.">
                  <input value={values.cfdiUseDefault} onChange={(e) => set("cfdiUseDefault", e.target.value)} />
                </Field>
                <Field label="Email">
                  <input type="email" value={values.email} onChange={(e) => set("email", e.target.value)} />
                </Field>
                <Field label="Phone">
                  <input value={values.phone} onChange={(e) => set("phone", e.target.value)} />
                </Field>
              </div>
              <Field label="Notes">
                <textarea value={values.notes} onChange={(e) => set("notes", e.target.value)} />
              </Field>

              {error ? <Banner kind="error">{errorMessage(error)}</Banner> : null}
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
