"""HTTP surface of the fiscal engine (docs/mvp/07-invoicing-cfdi.md).

Node owns authorization, tenant context, invoice state, proposals, audit and
persistence. This service owns fiscal mechanics, and nothing else: it never
sees a tenant id, a user, or the database.
"""

from __future__ import annotations

import os
import secrets

from fastapi import Depends, FastAPI, Header, HTTPException

from .cfdi import FiscalValidationError
from .models import CancelRequest, CancelResult, StampRequest, StampResult
from .pac import PacError, get_pac

app = FastAPI(title="Maicora Fiscal Engine", version="0.1.0")

# Idempotency is enforced by Node at the proposal level; this cache is the
# second line, covering a retry that never reached Node's result.
# ponytail: process-local, so it only helps a single instance. Move to Redis
# or a small table when the service runs more than one replica.
_stamps: dict[str, StampResult] = {}
_cancellations: dict[str, CancelResult] = {}


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    expected = os.environ.get("FISCAL_ENGINE_SHARED_SECRET")
    # Unset means local development with no secret to check against. A
    # deployment that wants the check simply sets the variable.
    if not expected:
        return
    if not x_api_key or not secrets.compare_digest(x_api_key, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing x-api-key")


def _pac():
    try:
        return get_pac(os.environ.get("PAC_PROVIDER", "mock"))
    except PacError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "pac": os.environ.get("PAC_PROVIDER", "mock")}


@app.post("/v1/stamp", response_model=StampResult, dependencies=[Depends(require_api_key)])
def stamp(request: StampRequest) -> StampResult:
    cached = _stamps.get(request.idempotencyKey)
    if cached is not None:
        return cached

    try:
        result = _pac().stamp(request)
    except FiscalValidationError as exc:
        # 422: the document is wrong, so retrying it unchanged will not help.
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except PacError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    _stamps[request.idempotencyKey] = result
    return result


@app.post("/v1/cancel", response_model=CancelResult, dependencies=[Depends(require_api_key)])
def cancel(request: CancelRequest) -> CancelResult:
    cached = _cancellations.get(request.idempotencyKey)
    if cached is not None:
        return cached

    try:
        result = _pac().cancel(request)
    except FiscalValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except PacError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    _cancellations[request.idempotencyKey] = result
    return result
