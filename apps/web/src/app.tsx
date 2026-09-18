import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { ApiError, get, session } from "./api.js";
import type { Me } from "./types.js";
import { Banner } from "./ui.js";
import { Login } from "./screens/login.js";
import { TenantSelector } from "./screens/tenants.js";
import { AgentWorkspace } from "./screens/agent.js";
import { CustomerDetail, CustomerForm, CustomerList } from "./screens/customers.js";
import { ProductDetail, ProductForm, ProductList, ProductPricing } from "./screens/products.js";
import { InventoryAdjustment, InventoryOverview, InventoryProduct } from "./screens/inventory.js";
import { InvoiceDetail, InvoiceDraft, InvoiceList } from "./screens/invoices.js";
import { ProposalDetail, ProposalList } from "./screens/proposals.js";
import { History } from "./screens/history.js";
import { BulkImport } from "./screens/imports.js";
import { AiSettings, CsdSetup, FiscalSettingsScreen, TeamSettings } from "./screens/settings.js";

interface SessionState {
  me: Me;
  reload: () => void;
  can: (permission: string) => boolean;
}

const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const state = useContext(SessionContext);
  if (!state) throw new Error("useSession used outside the signed-in shell");
  return state;
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const [token, setToken] = useState(session.token);

  useEffect(() => {
    if (!token) {
      setMe(null);
      return;
    }
    get<Me>("/me")
      .then(setMe)
      .catch((cause: unknown) => {
        // An expired or rejected token means the stored session is worthless.
        if (cause instanceof ApiError && cause.status === 401) {
          session.signOut();
          setToken(null);
        } else {
          setError(cause);
        }
      });
  }, [token, nonce]);

  if (!token) {
    return (
      <Routes>
        <Route
          path="*"
          element={
            <Login
              onSignedIn={() => {
                setToken(session.token);
                setNonce((n) => n + 1);
              }}
            />
          }
        />
      </Routes>
    );
  }

  if (error) return <Banner kind="error">{String(error)}</Banner>;
  if (!me) return <p className="empty" style={{ padding: 24 }}>Loading…</p>;

  const value: SessionState = {
    me,
    reload: () => setNonce((n) => n + 1),
    can: (permission) => me.actor?.permissions.includes(permission) ?? false,
  };

  return (
    <SessionContext.Provider value={value}>
      {me.actor ? <Shell /> : <TenantSelector onSelected={() => setNonce((n) => n + 1)} />}
    </SessionContext.Provider>
  );
}

function Shell() {
  const { me, can } = useSession();
  const navigate = useNavigate();
  const tenant = me.memberships.find((membership) => membership.tenantId === me.actor?.tenantId);

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">Maicora</div>
        <NavLink to="/" end>
          Agent
        </NavLink>

        <div className="group">Business</div>
        {can("customers.read") ? <NavLink to="/customers">Customers</NavLink> : null}
        {can("products.read") ? <NavLink to="/products">Products</NavLink> : null}
        {can("inventory.read") ? <NavLink to="/inventory">Inventory</NavLink> : null}
        {can("invoices.read") ? <NavLink to="/invoices">Invoices</NavLink> : null}

        <div className="group">Governance</div>
        {can("proposals.read") ? <NavLink to="/proposals">Proposals</NavLink> : null}
        {can("audit.read") ? <NavLink to="/history">History</NavLink> : null}

        <div className="group">Setup</div>
        {can("customers.write") ? <NavLink to="/imports">Bulk import</NavLink> : null}
        {can("fiscal.settings.manage") ? <NavLink to="/settings/fiscal">Fiscal settings</NavLink> : null}
        {can("fiscal.settings.manage") ? <NavLink to="/settings/csd">CSD &amp; PAC</NavLink> : null}
        {can("users.manage") ? <NavLink to="/settings/team">Team</NavLink> : null}
        {can("ai.settings.manage") ? <NavLink to="/settings/ai">AI</NavLink> : null}

        <div className="tenant">
          <div>{tenant?.tenantName ?? "No company"}</div>
          <div>{me.actor?.roles.join(", ")}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button
              onClick={() => {
                localStorage.removeItem("maicora.tenant");
                navigate("/");
                location.reload();
              }}
            >
              Switch
            </button>
            <button
              onClick={() => {
                session.signOut();
                location.reload();
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <main className="content">
        <Routes>
          <Route path="/" element={<AgentWorkspace />} />
          <Route path="/customers" element={<CustomerList />} />
          <Route path="/customers/new" element={<CustomerForm />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          <Route path="/customers/:id/edit" element={<CustomerForm />} />
          <Route path="/products" element={<ProductList />} />
          <Route path="/products/new" element={<ProductForm />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/products/:id/edit" element={<ProductForm />} />
          <Route path="/products/:id/pricing" element={<ProductPricing />} />
          <Route path="/inventory" element={<InventoryOverview />} />
          <Route path="/inventory/adjust" element={<InventoryAdjustment />} />
          <Route path="/inventory/:productId" element={<InventoryProduct />} />
          <Route path="/invoices" element={<InvoiceList />} />
          <Route path="/invoices/new" element={<InvoiceDraft />} />
          <Route path="/invoices/:id" element={<InvoiceDetail />} />
          <Route path="/proposals" element={<ProposalList />} />
          <Route path="/proposals/:id" element={<ProposalDetail />} />
          <Route path="/history" element={<History />} />
          <Route path="/imports" element={<BulkImport />} />
          <Route path="/settings/fiscal" element={<FiscalSettingsScreen />} />
          <Route path="/settings/csd" element={<CsdSetup />} />
          <Route path="/settings/team" element={<TeamSettings />} />
          <Route path="/settings/ai" element={<AiSettings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
