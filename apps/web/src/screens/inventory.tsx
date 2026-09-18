import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { call, get, send } from "../api.js";
import { useSession } from "../app.js";
import type { Movement, Product, Proposal, StockLevel, Warehouse } from "../types.js";
import {
  Banner,
  Card,
  Empty,
  Field,
  Loaded,
  Page,
  datetime,
  errorMessage,
  quantity,
  useAsync,
} from "../ui.js";

/** Screen 11. */
export function InventoryOverview() {
  const { can } = useSession();
  const [warehouseId, setWarehouseId] = useState("");
  const [threshold, setThreshold] = useState("5");
  const warehouses = useAsync(() => get<Warehouse[]>("/warehouses"), []);
  const stock = useAsync(
    () => call<StockLevel[]>("inventory.get_stock", { warehouseId: warehouseId || undefined }),
    [warehouseId],
  );
  const low = useAsync(
    () => call<StockLevel[]>("inventory.find_low_stock", { threshold, warehouseId: warehouseId || undefined }),
    [threshold, warehouseId],
  );

  return (
    <Page
      title="Inventory"
      actions={
        <>
          <Loaded state={warehouses}>
            {(rows) => (
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">Every warehouse</option>
                {rows.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.code} · {warehouse.name}
                  </option>
                ))}
              </select>
            )}
          </Loaded>
          {can("inventory.adjust.propose") ? (
            <Link className="button primary" to="/inventory/adjust">
              Correct a count
            </Link>
          ) : null}
        </>
      }
    >
      <Card title="Running low">
        <Field label="At or below" hint="Units on hand.">
          <input value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="decimal" />
        </Field>
        <Loaded state={low}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty>Nothing is below that.</Empty>
            ) : (
              <StockTable rows={rows} />
            )
          }
        </Loaded>
      </Card>

      <Card title="Everything on hand">
        <Loaded state={stock}>
          {(rows) => (rows.length === 0 ? <Empty>No stock recorded yet.</Empty> : <StockTable rows={rows} />)}
        </Loaded>
      </Card>
    </Page>
  );
}

function StockTable({ rows }: { rows: StockLevel[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>SKU</th>
          <th>Product</th>
          <th>Warehouse</th>
          <th className="num">On hand</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.productId}:${row.warehouseId}`}>
            <td>
              <Link to={`/inventory/${row.productId}`}>{row.sku}</Link>
            </td>
            <td>{row.name}</td>
            <td className="muted">{row.warehouseCode}</td>
            <td className="num">{quantity(row.quantityOnHand)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Screen 12. The ledger, not a balance: every movement that produced the
 * current quantity, because the quantity is derived from these rows and
 * nothing writes it directly (non-negotiable #7).
 */
export function InventoryProduct() {
  const { productId } = useParams<{ productId: string }>();
  const { can } = useSession();
  const navigate = useNavigate();
  const product = useAsync(() => call<Product>("products.get", { productId }), [productId]);
  const stock = useAsync(() => call<StockLevel[]>("inventory.get_stock", { productId }), [productId]);
  const movements = useAsync(
    () => call<Movement[]>("inventory.get_movements", { productId, limit: 200 }),
    [productId],
  );

  return (
    <Page
      title="Stock ledger"
      actions={
        <>
          <button onClick={() => navigate("/inventory")}>Back</button>
          {can("inventory.adjust.propose") ? (
            <Link className="button" to={`/inventory/adjust?productId=${productId}`}>
              Correct this count
            </Link>
          ) : null}
        </>
      }
    >
      <Loaded state={product}>
        {(row) => (
          <Card title={`${row.sku} · ${row.name}`}>
            <Loaded state={stock}>{(levels) => <StockTable rows={levels} />}</Loaded>
          </Card>
        )}
      </Loaded>

      <Card title="Movements">
        <Loaded state={movements}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty>Nothing has moved yet.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th className="num">Quantity</th>
                    <th>Why</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((movement) => (
                    <tr key={movement.id}>
                      <td className="muted">{datetime(movement.createdAt)}</td>
                      <td>{movement.movementType}</td>
                      <td className="num">
                        {movement.direction === "OUT" ? "-" : "+"}
                        {quantity(movement.quantity)}
                      </td>
                      <td>{movement.reason ?? <span className="muted">-</span>}</td>
                      <td className="muted">{movement.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Loaded>
      </Card>
    </Page>
  );
}

/**
 * Screen 13. The form asks for the counted quantity, not a delta: the
 * executor recomputes the movement against live stock when the proposal is
 * approved, so a sale in between does not get silently overwritten.
 */
export function InventoryAdjustment() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [productId, setProductId] = useState(params.get("productId") ?? "");
  const [warehouseId, setWarehouseId] = useState("");
  const [countedQuantity, setCountedQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const warehouses = useAsync(() => get<Warehouse[]>("/warehouses"), []);
  const products = useAsync(() => call<Product[]>("products.search", { limit: 100 }), []);
  const current = useAsync(
    async () => (productId ? call<StockLevel[]>("inventory.get_stock", { productId }) : []),
    [productId],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const proposal = await send<Proposal>("POST", "/inventory/adjustments", {
        productId,
        countedQuantity,
        reason,
        ...(warehouseId ? { warehouseId } : {}),
      });
      navigate(`/proposals/${proposal.id}`);
    } catch (cause) {
      setError(cause);
      setBusy(false);
    }
  }

  return (
    <Page title="Correct a count" actions={<button onClick={() => navigate(-1)}>Cancel</button>}>
      <Card>
        <form onSubmit={submit}>
          <div className="grid">
            <Field label="Product">
              <Loaded state={products}>
                {(rows) => (
                  <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
                    <option value="">Pick one</option>
                    {rows
                      .filter((product) => product.trackInventory)
                      .map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.sku} · {product.name}
                        </option>
                      ))}
                  </select>
                )}
              </Loaded>
            </Field>
            <Field label="Warehouse" hint="Left empty, the default warehouse is used.">
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
            <Field label="Counted quantity" hint="What you actually counted, not the difference.">
              <input
                value={countedQuantity}
                onChange={(e) => setCountedQuantity(e.target.value)}
                inputMode="decimal"
                required
              />
            </Field>
          </div>

          {productId ? (
            <Loaded state={current}>
              {(levels) =>
                levels.length === 0 ? (
                  <p className="muted">The system has no stock recorded for this product.</p>
                ) : (
                  <p className="muted">
                    The system currently says:{" "}
                    {levels.map((level) => `${level.warehouseCode} ${quantity(level.quantityOnHand)}`).join(", ")}
                  </p>
                )
              }
            </Loaded>
          ) : null}

          <Field label="Why" hint="Recorded with the movement and read by whoever approves it.">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
          </Field>

          {error ? <Banner kind="error">{errorMessage(error)}</Banner> : null}
          <button className="primary" type="submit" disabled={busy} style={{ marginTop: 12 }}>
            {busy ? "Drafting…" : "Draft the correction"}
          </button>
        </form>
      </Card>
    </Page>
  );
}
