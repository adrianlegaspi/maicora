import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { call, send } from "../api.js";
import { useSession } from "../app.js";
import type { PricingSummary, Product, Proposal, Scenario, StockLevel } from "../types.js";
import {
  Badge,
  Banner,
  Card,
  Empty,
  Field,
  Loaded,
  Page,
  errorMessage,
  money,
  percent,
  quantity,
  useAsync,
} from "../ui.js";

/** Screen 7. */
export function ProductList() {
  const { can } = useSession();
  const [query, setQuery] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const state = useAsync(
    () => call<Product[]>("products.search", { query: query || undefined, includeInactive }),
    [query, includeInactive],
  );

  return (
    <Page
      title="Products"
      actions={
        <>
          <input
            placeholder="Search SKU or name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 240 }}
          />
          <label className="inline">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            Show inactive
          </label>
          {can("products.write") ? (
            <Link className="button primary" to="/products/new">
              New product
            </Link>
          ) : null}
        </>
      }
    >
      <Loaded state={state}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No products match.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Name</th>
                  <th>Kind</th>
                  <th className="num">Sale price</th>
                  <th className="num">Estimated cost</th>
                  <th>Stock tracked</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <Link to={`/products/${product.id}`}>{product.sku}</Link>
                    </td>
                    <td>
                      {product.name}
                      {product.isActive ? null : <span className="muted"> · inactive</span>}
                    </td>
                    <td className="muted">{product.kind}</td>
                    <td className="num">{money(product.salePrice, product.currency)}</td>
                    <td className="num">{money(product.currentEstimatedCost, product.currency)}</td>
                    <td>{product.trackInventory ? "yes" : "no"}</td>
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

/** Screen 8. */
export function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const navigate = useNavigate();
  const product = useAsync(() => call<Product>("products.get", { productId: id }), [id]);
  const stock = useAsync(() => call<StockLevel[]>("inventory.get_stock", { productId: id }), [id]);

  async function setActive(isActive: boolean) {
    await send("POST", `/products/${id}/active`, { isActive });
    product.reload();
  }

  return (
    <Page
      title="Product"
      actions={
        <>
          <button onClick={() => navigate("/products")}>Back</button>
          {can("pricing.read") ? (
            <Link className="button" to={`/products/${id}/pricing`}>
              Cost and price
            </Link>
          ) : null}
          {can("products.write") ? (
            <Link className="button" to={`/products/${id}/edit`}>
              Edit
            </Link>
          ) : null}
        </>
      }
    >
      <Loaded state={product}>
        {(row) => (
          <>
            <Card title={`${row.sku} · ${row.name}`}>
              <div className="grid">
                <Field label="Kind">
                  <div>{row.kind}</div>
                </Field>
                <Field label="Unit">
                  <div>{row.internalUnit ?? "-"}</div>
                </Field>
                <Field label="Sale price">
                  <div>{money(row.salePrice, row.currency)}</div>
                </Field>
                <Field label="Tax rate">
                  <div>{percent(row.taxRate)}</div>
                </Field>
                <Field label="Estimated cost">
                  <div>{money(row.currentEstimatedCost, row.currency)}</div>
                </Field>
                <Field label="SAT product code">
                  <div>{row.satProductCode ?? "-"}</div>
                </Field>
                <Field label="SAT unit code">
                  <div>{row.satUnitCode ?? "-"}</div>
                </Field>
                <Field label="Status">
                  <div>
                    <Badge value={row.isActive ? "ACTIVE" : "INACTIVE"} />
                  </div>
                </Field>
              </div>
              {row.description ? <p>{row.description}</p> : null}
              {can("products.write") ? (
                <button onClick={() => setActive(!row.isActive)}>
                  {row.isActive ? "Deactivate" : "Reactivate"}
                </button>
              ) : null}
            </Card>

            {row.trackInventory ? (
              <Card title="Stock">
                <Loaded state={stock}>
                  {(levels) =>
                    levels.length === 0 ? (
                      <Empty>No stock recorded yet.</Empty>
                    ) : (
                      <table>
                        <thead>
                          <tr>
                            <th>Warehouse</th>
                            <th className="num">On hand</th>
                          </tr>
                        </thead>
                        <tbody>
                          {levels.map((level) => (
                            <tr key={level.warehouseId}>
                              <td>
                                <Link to={`/inventory/${row.id}`}>{level.warehouseCode}</Link>
                              </td>
                              <td className="num">{quantity(level.quantityOnHand)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  }
                </Loaded>
              </Card>
            ) : null}
          </>
        )}
      </Loaded>
    </Page>
  );
}

/** Screen 9. Product edits apply directly; only price changes need approval. */
export function ProductForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const existing = useAsync(async () => (id ? call<Product>("products.get", { productId: id }) : null), [id]);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const loaded = existing.data;
  const values = form ?? {
    sku: loaded?.sku ?? "",
    name: loaded?.name ?? "",
    kind: loaded?.kind ?? "PRODUCT",
    description: loaded?.description ?? "",
    internalUnit: loaded?.internalUnit ?? "pza",
    salePrice: loaded?.salePrice ?? "",
    taxRate: loaded?.taxRate ?? "0.16",
    currency: loaded?.currency ?? "MXN",
    trackInventory: String(loaded?.trackInventory ?? true),
    satProductCode: loaded?.satProductCode ?? "",
    satUnitCode: loaded?.satUnitCode ?? "",
  };

  function set(key: string, value: string) {
    setForm({ ...values, [key]: value });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const { trackInventory, ...text } = values;
    const payload: Record<string, unknown> = {
      ...Object.fromEntries(Object.entries(text).filter(([, value]) => value !== "")),
      trackInventory: trackInventory === "true",
    };

    try {
      const product = id
        ? await send<Product>("PATCH", `/products/${id}`, payload)
        : await send<Product>("POST", "/products", payload);
      navigate(`/products/${product.id}`);
    } catch (cause) {
      setError(cause);
      setBusy(false);
    }
  }

  return (
    <Page title={id ? "Edit product" : "New product"} actions={<button onClick={() => navigate(-1)}>Cancel</button>}>
      <Loaded state={existing}>
        {() => (
          <Card>
            <form onSubmit={submit}>
              <div className="grid">
                <Field label="SKU">
                  <input
                    value={values.sku}
                    onChange={(e) => set("sku", e.target.value)}
                    required
                    disabled={Boolean(id)}
                  />
                </Field>
                <Field label="Name">
                  <input value={values.name} onChange={(e) => set("name", e.target.value)} required />
                </Field>
                <Field label="Kind">
                  <select value={values.kind} onChange={(e) => set("kind", e.target.value)}>
                    <option value="PRODUCT">Product</option>
                    <option value="SERVICE">Service</option>
                  </select>
                </Field>
                <Field label="Unit">
                  <input value={values.internalUnit} onChange={(e) => set("internalUnit", e.target.value)} />
                </Field>
                <Field label="Sale price">
                  <input
                    value={values.salePrice}
                    onChange={(e) => set("salePrice", e.target.value)}
                    inputMode="decimal"
                  />
                </Field>
                <Field label="Tax rate" hint="A fraction: 0.16 is 16% IVA.">
                  <input value={values.taxRate} onChange={(e) => set("taxRate", e.target.value)} inputMode="decimal" />
                </Field>
                <Field label="Currency">
                  <input value={values.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
                </Field>
                <Field label="Track inventory">
                  <select value={values.trackInventory} onChange={(e) => set("trackInventory", e.target.value)}>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </Field>
                <Field label="SAT product code" hint="c_ClaveProdServ, needed before invoicing.">
                  <input value={values.satProductCode} onChange={(e) => set("satProductCode", e.target.value)} />
                </Field>
                <Field label="SAT unit code" hint="c_ClaveUnidad, e.g. H87.">
                  <input value={values.satUnitCode} onChange={(e) => set("satUnitCode", e.target.value)} />
                </Field>
              </div>
              <Field label="Description">
                <textarea value={values.description} onChange={(e) => set("description", e.target.value)} />
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

const COMPONENT_TYPES = [
  "MATERIAL",
  "PURCHASE_COST",
  "MACHINE_TIME",
  "EQUIPMENT_ALLOCATION",
  "ENERGY",
  "LABOR",
  "PACKAGING",
  "FREIGHT",
  "DELIVERY",
  "WASTE",
  "TRANSACTION_FEE",
  "MARKETPLACE_FEE",
  "FIXED_OVERHEAD",
  "VARIABLE_OVERHEAD",
  "OTHER",
];

interface ComponentRow {
  type: string;
  label: string;
  amount: string;
}

/**
 * Screen 10. Every number here comes from the pricing service. The browser
 * does no pricing arithmetic and neither does the agent (non-negotiable
 * #11): both read the same computed summary.
 */
export function ProductPricing() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const navigate = useNavigate();
  const [targetMargin, setTargetMargin] = useState("");

  const margin = Number(targetMargin);
  const useTarget = targetMargin !== "" && margin > 0 && margin < 1;
  const summary = useAsync(
    () =>
      useTarget
        ? call<PricingSummary>("pricing.calculate_target_price", { productId: id, targetMargin: margin })
        : call<PricingSummary>("pricing.calculate_true_cost", { productId: id }),
    [id, useTarget ? margin : null],
  );

  return (
    <Page title="Cost and price" actions={<button onClick={() => navigate(`/products/${id}`)}>Back</button>}>
      <Loaded state={summary}>
        {(row) => (
          <>
            <Card title="What it really costs">
              <div className="grid">
                <Field label="True estimated cost">
                  <div>{money(row.trueEstimatedCost, row.currency)}</div>
                </Field>
                <Field label="Break-even price">
                  <div>{money(row.breakEvenPrice, row.currency)}</div>
                </Field>
                <Field label="Current sale price">
                  <div>{money(row.currentSalePrice, row.currency)}</div>
                </Field>
                <Field label="Current margin">
                  <div>{percent(row.currentGrossMargin)}</div>
                </Field>
                <Field label="Current markup">
                  <div>{percent(row.currentMarkup)}</div>
                </Field>
                <Field label="Profit per unit">
                  <div>{money(row.profitPerUnitAtCurrentPrice, row.currency)}</div>
                </Field>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>Cost component</th>
                    <th>Type</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {row.costBreakdown.map((component, index) => (
                    <tr key={index}>
                      <td>{component.label}</td>
                      <td className="muted">{component.type}</td>
                      <td className="num">{money(component.amount, row.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Target margin">
              <Field label="Margin you want" hint="A fraction: 0.35 is 35%.">
                <input
                  value={targetMargin}
                  onChange={(e) => setTargetMargin(e.target.value)}
                  inputMode="decimal"
                  placeholder={row.targetMargin ?? "0.35"}
                />
              </Field>
              <p>
                Recommended price: <strong>{money(row.recommendedPriceForTargetMargin, row.currency)}</strong>
              </p>
              {can("pricing.write") ? (
                <PriceChange productId={id ?? ""} targetMargin={useTarget ? margin : undefined} />
              ) : null}
            </Card>

            <Scenarios productId={id ?? ""} currency={row.currency} />
            {can("pricing.write") ? <CostModelEditor productId={id ?? ""} onSaved={summary.reload} /> : null}
          </>
        )}
      </Loaded>
    </Page>
  );
}

/** A price change is a proposal, never a direct write. */
function PriceChange({ productId, targetMargin }: { productId: string; targetMargin?: number }) {
  const navigate = useNavigate();
  const [newSalePrice, setNewSalePrice] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      // An explicit price wins over the target margin; sending both would
      // leave the service to guess which one the user meant.
      const proposal = await send<Proposal>("POST", "/pricing/price-updates", {
        productId,
        ...(newSalePrice ? { newSalePrice } : targetMargin ? { targetMargin } : {}),
      });
      navigate(`/proposals/${proposal.id}`);
    } catch (cause) {
      setError(cause);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="row" style={{ marginTop: 12 }}>
        <input
          placeholder="Or a price of your own"
          value={newSalePrice}
          onChange={(e) => setNewSalePrice(e.target.value)}
          inputMode="decimal"
        />
        <button className="primary" disabled={busy} onClick={propose}>
          Propose this price
        </button>
      </div>
      {error ? <Banner kind="error">{errorMessage(error)}</Banner> : null}
    </>
  );
}

function Scenarios({ productId, currency }: { productId: string; currency: string }) {
  const [prices, setPrices] = useState("");
  const [rows, setRows] = useState<Scenario[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function compare() {
    setError(null);
    const scenarios = prices
      .split(",")
      .map((price) => price.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((salePrice) => ({ label: salePrice, salePrice }));
    if (scenarios.length === 0) return;
    try {
      setRows(await call<Scenario[]>("pricing.compare_scenarios", { productId, scenarios }));
    } catch (cause) {
      setError(cause);
    }
  }

  return (
    <Card title="What if we charged…">
      <div className="row">
        <input
          placeholder="Prices, comma separated: 250, 279.08, 300"
          value={prices}
          onChange={(e) => setPrices(e.target.value)}
          style={{ flex: 1 }}
        />
        <button onClick={compare}>Compare</button>
      </div>
      {error ? <Banner kind="error">{errorMessage(error)}</Banner> : null}
      {rows && rows.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Price</th>
              <th className="num">Margin</th>
              <th className="num">Markup</th>
              <th className="num">Profit per unit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{money(row.salePrice, currency)}</td>
                <td className="num">{percent(row.grossMargin)}</td>
                <td className="num">{percent(row.markup)}</td>
                <td className="num">{money(row.profitPerUnit, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Card>
  );
}

/**
 * Cost models are versioned: saving writes a new version rather than editing
 * the old one, so an invoice priced last month still explains itself.
 */
function CostModelEditor({ productId, onSaved }: { productId: string; onSaved: () => void }) {
  const [pattern, setPattern] = useState("RESALE");
  const [targetMargin, setTargetMargin] = useState("");
  const [components, setComponents] = useState<ComponentRow[]>([
    { type: "PURCHASE_COST", label: "Purchase price", amount: "" },
  ]);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function update(index: number, patch: Partial<ComponentRow>) {
    setComponents(components.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await send("POST", "/cost-models", {
        productId,
        pattern,
        ...(targetMargin ? { targetMargin } : {}),
        components: components.filter((row) => row.label && row.amount),
      });
      setSaved(true);
      onSaved();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="New cost model version">
      <form onSubmit={save}>
        <div className="grid">
          <Field label="Pattern">
            <select value={pattern} onChange={(e) => setPattern(e.target.value)}>
              <option value="RESALE">Resale</option>
              <option value="MANUFACTURED">Manufactured</option>
              <option value="SERVICE">Service</option>
            </select>
          </Field>
          <Field label="Target margin" hint="A fraction, optional.">
            <input value={targetMargin} onChange={(e) => setTargetMargin(e.target.value)} inputMode="decimal" />
          </Field>
        </div>

        {components.map((row, index) => (
          <div className="row" key={index}>
            <select value={row.type} onChange={(e) => update(index, { type: e.target.value })}>
              {COMPONENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <input
              placeholder="What it is"
              value={row.label}
              onChange={(e) => update(index, { label: e.target.value })}
              style={{ flex: 1 }}
            />
            <input
              placeholder="Amount"
              value={row.amount}
              onChange={(e) => update(index, { amount: e.target.value })}
              inputMode="decimal"
            />
            <button type="button" onClick={() => setComponents(components.filter((_, i) => i !== index))}>
              Remove
            </button>
          </div>
        ))}

        <div className="row" style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() => setComponents([...components, { type: "MATERIAL", label: "", amount: "" }])}
          >
            Add a cost
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save new version"}
          </button>
        </div>
        {error ? <Banner kind="error">{errorMessage(error)}</Banner> : null}
        {saved ? <Banner kind="ok">Saved. The numbers above now use this version.</Banner> : null}
      </form>
    </Card>
  );
}
