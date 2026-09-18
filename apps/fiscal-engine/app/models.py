"""Wire contract with the Node CFDI domain.

Mirrors packages/cfdi/src/types.ts. Nothing here carries a tenant id or a
permission: the caller resolved both before building the request.
"""

from typing import Literal

from pydantic import BaseModel, Field

Environment = Literal["SANDBOX", "PRODUCTION"]


class Issuer(BaseModel):
    rfc: str
    name: str
    regimenFiscal: str
    lugarExpedicion: str
    # Opaque references into this service's own store. Raw key material never
    # crosses the boundary from Node.
    csdCertRef: str
    csdKeyRef: str


class Recipient(BaseModel):
    rfc: str
    name: str
    fiscalPostalCode: str
    regimenFiscal: str
    cfdiUse: str


class Concept(BaseModel):
    satProductCode: str
    satUnitCode: str
    unit: str
    description: str
    quantity: str
    unitPrice: str
    discount: str
    taxRate: str
    taxAmount: str
    amount: str


class GlobalPeriod(BaseModel):
    periodicity: str
    months: str
    year: int


class StampRequest(BaseModel):
    environment: Environment
    idempotencyKey: str
    documentType: Literal["INGRESO", "EGRESO"]
    issuer: Issuer
    # Null for a factura global, which is issued to the generic public RFC.
    recipient: Recipient | None = None
    currency: str
    paymentForm: str
    paymentMethod: str
    concepts: list[Concept] = Field(min_length=1)
    subtotal: str
    taxTotal: str
    total: str
    relatedUuid: str | None = None
    relationType: str | None = None
    globalPeriod: GlobalPeriod | None = None


class StampResult(BaseModel):
    uuid: str
    xml: str
    stampedAt: str
    satSeal: str
    pdfBase64: str | None = None


class CancelRequest(BaseModel):
    environment: Environment
    idempotencyKey: str
    issuer: Issuer
    uuid: str
    reason: str
    replacementUuid: str | None = None


class CancelResult(BaseModel):
    uuid: str
    status: str
    acknowledgementXml: str
    cancelledAt: str
