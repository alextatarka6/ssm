from fastapi import APIRouter, Request

from ..db import get_connection
from ..persist import persist_engine_results
from ..schemas import UserCreate

router = APIRouter(prefix="/users", tags=["users"])


@router.post("/", status_code=201)
def create_user(payload: UserCreate, request: Request) -> dict:
    engine = request.app.state.engine
    engine.set_user_default(payload.user_id, payload.initial_cash_cents)

    if engine.events:
        with get_connection() as conn:
            with conn.transaction():
                persist_engine_results(conn, events=engine.events, order=None, trades=[])
        engine.events = []

    return {"ok": True}
