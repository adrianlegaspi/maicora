import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError } from "./api.js";

/**
 * The whole shared component vocabulary. Twenty-two screens of tables and
 * forms do not need a component library, and a design system would be more
 * code than the screens it serves.
 */
export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="page">
      <header className="page-head">
        <h1>{title}</h1>
        {actions ? <div className="row">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="card">
      {title ? <h2>{title}</h2> : null}
      {children}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Banner({ kind, children }: { kind: "error" | "ok" | "warn"; children: ReactNode }) {
  return <p className={`banner banner-${kind}`}>{children}</p>;
}

export function Badge({ value }: { value: string }) {
  return <span className={`badge badge-${value.toLowerCase().replace(/[^a-z]/g, "-")}`}>{value}</span>;
}

/** Numbers arrive from Postgres as strings with six decimals; show two. */
export function money(value: string | null | undefined, currency = "MXN"): string {
  if (value === null || value === undefined || value === "") return "-";
  const amount = Number(value);
  if (Number.isNaN(amount)) return value;
  return `${amount.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function quantity(value: string | null | undefined): string {
  if (!value) return "0";
  return String(Number(value));
}

export function percent(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

export function datetime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("es-MX") : "-";
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export interface Async<T> {
  data?: T;
  error?: unknown;
  loading: boolean;
  reload: () => void;
}

/**
 * Data loading, all of it. A cache layer would buy nothing here: these
 * screens are read-then-act, and a stale list after an approval is exactly
 * the bug the reload callback exists to prevent.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): Async<T> {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    load()
      .then((data) => !cancelled && setState({ data, loading: false }))
      .catch((error: unknown) => !cancelled && setState({ error, loading: false }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { ...state, loading: state.loading, reload: useCallback(() => setNonce((n) => n + 1), []) };
}

/** Renders the three states every list screen has, so no screen forgets one. */
export function Loaded<T>({ state, children }: { state: Async<T>; children: (data: T) => ReactNode }) {
  if (state.loading) return <p className="empty">Loading…</p>;
  if (state.error) return <Banner kind="error">{errorMessage(state.error)}</Banner>;
  if (state.data === undefined) return null;
  return <>{children(state.data)}</>;
}
