import { FiscalError } from "@maicora/shared";
import type {
  CancelRequest,
  CancelResult,
  FiscalEngine,
  StampRequest,
  StampResult,
} from "./types.js";

export interface FiscalEngineClientOptions {
  baseUrl: string;
  /** Shared secret for the service-to-service call; never a user credential. */
  apiKey?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the platform fetch. */
  fetchFn?: typeof fetch;
}

/**
 * HTTP client for the Python fiscal service. It carries no business rules:
 * it serialises a request, reports what came back, and lets the invoice
 * domain decide what that means (docs/mvp/07-invoicing-cfdi.md).
 */
export class FiscalEngineClient implements FiscalEngine {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: FiscalEngineClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  stamp(request: StampRequest): Promise<StampResult> {
    return this.post<StampResult>("/v1/stamp", request, request.idempotencyKey);
  }

  cancel(request: CancelRequest): Promise<CancelResult> {
    return this.post<CancelResult>("/v1/cancel", request, request.idempotencyKey);
  }

  private async post<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          ...(this.options.apiKey ? { "x-api-key": this.options.apiKey } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      // A transport failure is never a silent success: the caller must leave
      // the invoice unstamped rather than guess.
      throw new FiscalError(`Fiscal engine unreachable at ${this.baseUrl}${path}`, {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }

    const payload = await response.text();
    if (!response.ok) {
      throw new FiscalError(`Fiscal engine rejected ${path} with ${response.status}`, {
        status: response.status,
        body: payload.slice(0, 2000),
      });
    }

    try {
      return JSON.parse(payload) as T;
    } catch {
      throw new FiscalError(`Fiscal engine returned a non-JSON response from ${path}`, {
        body: payload.slice(0, 2000),
      });
    }
  }
}
