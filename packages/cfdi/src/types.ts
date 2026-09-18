/**
 * The wire contract between the Node CFDI domain and the Python fiscal
 * service (docs/mvp/07-invoicing-cfdi.md, "Fiscal Engine"). Python owns the
 * fiscal mechanics; Node stays authoritative for authorization, tenant
 * context, invoice state, audit, persistence and idempotency, so nothing
 * here carries a tenant id or a permission - the caller has already resolved
 * both by the time a request is built.
 */
export type FiscalEnvironment = "SANDBOX" | "PRODUCTION";

export interface CfdiIssuer {
  rfc: string;
  name: string;
  /** SAT c_RegimenFiscal key, e.g. "601". */
  regimenFiscal: string;
  /** SAT c_CodigoPostal of the place of issuance. */
  lugarExpedicion: string;
  /**
   * Opaque references to the CSD certificate and private key in the fiscal
   * engine's own store. Raw key material never crosses this boundary.
   */
  csdCertRef: string;
  csdKeyRef: string;
}

export interface CfdiRecipient {
  rfc: string;
  name: string;
  /** SAT c_CodigoPostal of the recipient's fiscal address. */
  fiscalPostalCode: string;
  regimenFiscal: string;
  /** SAT c_UsoCFDI key, e.g. "G03". */
  cfdiUse: string;
}

export interface CfdiConcept {
  /** SAT c_ClaveProdServ key. */
  satProductCode: string;
  /** SAT c_ClaveUnidad key. */
  satUnitCode: string;
  unit: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRate: string;
  taxAmount: string;
  amount: string;
}

export interface StampRequest {
  environment: FiscalEnvironment;
  /** The fiscal engine returns the original stamp for a repeated key. */
  idempotencyKey: string;
  /** INGRESO for a sale, EGRESO for a credit note. */
  documentType: "INGRESO" | "EGRESO";
  issuer: CfdiIssuer;
  /** Null for a factura global, which is issued to the generic public RFC. */
  recipient: CfdiRecipient | null;
  currency: string;
  paymentForm: string;
  paymentMethod: string;
  concepts: CfdiConcept[];
  subtotal: string;
  taxTotal: string;
  total: string;
  /** Set on a credit note: the UUID of the invoice being corrected. */
  relatedUuid?: string;
  /** SAT c_TipoRelacion key, e.g. "01" for a credit note. */
  relationType?: string;
  /** Present only for a factura global. */
  globalPeriod?: { periodicity: string; months: string; year: number };
}

export interface StampResult {
  uuid: string;
  xml: string;
  stampedAt: string;
  satSeal: string;
  /** Base64 PDF, when the engine was asked to render one. */
  pdfBase64?: string;
}

export interface CancelRequest {
  environment: FiscalEnvironment;
  idempotencyKey: string;
  issuer: CfdiIssuer;
  uuid: string;
  /** SAT cancellation reason key: "01".."04". */
  reason: string;
  /** Required by the SAT when the reason is "01". */
  replacementUuid?: string;
}

export interface CancelResult {
  uuid: string;
  status: string;
  acknowledgementXml: string;
  cancelledAt: string;
}

/**
 * Two implementations exist by design: the HTTP client to the Python service,
 * and an in-process stub used by tests and by the sandbox-only setups that
 * have no PAC credentials yet.
 */
export interface FiscalEngine {
  stamp(request: StampRequest): Promise<StampResult>;
  cancel(request: CancelRequest): Promise<CancelResult>;
}
