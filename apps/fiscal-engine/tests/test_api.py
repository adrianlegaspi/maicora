from xml.etree import ElementTree as ET

import pytest
from fastapi.testclient import TestClient

from app.cfdi import CFDI_NS, TFD_NS
from app.main import _cancellations, _stamps, app

client = TestClient(app)

ISSUER = {
    "rfc": "EKU9003173C9",
    "name": "ESCUELA KEMPER URGATE",
    "regimenFiscal": "601",
    "lugarExpedicion": "64000",
    "csdCertRef": "ref:cert",
    "csdKeyRef": "ref:key",
}

CONCEPT = {
    "satProductCode": "01010101",
    "satUnitCode": "H87",
    "unit": "pza",
    "description": "Widget",
    "quantity": "10",
    "unitPrice": "600.00",
    "discount": "0",
    "taxRate": "0.16",
    "taxAmount": "960.00",
    "amount": "6000.00",
}


def stamp_request(**overrides):
    request = {
        "environment": "SANDBOX",
        "idempotencyKey": "proposal:1",
        "documentType": "INGRESO",
        "issuer": ISSUER,
        "recipient": {
            "rfc": "TNO950101AB1",
            "name": "ACME SA DE CV",
            "fiscalPostalCode": "64000",
            "regimenFiscal": "601",
            "cfdiUse": "G03",
        },
        "currency": "MXN",
        "paymentForm": "03",
        "paymentMethod": "PUE",
        "concepts": [CONCEPT],
        "subtotal": "6000.00",
        "taxTotal": "960.00",
        "total": "6960.00",
    }
    request.update(overrides)
    return request


@pytest.fixture(autouse=True)
def clear_caches():
    _stamps.clear()
    _cancellations.clear()


def test_stamps_a_cfdi_with_a_timbre():
    response = client.post("/v1/stamp", json=stamp_request())
    assert response.status_code == 200, response.text

    body = response.json()
    root = ET.fromstring(body["xml"])
    assert root.get("Version") == "4.0"
    assert root.get("TipoDeComprobante") == "I"
    assert root.find(f"{{{CFDI_NS}}}Emisor").get("Rfc") == ISSUER["rfc"]
    assert root.find(f".//{{{TFD_NS}}}TimbreFiscalDigital").get("UUID") == body["uuid"]


def test_returns_the_original_stamp_for_a_repeated_idempotency_key():
    first = client.post("/v1/stamp", json=stamp_request()).json()
    second = client.post("/v1/stamp", json=stamp_request(total="9999.00")).json()

    # The second request is not even looked at: the key already has a CFDI.
    assert second["uuid"] == first["uuid"]
    assert second["xml"] == first["xml"]


def test_refuses_a_document_whose_total_disagrees_with_its_concepts():
    response = client.post("/v1/stamp", json=stamp_request(total="1.00"))
    assert response.status_code == 422
    assert "does not match" in response.json()["detail"]


def test_refuses_an_egreso_with_nothing_to_relate_to():
    response = client.post("/v1/stamp", json=stamp_request(documentType="EGRESO"))
    assert response.status_code == 422


def test_factura_global_uses_the_generic_rfc_and_carries_its_period():
    response = client.post(
        "/v1/stamp",
        json=stamp_request(
            recipient=None,
            globalPeriod={"periodicity": "04", "months": "01", "year": 2026},
        ),
    )
    assert response.status_code == 200, response.text

    root = ET.fromstring(response.json()["xml"])
    assert root.find(f"{{{CFDI_NS}}}Receptor").get("Rfc") == "XAXX010101000"
    assert root.find(f"{{{CFDI_NS}}}InformacionGlobal").get("Meses") == "01"


def test_cancels_a_stamped_cfdi():
    uuid = client.post("/v1/stamp", json=stamp_request()).json()["uuid"]
    response = client.post(
        "/v1/cancel",
        json={
            "environment": "SANDBOX",
            "idempotencyKey": "cancel:1",
            "issuer": ISSUER,
            "uuid": uuid,
            "reason": "02",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["uuid"] == uuid


def test_cancellation_reason_01_needs_the_replacement_uuid():
    response = client.post(
        "/v1/cancel",
        json={
            "environment": "SANDBOX",
            "idempotencyKey": "cancel:2",
            "issuer": ISSUER,
            "uuid": "00000000-0000-4000-8000-000000000001",
            "reason": "01",
        },
    )
    assert response.status_code == 422


def test_rejects_a_request_without_the_shared_secret(monkeypatch):
    monkeypatch.setenv("FISCAL_ENGINE_SHARED_SECRET", "s3cret")
    assert client.post("/v1/stamp", json=stamp_request()).status_code == 401
    assert (
        client.post(
            "/v1/stamp", json=stamp_request(), headers={"x-api-key": "s3cret"}
        ).status_code
        == 200
    )
