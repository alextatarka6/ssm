from fastapi import APIRouter, Request

from ..db import get_connection
from ..persist import persist_engine_results, sync_engine_from_database
from ..schemas import UserCreate

router = APIRouter(prefix="/users", tags=["users"])


@router.post("/", status_code=201)
def create_user(payload: UserCreate, request: Request) -> dict:
    engine = request.app.state.engine
    with get_connection() as conn:
        if getattr(conn, "is_sqlite", False):
            engine.set_user_default(payload.user_id, payload.initial_cash_cents)
            if engine.events:
                with conn.transaction():
                    persist_engine_results(conn, events=engine.events, order=None, trades=[], engine=engine)
                engine.events = []
        else:
            with conn.transaction():
                cur = conn.cursor()
                try:
                    cur.execute("SELECT public.ensure_initial_market_state_for_user(%s::uuid)", (payload.user_id,))
                finally:
                    cur.close()
            sync_engine_from_database(engine, conn)

    return {"ok": True}
