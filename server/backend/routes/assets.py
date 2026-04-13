from fastapi import APIRouter, Request

from ..db import get_connection
from ..persist import persist_engine_results, sync_engine_from_database
from ..schemas import AssetCreate

router = APIRouter(prefix="/assets", tags=["assets"])


@router.post("/", status_code=201)
def create_asset(payload: AssetCreate, request: Request) -> dict:
    engine = request.app.state.engine
    with get_connection() as conn:
        sync_engine_from_database(engine, conn)

    engine.create_person_asset(
        issuer_user_id=payload.issuer_user_id,
        asset_id=payload.asset_id,
        total_supply=payload.total_supply,
        issuer_pct=payload.issuer_pct,
        name=payload.name,
    )

    with get_connection() as conn:
        with conn.transaction():
            persist_engine_results(conn, events=engine.events, order=None, trades=[], engine=engine)

    # Drain events after persistence so the engine does not resend them
    engine.events = []
    return {"ok": True}
