import { useState, type FormEvent } from "react";
import { send, session } from "../api.js";
import { Banner, Card, Field, errorMessage } from "../ui.js";

/** Screen 1. The password is posted to our API, which talks to Supabase; the browser never does. */
export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { accessToken } = await send<{ accessToken: string }>("POST", "/auth/login", { email, password });
      session.signIn(accessToken);
      onSignedIn();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <Card title="Sign in to Maicora">
        <form onSubmit={submit}>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Password">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error ? <Banner kind="error">{errorMessage(error)}</Banner> : null}
          <button className="primary" type="submit" disabled={busy} style={{ marginTop: 12 }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </Card>
    </div>
  );
}
