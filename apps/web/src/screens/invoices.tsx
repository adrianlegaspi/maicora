import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { call, get, send } from "../api.js";
import { useSession } from "../app.js";
import type { Customer, Invoice, Product, Proposal, Warehouse } from "../types.js";
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
  percent,
  quantity,
  useAsync,
} from "../ui.js";

/** Screen 14. */
export function InvoiceList() {
  const { can } = useSession();
  const [status, setStatus] = useState("");
  const state = useAsync(
    () => call<Invoice[]>("invoices.search", { status: status || undefined, limit: 100 }),
    [status],
  );

  return (
    <Page
      title="Invoices"
      actions={
        <>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Every status</option>
            <option value="DRAFT">Draft</option>
            <option value="PENDING_APPROVAL">Pending approval</option>
            <option value="APPROVED">Approved</option>
            <option value="STAMPED">Stamped</option>
            <option value="CANCELLATION_REQUESTED">Cancellation requested</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="ERROR">Error</option>
          </select>
          {can("invoices.draft") ? (
            <Link className="button primary" to="/invoices/new">
              New invoice
            </Link>
          ) : null}
        </>
      }
    >
      <Loaded state={state}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No invoices yet.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th className="num">Total</th>
                  <th>UUID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <Link to={`/invoices/${invoice.id}`}>{datetime(invoice.createdAt)}</Link>
                    </td>
                    <td className="muted">{invoice.kind}</td>
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
    </Page>
  );
}

