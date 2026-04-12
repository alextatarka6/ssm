from fastapi import APIRouter, Request

from ..db import get_connection
from ..persist import persist_engine_results
from ..schemas import AssetCreate

router = APIRouter(prefix="/assets", tags=["assets"])


@router.post("/", status_code=201)
def create_asset(payload: AssetCreate, request: Request) -> dict:
    engine = request.app.state.engine
    engine.create_person_asset(
        issuer_user_id=payload.issuer_user_id,
        asset_id=payload.asset_id,
        total_supply=payload.total_supply,
        name=payload.name,
    )

    with get_connection() as conn:
        with conn.transaction():
            persist_engine_results(conn, events=engine.events, order=None, trades=[])

    # Drain events after persistence so the engine does not resend them
    engine.events = []
    return {"ok": True}
