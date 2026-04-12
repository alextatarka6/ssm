from fastapi import APIRouter, Request

from ..schemas import UserCreate

router = APIRouter(prefix="/users", tags=["users"])


@router.post("/", status_code=201)
def create_user(payload: UserCreate, request: Request) -> dict:
    engine = request.app.state.engine
    engine.set_user_default(payload.user_id, payload.initial_cash_cents)
    return {"ok": True}
