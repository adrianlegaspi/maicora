import { useState, type FormEvent } from "react";
import { send, session } from "../api.js";
import { useSession } from "../app.js";
import type { Membership } from "../types.js";
import { Banner, Card, Field, errorMessage } from "../ui.js";

/** Screen 2. Shown whenever no company is selected, including first sign-in. */
export function TenantSelector({ onSelected }: { onSelected: () => void }) {
  const { me } = useSession();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<unknown>(null);

  function choose(membership: Membership) {
    session.selectTenant(membership.tenantId);
    onSelected();
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const membership = await send<Membership>("POST", "/tenants", { name, slug });
      choose(membership);
    } catch (cause) {
      setError(cause);
    }
  }

  return (
    <div className="login" style={{ maxWidth: 480 }}>
      <Card title="Choose a company">
        {me.memberships.length === 0 ? (
          <p className="empty">You are not a member of any company yet. Create the first one below.</p>
        ) : (
          <table>
            <tbody>
              {me.memberships.map((membership) => (
                <tr key={membership.tenantId}>
                  <td>
                    <strong>{membership.tenantName}</strong>
                    <div className="muted">{membership.tenantSlug}</div>
                  </td>
                  <td className="muted">{membership.role}</td>
                  <td style={{ textAlign: "right" }}>
                    <button onClick={() => choose(membership)}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Create a company">
        <form onSubmit={create}>
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Slug" hint="Lowercase letters, numbers and hyphens.">
            <input value={slug} onChange={(e) => setSlug(e.target.value)} pattern="[a-z0-9-]+" required />
          </Field>
          {error ? <Banner kind="error">{errorMessage(error)}</Banner> : null}
          <button className="primary" type="submit" style={{ marginTop: 12 }}>
            Create
          </button>
        </form>
      </Card>
    </div>
  );
}
