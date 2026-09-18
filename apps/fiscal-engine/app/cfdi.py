"""CFDI 4.0 document construction and the fiscal validation Python owns."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from xml.etree import ElementTree as ET

from .models import StampRequest

CFDI_NS = "http://www.sat.gob.mx/cfd/4"
TFD_NS = "http://www.sat.gob.mx/TimbreFiscalDigital"

# The generic RFC the SAT reserves for receipts to the general public.
RFC_PUBLICO_GENERAL = "XAXX010101000"

# c_TipoDeComprobante
DOCUMENT_TYPE_CODES = {"INGRESO": "I", "EGRESO": "E"}

# c_MotivoCancelacion
CANCELLATION_REASONS = {"01", "02", "03", "04"}


class FiscalValidationError(ValueError):
    """A document the SAT would reject. Raised before anything is transmitted."""


def _d(value: str) -> Decimal:
    try:
        return Decimal(value)
    except Exception as exc:  # noqa: BLE001 - the message is what matters here
        raise FiscalValidationError(f"{value!r} is not a decimal amount") from exc


def validate(request: StampRequest) -> None:
    """Rejects documents the PAC would bounce, with a reason a human can act on.

    This is the boundary check: Node computed the amounts, but a mismatch
    between its totals and its concepts must never reach the SAT.
    """
    concept_base = sum(_d(c.amount) for c in request.concepts)
    concept_tax = sum(_d(c.taxAmount) for c in request.concepts)

    if concept_base != _d(request.subtotal):
        raise FiscalValidationError(
            f"Subtotal {request.subtotal} does not match the sum of concepts {concept_base}"
        )
    if concept_tax != _d(request.taxTotal):
        raise FiscalValidationError(
            f"Tax total {request.taxTotal} does not match the sum of concept taxes {concept_tax}"
        )
    if _d(request.total) != concept_base + concept_tax:
        raise FiscalValidationError(
            f"Total {request.total} does not match subtotal plus taxes {concept_base + concept_tax}"
        )

    if request.documentType == "EGRESO" and not request.relatedUuid:
        raise FiscalValidationError("An egreso must relate to the CFDI it corrects")
    if request.relatedUuid and not request.relationType:
        raise FiscalValidationError("A related CFDI needs a c_TipoRelacion key")

    # A factura global replaces the receptor with the generic RFC and carries
    # the period it covers; one without the other is not a valid document.
    if request.recipient is None and request.globalPeriod is None:
        raise FiscalValidationError("A CFDI without a recipient must carry its global period")


def build_xml(request: StampRequest, issued_at: datetime) -> ET.Element:
    """Builds the unstamped Comprobante. The PAC adds the TimbreFiscalDigital."""
    ET.register_namespace("cfdi", CFDI_NS)
    ET.register_namespace("tfd", TFD_NS)

    comprobante = ET.Element(
        f"{{{CFDI_NS}}}Comprobante",
        {
            "Version": "4.0",
            "Fecha": issued_at.strftime("%Y-%m-%dT%H:%M:%S"),
            "Moneda": request.currency,
            "SubTotal": request.subtotal,
            "Total": request.total,
            "TipoDeComprobante": DOCUMENT_TYPE_CODES[request.documentType],
            "Exportacion": "01",
            "FormaPago": request.paymentForm,
            "MetodoPago": request.paymentMethod,
            "LugarExpedicion": request.issuer.lugarExpedicion,
        },
    )

    if request.relatedUuid and request.relationType:
        relacionados = ET.SubElement(
            comprobante, f"{{{CFDI_NS}}}CfdiRelacionados", {"TipoRelacion": request.relationType}
        )
        ET.SubElement(relacionados, f"{{{CFDI_NS}}}CfdiRelacionado", {"UUID": request.relatedUuid})

    ET.SubElement(
        comprobante,
        f"{{{CFDI_NS}}}Emisor",
        {
            "Rfc": request.issuer.rfc,
            "Nombre": request.issuer.name,
            "RegimenFiscal": request.issuer.regimenFiscal,
        },
    )

    if request.recipient is None:
        # Factura global: the receptor is the general public, and the period
        # travels in the InformacionGlobal node.
        ET.SubElement(
            comprobante,
            f"{{{CFDI_NS}}}Receptor",
            {
                "Rfc": RFC_PUBLICO_GENERAL,
                "Nombre": "PUBLICO EN GENERAL",
                "DomicilioFiscalReceptor": request.issuer.lugarExpedicion,
                "RegimenFiscalReceptor": "616",
                "UsoCFDI": "S01",
            },
        )
        period = request.globalPeriod
        assert period is not None  # guaranteed by validate()
        ET.SubElement(
            comprobante,
            f"{{{CFDI_NS}}}InformacionGlobal",
            {"Periodicidad": period.periodicity, "Meses": period.months, "Año": str(period.year)},
        )
    else:
        ET.SubElement(
            comprobante,
            f"{{{CFDI_NS}}}Receptor",
            {
                "Rfc": request.recipient.rfc,
                "Nombre": request.recipient.name,
                "DomicilioFiscalReceptor": request.recipient.fiscalPostalCode,
                "RegimenFiscalReceptor": request.recipient.regimenFiscal,
                "UsoCFDI": request.recipient.cfdiUse,
            },
        )

    conceptos = ET.SubElement(comprobante, f"{{{CFDI_NS}}}Conceptos")
    for concept in request.concepts:
        node = ET.SubElement(
            conceptos,
            f"{{{CFDI_NS}}}Concepto",
            {
                "ClaveProdServ": concept.satProductCode,
                "Cantidad": concept.quantity,
                "ClaveUnidad": concept.satUnitCode,
                "Unidad": concept.unit,
                "Descripcion": concept.description,
                "ValorUnitario": concept.unitPrice,
                "Importe": concept.amount,
                "Descuento": concept.discount,
                "ObjetoImp": "02" if _d(concept.taxAmount) > 0 else "01",
            },
        )
        if _d(concept.taxAmount) > 0:
            impuestos = ET.SubElement(node, f"{{{CFDI_NS}}}Impuestos")
            traslados = ET.SubElement(impuestos, f"{{{CFDI_NS}}}Traslados")
            ET.SubElement(
                traslados,
                f"{{{CFDI_NS}}}Traslado",
                {
                    "Base": concept.amount,
                    "Impuesto": "002",  # IVA
                    "TipoFactor": "Tasa",
                    "TasaOCuota": f"{_d(concept.taxRate):.6f}",
                    "Importe": concept.taxAmount,
                },
            )

    if _d(request.taxTotal) > 0:
        impuestos = ET.SubElement(
            comprobante, f"{{{CFDI_NS}}}Impuestos", {"TotalImpuestosTrasladados": request.taxTotal}
        )
        traslados = ET.SubElement(impuestos, f"{{{CFDI_NS}}}Traslados")
        ET.SubElement(
            traslados,
            f"{{{CFDI_NS}}}Traslado",
            {
                "Base": request.subtotal,
                "Impuesto": "002",
                "TipoFactor": "Tasa",
                "TasaOCuota": "0.160000",
                "Importe": request.taxTotal,
            },
        )

    return comprobante


def attach_timbre(comprobante: ET.Element, uuid: str, seal: str, stamped_at: datetime) -> str:
    """Adds the TimbreFiscalDigital the PAC returned and serialises the document."""
    complemento = ET.SubElement(comprobante, f"{{{CFDI_NS}}}Complemento")
    ET.SubElement(
        complemento,
        f"{{{TFD_NS}}}TimbreFiscalDigital",
        {
            "Version": "1.1",
            "UUID": uuid,
            "FechaTimbrado": stamped_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
            "SelloCFD": seal,
        },
    )
    return ET.tostring(comprobante, encoding="unicode")
