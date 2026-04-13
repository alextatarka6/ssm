from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .engine import (
    MatchingEngine,
    InsufficientFunds,
    InsufficientShares,
    UnknownUser,
    UnknownAsset,
)
from .db import get_connection
from .persist import sync_engine_from_database
from .routes.users import router as users_router
from .routes.assets import router as assets_router
from .routes.orders import router as orders_router
from .routes.query import router as query_router

app = FastAPI(title="SSM Trading API")
engine = MatchingEngine()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup_event() -> None:
    with get_connection() as conn:
        sync_engine_from_database(engine, conn)
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

app.include_router(users_router, prefix="/api")
app.include_router(assets_router, prefix="/api")
app.include_router(orders_router, prefix="/api")
app.include_router(query_router, prefix="/api")

frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
