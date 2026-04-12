import os
import sys
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

# Ensure the repository root is on sys.path so engine_py imports correctly.
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from engine_py.engine import (
    MatchingEngine,
    InsufficientFunds,
    InsufficientShares,
    UnknownUser,
    UnknownAsset,
)
from .db import get_connection
from .persist import load_all_events, load_all_orders
from .routes.users import router as users_router
from .routes.assets import router as assets_router
from .routes.orders import router as orders_router

app = FastAPI(title="SSM Trading API")
engine = MatchingEngine()

@app.on_event("startup")
def startup_event() -> None:
    with get_connection() as conn:
        events = load_all_events(conn)
        orders = load_all_orders(conn)
    engine.rebuild_from_events(events, active_orders=orders)
    app.state.engine = engine

@app.exception_handler(UnknownUser)
async def unknown_user_handler(request: Request, exc: UnknownUser):
    return JSONResponse(status_code=404, content={"detail": str(exc)})

@app.exception_handler(UnknownAsset)
async def unknown_asset_handler(request: Request, exc: UnknownAsset):
    return JSONResponse(status_code=404, content={"detail": str(exc)})

@app.exception_handler(InsufficientFunds)
async def insufficient_funds_handler(request: Request, exc: InsufficientFunds):
    return JSONResponse(status_code=400, content={"detail": str(exc)})

@app.exception_handler(InsufficientShares)
async def insufficient_shares_handler(request: Request, exc: InsufficientShares):
    return JSONResponse(status_code=400, content={"detail": str(exc)})

@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})

app.include_router(users_router)
app.include_router(assets_router)
app.include_router(orders_router)
