# Fiscal Engine

CFDI 4.0 stamping and cancellation, split out of the Node backend because the
fiscal mechanics live in Python (`python-satcfdi`) - see
`docs/mvp/07-invoicing-cfdi.md`. Node stays authoritative for authorization,
tenant context, invoice state, proposals, audit, persistence and idempotency;
this service only builds, seals and transmits documents.

## Endpoints

- `POST /v1/stamp` - build a CFDI and get it stamped by the configured PAC.
- `POST /v1/cancel` - cancel a stamped CFDI at the SAT.
- `GET /healthz`

Both write endpoints require `x-api-key` matching `FISCAL_ENGINE_SHARED_SECRET`
and honour `idempotency-key`: a repeated key returns the original response
rather than issuing a second document.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `FISCAL_ENGINE_SHARED_SECRET` | _unset_ | Service-to-service key. Unset disables the check (local only). |
| `PAC_PROVIDER` | `mock` | `mock` for sandbox. A real provider plugs into `app/pac.py`. |
| `CSD_DIR` | `./csd` | Where `csdCertRef`/`csdKeyRef` resolve to key material. |

## Status

The `mock` provider issues deterministic UUIDs and a structurally valid but
**unsealed** CFDI 4.0 document. Real sealing needs a CSD and a PAC contract:
drop the certificate into `CSD_DIR`, add the provider in `app/pac.py`, and set
`PAC_PROVIDER`. Nothing above that line changes.

## Running

```bash
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8090
pytest
```
