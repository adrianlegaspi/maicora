import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { get, send } from "../api.js";
import type { Proposal, Warehouse } from "../types.js";
import { Banner, Card, Field, Loaded, Page, errorMessage, useAsync } from "../ui.js";

const TEMPLATES: Record<string, string> = {
  CUSTOMERS: "displayName,rfc,email,taxRegime,fiscalPostalCode",
  PRODUCTS: "sku,name,salePrice,taxRate,unit,satProductCode,satUnitCode",
  OPENING_STOCK: "sku,quantity",
};

/**
 * Bulk import. The file never becomes rows on its own: the CSV is parsed
 * server-side into one proposal whose diff says exactly how many records
 * would be created, changed or skipped, and a person approves that.
 */
export function BulkImport() {
  const navigate = useNavigate();
  const [kind, setKind] = useState("CUSTOMERS");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const warehouses = useAsync(() => get<Warehouse[]>("/warehouses"), []);

  async function pick(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const proposal = await send<Proposal>("POST", "/imports/prepare", {
        kind,
        csv,
        ...(kind === "OPENING_STOCK" && warehouseId ? { warehouseId } : {}),
      });
      navigate(`/proposals/${proposal.id}`);
    } catch (cause) {
      setError(cause);
      setBusy(false);
    }
  }

  return (
    <Page title="Bulk import">
      <Card>
        <div className="grid">
          <Field label="What is in the file">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="CUSTOMERS">Customers</option>
              <option value="PRODUCTS">Products</option>
              <option value="OPENING_STOCK">Opening stock</option>
            </select>
          </Field>
          {kind === "OPENING_STOCK" ? (
            <Field label="Warehouse">
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
          ) : null}
        </div>

        <Field label="CSV file" hint={`Expected columns: ${TEMPLATES[kind] ?? ""}`}>
          <input type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files?.[0])} />
        </Field>

        {csv ? (
          <>
            <p className="muted">
              {fileName} · {csv.split("\n").filter(Boolean).length - 1} rows
            </p>
            <pre className="json">{csv.split("\n").slice(0, 6).join("\n")}</pre>
          </>
        ) : null}

        <Field label="Or paste it">
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={8} />
        </Field>

        {error ? <Banner kind="error">{errorMessage(error)}</Banner> : null}
        <button className="primary" disabled={busy || !csv} onClick={submit} style={{ marginTop: 12 }}>
          {busy ? "Reading…" : "Check the file"}
        </button>
      </Card>
    </Page>
  );
}