/** Screen 15. */
export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const navigate = useNavigate();
  const state = useAsync(() => call<Invoice>("invoices.get", { invoiceId: id }), [id]);

  return (
    <Page title="Invoice" actions={<button onClick={() => navigate("/invoices")}>Back</button>}>
      <Loaded state={state}>
        {(invoice) => (
          <>
            <Card title={invoice.uuidFiscal ?? "Not stamped yet"}>
              <div className="grid">
                <Field label="Kind">
                  <div>{invoice.kind}</div>
                </Field>
                <Field label="Status">
                  <div>
                    <Badge value={invoice.status} />
                  </div>
                </Field>
                <Field label="Environment">
                  <div>{invoice.environment}</div>
                </Field>
                <Field label="Customer">
                  <div>
                    {invoice.customerId ? (
                      <Link to={`/customers/${invoice.customerId}`}>Open customer</Link>
                    ) : (
                      "Publico en general"
                    )}
                  </div>
                </Field>
                <Field label="Payment form">
                  <div>{invoice.paymentForm ?? "-"}</div>
                </Field>
                <Field label="Payment method">
                  <div>{invoice.paymentMethod ?? "-"}</div>
                </Field>
                <Field label="CFDI use">
                  <div>{invoice.cfdiUse ?? "-"}</div>
                </Field>
                <Field label="Stamped">
                  <div>{datetime(invoice.stampedAt)}</div>
                </Field>
              </div>

              {invoice.cancelledAt ? (
                <Banner kind="warn">
                  Cancelled {datetime(invoice.cancelledAt)}
                  {invoice.cancellationReason ? ` · reason ${invoice.cancellationReason}` : ""}
                </Banner>
              ) : null}

              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>What</th>
                    <th className="num">Quantity</th>
                    <th className="num">Unit price</th>
                    <th className="num">Tax</th>
                    <th className="num">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {(invoice.items ?? []).map((item) => (
                    <tr key={item.id}>
                      <td className="muted">{item.lineNumber}</td>
                      <td>{item.description}</td>
                      <td className="num">{quantity(item.quantity)}</td>
                      <td className="num">{money(item.unitPrice, invoice.currency)}</td>
                      <td className="num">
                        {money(item.taxAmount, invoice.currency)}
                        <span className="muted"> ({percent(item.taxRate)})</span>
                      </td>
                      <td className="num">{money(item.total, invoice.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}>Subtotal</td>
                    <td className="num">{money(invoice.subtotal, invoice.currency)}</td>
                  </tr>
                  <tr>
                    <td colSpan={5}>Tax</td>
                    <td className="num">{money(invoice.taxTotal, invoice.currency)}</td>
                  </tr>
                  <tr>
                    <td colSpan={5}>
                      <strong>Total</strong>
                    </td>
                    <td className="num">
                      <strong>{money(invoice.total, invoice.currency)}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </Card>

            {invoice.status === "STAMPED" && can("invoices.draft") ? (
              <StampedActions invoiceId={invoice.id} />
            ) : null}
          </>
        )}
      </Loaded>
    </Page>
  );
}

/**
 * A stamped CFDI is never edited or deleted (non-negotiable #12). The only
 * two ways back are a cancellation the SAT accepts, or an egreso that
 * corrects it - both of which are proposals a person has to approve.
 */
function StampedActions({ invoiceId }: { invoiceId: string }) {
  const navigate = useNavigate();
  const [reason, setReason] = useState("02");
  const [replacementUuid, setReplacementUuid] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [paymentForm, setPaymentForm] = useState("03");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function draft(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const proposal = await send<Proposal>("POST", `/invoices/${invoiceId}/${path}`, body);
      navigate(`/proposals/${proposal.id}`);
    } catch (cause) {
      setError(cause);
      setBusy(false);
    }
  }

  return (
    <>
      <Card title="Cancel it">
        <div className="grid">
          <Field label="SAT reason">
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="01">01 · Issued with errors, a replacement exists</option>
              <option value="02">02 · Issued with errors, no replacement</option>
              <option value="03">03 · The operation did not happen</option>
              <option value="04">04 · Covered by a global invoice</option>
            </select>
          </Field>
          {reason === "01" ? (
            <Field label="Replacement UUID" hint="The SAT requires it for reason 01.">
              <input value={replacementUuid} onChange={(e) => setReplacementUuid(e.target.value)} />
            </Field>
          ) : null}
        </div>
        <button
          className="danger"
          disabled={busy || (reason === "01" && !replacementUuid)}
          onClick={() => draft("cancellations", { reason, ...(replacementUuid ? { replacementUuid } : {}) })}
        >
          Draft the cancellation
        </button>
      </Card>

      <Card title="Correct it with a credit note">
        <div className="grid">
          <Field label="Payment form">
            <input value={paymentForm} onChange={(e) => setPaymentForm(e.target.value)} />
          </Field>
          <Field label="Why" hint="Recorded on the egreso.">
            <input value={creditReason} onChange={(e) => setCreditReason(e.target.value)} />
          </Field>
        </div>
        <button
          disabled={busy || !creditReason}
          onClick={() => draft("credit-notes", { paymentForm, reason: creditReason })}
        >
          Draft the credit note
        </button>
      </Card>

      {error ? <Banner kind="error">{errorMessage(error)}</Banner> : null}
    </>
  );
}

interface LineRow {
  productId: string;
  quantity: string;
  unitPrice: string;
}

/**
 * Screen 16. Nothing here is stamped: the form produces a proposal carrying
 * the tax calculation and the stock impact, and someone approves it before a
 * CFDI exists.
 */
export function InvoiceDraft() {
  const navigate = useNavigate();
  const [customerId, setCustomerId] = useState("");
  const [paymentForm, setPaymentForm] = useState("03");
  const [paymentMethod, setPaymentMethod] = useState("PUE");
  const [cfdiUse, setCfdiUse] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [lines, setLines] = useState<LineRow[]>([{ productId: "", quantity: "1", unitPrice: "" }]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const customers = useAsync(() => call<Customer[]>("customers.search", { limit: 200 }), []);
  const products = useAsync(() => call<Product[]>("products.search", { limit: 200 }), []);
  const warehouses = useAsync(() => get<Warehouse[]>("/warehouses"), []);

  function update(index: number, patch: Partial<LineRow>) {
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const proposal = await send<Proposal>("POST", "/invoices/drafts", {
        // An empty selection means publico en general, which the API takes
        // as an explicit null rather than a missing field.
        customerId: customerId || null,
        items: lines
          .filter((line) => line.productId && line.quantity)
          .map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            ...(line.unitPrice ? { unitPrice: line.unitPrice } : {}),
          })),
        paymentForm,
        paymentMethod,
        ...(cfdiUse ? { cfdiUse } : {}),
        ...(warehouseId ? { warehouseId } : {}),
      });
      navigate(`/proposals/${proposal.id}`);
    } catch (cause) {
      setError(cause);
      setBusy(false);
    }
  }

  return (
    <Page title="New invoice" actions={<button onClick={() => navigate(-1)}>Cancel</button>}>
      <Card>
        <form onSubmit={submit}>
          <div className="grid">
            <Field label="Customer" hint="Left empty, it is issued to publico en general.">
              <Loaded state={customers}>
                {(rows) => (
                  <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">Publico en general</option>
                    {rows.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.displayName} {customer.rfc ? `· ${customer.rfc}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </Loaded>
            </Field>
            <Field label="Payment form" hint="SAT c_FormaPago, e.g. 03 for transfer.">
              <input value={paymentForm} onChange={(e) => setPaymentForm(e.target.value)} required />
            </Field>
            <Field label="Payment method">
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="PUE">PUE · paid in one go</option>
                <option value="PPD">PPD · paid later or in parts</option>
              </select>
            </Field>
            <Field label="CFDI use" hint="Falls back to the customer's default.">
              <input value={cfdiUse} onChange={(e) => setCfdiUse(e.target.value)} />
            </Field>
            <Field label="Warehouse" hint="Where the stock leaves from.">
              <Loaded state={warehouses}>
                {(rows) => (
                  <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                    <option value="">Default</option>
                    {rows.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.code} · {warehouse.name}
                      </option>
                    ))}
                  </select>
                )}
              </Loaded>
            </Field>
          </div>

          <h3>Lines</h3>
          <Loaded state={products}>
            {(catalogue) => (
              <>
                {lines.map((line, index) => (
                  <div className="row" key={index}>
                    <select
                      value={line.productId}
                      onChange={(e) => update(index, { productId: e.target.value })}
                      style={{ flex: 1 }}
                    >
                      <option value="">Pick a product</option>
                      {catalogue.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.sku} · {product.name}
                        </option>
                      ))}
                    </select>
                    <input
                      placeholder="Quantity"
                      value={line.quantity}
                      onChange={(e) => update(index, { quantity: e.target.value })}
                      inputMode="decimal"
                    />
                    <input
                      placeholder="Unit price (optional)"
                      value={line.unitPrice}
                      onChange={(e) => update(index, { unitPrice: e.target.value })}
                      inputMode="decimal"
                    />
                    <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))}>
                      Remove
                    </button>
                  </div>
                ))}
              </>
            )}
          </Loaded>

          <div className="row" style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={() => setLines([...lines, { productId: "", quantity: "1", unitPrice: "" }])}
            >
              Add a line
            </button>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Drafting…" : "Draft the invoice"}
            </button>
          </div>

          {error ? <Banner kind="error">{errorMessage(error)}</Banner> : null}
          <p className="muted">
            The totals are calculated by the fiscal engine when the draft is made, not here.
          </p>
        </form>
      </Card>
    </Page>
  );
}
