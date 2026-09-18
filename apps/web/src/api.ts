const BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

const TOKEN_KEY = "maicora.token";
const TENANT_KEY = "maicora.tenant";

export const session = {
  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  get tenantId(): string | null {
    return localStorage.getItem(TENANT_KEY);
  },
  signIn(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  },
  selectTenant(tenantId: string): void {
    localStorage.setItem(TENANT_KEY, tenantId);
  },
  signOut(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TENANT_KEY);
  },
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = { "content-type": "application/json", ...extra };
  const token = session.token;
  const tenantId = session.tenantId;
  if (token) out.authorization = `Bearer ${token}`;
  // Every tenant-scoped call carries the company explicitly; the backend
  // re-checks the membership rather than trusting this header.
  if (tenantId) out["x-tenant-id"] = tenantId;
  return out;
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const body = await response.text();
  const payload = body ? (JSON.parse(body) as unknown) : null;

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "INTERNAL",
      error?.message ?? `Request failed (${response.status})`,
      error?.details,
    );
  }
  return payload as T;
}

export async function get<T>(path: string, query: Record<string, string | undefined> = {}): Promise<T> {
  const search = new URLSearchParams(
    Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const suffix = search.toString() ? `?${search}` : "";
  return parse<T>(await fetch(`${BASE}/api${path}${suffix}`, { headers: headers() }));
}

export async function send<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(`${BASE}/api${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

/**
 * Reads go through the capability registry, which is also what the agent
 * calls. A screen and the agent therefore see exactly the same data under
 * exactly the same permission check - they cannot drift apart
 * (docs/mvp/08-agent.md).
 */
export async function call<T>(capability: string, input: Record<string, unknown> = {}): Promise<T> {
  return send<T>("POST", `/capabilities/${capability}`, input);
}

export interface AgentEvent {
  type: "text" | "tool_start" | "tool_result" | "tool_error" | "done" | "error";
  delta?: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  message?: string;
  conversationId?: string;
}

/**
 * The agent reply arrives as server-sent events. `fetch` is used instead of
 * `EventSource` because the request is a POST that carries the bearer token,
 * and EventSource can send neither.
 */
export async function* streamAgent(
  body: { message: string; conversationId?: string },
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const response = await fetch(`${BASE}/api/agent/messages`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    await parse(response);
    return;
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;

    // SSE frames are separated by a blank line; a frame may arrive in pieces.
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame.startsWith("data: ") ? frame.slice(6) : undefined;
      if (data) yield JSON.parse(data) as AgentEvent;
      boundary = buffer.indexOf("\n\n");
    }
  }
}
