import { describe, expect, it } from "vitest";
import { FiscalError } from "@maicora/shared";
import { FiscalEngineClient } from "./client.js";
import type { StampRequest } from "./types.js";

const request: StampRequest = {
  environment: "SANDBOX",
  idempotencyKey: "inv-1",
  documentType: "INGRESO",
  issuer: {
    rfc: "EKU9003173C9",
    name: "ESCUELA KEMPER URGATE",
    regimenFiscal: "601",
    lugarExpedicion: "64000",
    csdCertRef: "ref:cert",
    csdKeyRef: "ref:key",
  },
  recipient: {
    rfc: "TNO950101AB1",
    name: "Taller Norte SA de CV",
    fiscalPostalCode: "64000",
    regimenFiscal: "601",
    cfdiUse: "G03",
  },
  currency: "MXN",
  paymentForm: "03",
  paymentMethod: "PUE",
  concepts: [],
  subtotal: "100.00",
  taxTotal: "16.00",
  total: "116.00",
};

describe("FiscalEngineClient", () => {
  it("posts the request with its idempotency key and returns the stamp", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = new FiscalEngineClient({
      baseUrl: "http://fiscal:8000/",
      apiKey: "secret",
      fetchFn: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return new Response(JSON.stringify({ uuid: "UUID-1", xml: "<cfdi/>", stampedAt: "t", satSeal: "s" }));
      }) as unknown as typeof fetch,
    });

    const result = await client.stamp(request);

    expect(result.uuid).toBe("UUID-1");
    // The trailing slash on baseUrl must not produce a doubled path separator.
    expect(seen?.url).toBe("http://fiscal:8000/v1/stamp");
    expect((seen?.init.headers as Record<string, string>)["idempotency-key"]).toBe("inv-1");
    expect((seen?.init.headers as Record<string, string>)["x-api-key"]).toBe("secret");
  });

  it("raises a fiscal error rather than reporting a stamp the engine refused", async () => {
    const client = new FiscalEngineClient({
      baseUrl: "http://fiscal:8000",
      fetchFn: (async () => new Response("CSD expired", { status: 422 })) as unknown as typeof fetch,
    });

    await expect(client.stamp(request)).rejects.toBeInstanceOf(FiscalError);
  });

  it("raises a fiscal error when the engine is unreachable", async () => {
    const client = new FiscalEngineClient({
      baseUrl: "http://fiscal:8000",
      fetchFn: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });

    await expect(client.stamp(request)).rejects.toBeInstanceOf(FiscalError);
  });
});
