import { FiscalError } from "@maicora/shared";
import type {
  CancelRequest,
  CancelResult,
  FiscalEngine,
  StampRequest,
  StampResult,
} from "./types.js";

/**
 * In-process fiscal engine for tests and for sandbox setups with no PAC
 * credentials yet. It performs no fiscal validation - it only honours the
 * idempotency contract the real engine guarantees, so callers can be written
 * and tested against the same behaviour.
 */
export class StubFiscalEngine implements FiscalEngine {
  private readonly stamps = new Map<string, StampResult>();
  private readonly cancellations = new Map<string, CancelResult>();
  private sequence = 0;

  /** Set to make the next stamp fail, standing in for a PAC rejection. */
  failNextStamp?: string;

  async stamp(request: StampRequest): Promise<StampResult> {
    if (this.failNextStamp) {
      const message = this.failNextStamp;
      this.failNextStamp = undefined;
      throw new FiscalError(message, { idempotencyKey: request.idempotencyKey });
    }

    const existing = this.stamps.get(request.idempotencyKey);
    if (existing) return existing;

    this.sequence += 1;
    const result: StampResult = {
      uuid: `00000000-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`,
      xml: `<cfdi:Comprobante Total="${request.total}"/>`,
      stampedAt: new Date().toISOString(),
      satSeal: `stub-seal-${this.sequence}`,
    };
    this.stamps.set(request.idempotencyKey, result);
    return result;
  }

  async cancel(request: CancelRequest): Promise<CancelResult> {
    const existing = this.cancellations.get(request.idempotencyKey);
    if (existing) return existing;

    const result: CancelResult = {
      uuid: request.uuid,
      status: "Cancelado sin aceptacion",
      acknowledgementXml: `<Acuse UUID="${request.uuid}"/>`,
      cancelledAt: new Date().toISOString(),
    };
    this.cancellations.set(request.idempotencyKey, result);
    return result;
  }
}
