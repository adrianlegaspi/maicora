"""PAC providers.

A PAC is the authorised certification provider that seals a CFDI and files it
with the SAT. Only the mock provider ships: a real one needs a contract, a
CSD and credentials, none of which a sandbox install has. Adding one means a
class with the same two methods and an entry in `PROVIDERS` - nothing above
this module changes.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from xml.etree import ElementTree as ET

from . import cfdi
from .models import CancelRequest, CancelResult, StampRequest, StampResult


class PacError(RuntimeError):
    """The PAC refused the document. The caller must not record a stamp."""


class MockPac:
    """Sandbox provider: structurally real CFDI, deterministically fake seal.

    The UUID is derived from the idempotency key, so a retry that gets past
    the response cache still lands on the same document rather than inventing
    a new one. The seal is a digest, not a signature: sealing needs a CSD.
    """

    name = "mock"

    def stamp(self, request: StampRequest) -> StampResult:
        cfdi.validate(request)
        issued_at = datetime.now(timezone.utc)

        comprobante = cfdi.build_xml(request, issued_at)
        document_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"maicora:{request.idempotencyKey}"))
        seal = hashlib.sha256(
            ET.tostring(comprobante, encoding="utf-8") + request.issuer.csdCertRef.encode()
        ).hexdigest()

        return StampResult(
            uuid=document_uuid,
            xml=cfdi.attach_timbre(comprobante, document_uuid, seal, issued_at),
            stampedAt=issued_at.isoformat(),
            satSeal=seal,
        )

    def cancel(self, request: CancelRequest) -> CancelResult:
        if request.reason not in cfdi.CANCELLATION_REASONS:
            raise cfdi.FiscalValidationError(f"Unknown SAT cancellation reason {request.reason}")
        # Reason 01 is "emitido con errores con relacion": the replacement
        # CFDI has to exist before the SAT will accept the cancellation.
        if request.reason == "01" and not request.replacementUuid:
            raise cfdi.FiscalValidationError("Cancellation reason 01 requires the replacement UUID")

        cancelled_at = datetime.now(timezone.utc)
        return CancelResult(
            uuid=request.uuid,
            status="Cancelado sin aceptacion",
            acknowledgementXml=(
                f'<Acuse Fecha="{cancelled_at.isoformat()}" RfcEmisor="{request.issuer.rfc}">'
                f'<Folios><UUID>{request.uuid}</UUID><EstatusUUID>201</EstatusUUID></Folios>'
                f"</Acuse>"
            ),
            cancelledAt=cancelled_at.isoformat(),
        )


PROVIDERS = {MockPac.name: MockPac}


def get_pac(provider: str):
    factory = PROVIDERS.get(provider)
    if factory is None:
        raise PacError(f"Unknown PAC provider {provider!r}; configured providers: {sorted(PROVIDERS)}")
    return factory()
