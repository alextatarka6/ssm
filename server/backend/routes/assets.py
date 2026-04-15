from fastapi import APIRouter, HTTPException, Request

from ..db import get_connection
from ..persist import persist_engine_results, sync_engine_from_database
from ..schemas import AssetCreate, AssetUpdate

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


@router.put("/{asset_id}")
def update_asset(asset_id: str, payload: AssetUpdate, request: Request) -> dict:
    engine = request.app.state.engine
    normalized_name = payload.name.strip()
    if not normalized_name:
        raise HTTPException(status_code=400, detail="Stock label cannot be empty.")

    with get_connection() as conn:
        if getattr(conn, "is_sqlite", False):
            asset = engine.assets.get(asset_id)
            if asset is None:
                raise HTTPException(status_code=404, detail="asset not found")
            if asset.issuer_user_id != payload.issuer_user_id:
                raise HTTPException(status_code=403, detail="Only the issuer can update this stock label.")

            engine.assets[asset_id] = asset.__class__(
                asset_id=asset.asset_id,
                issuer_user_id=asset.issuer_user_id,
                total_supply=asset.total_supply,
                name=normalized_name,
            )
            return {"ok": True}

        with conn.transaction():
            cur = conn.cursor()
            try:
                cur.execute(
                    """
                    update public.assets
                    set name = %s,
                        updated_at = timezone('utc', now())
                    where asset_id = %s
                      and issuer_auth_user_id = %s::uuid
                    returning asset_id
                    """,
                    (normalized_name, asset_id, payload.issuer_user_id),
                )
                row = cur.fetchone()
            finally:
                cur.close()

        if row is None:
            raise HTTPException(status_code=404, detail="asset not found for this issuer")

        sync_engine_from_database(engine, conn)

    return {"ok": True}
