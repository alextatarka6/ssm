from typing import Any

from fastapi import APIRouter, Request

from ..db import get_connection
from ..persist import persist_engine_results, sync_engine_from_database
from ..schemas import OrderCreate, OrderResponse, OrderSubmissionResponse, TradeResponse

router = APIRouter(prefix="/orders", tags=["orders"])


def _serialize_order(order: Any) -> dict:
    return {
        "id": order.id,
        "user_id": order.user_id,
        "asset_id": order.asset_id,
        "side": order.side,
        "qty": order.qty,
        "remaining_qty": order.remaining_qty,
        "limit_price_cents": order.limit_price_cents,
        "status": order.status,
        "seq": order.seq,
    }


def _serialize_trade(trade: Any) -> dict:
    return {
        "id": trade.id,
        "asset_id": trade.asset_id,
        "price_cents": trade.price_cents,
        "qty": trade.qty,
        "buy_order_id": trade.buy_order_id,
        "sell_order_id": trade.sell_order_id,
        "buyer_id": trade.buyer_id,
        "seller_id": trade.seller_id,
    }


@router.post("/", response_model=OrderSubmissionResponse, status_code=201)
def place_order(payload: OrderCreate, request: Request) -> dict:
    engine = request.app.state.engine
    with get_connection() as conn:
        sync_engine_from_database(engine, conn)

    order, trades = engine.process_order(payload)

    with get_connection() as conn:
        with conn.transaction():
            persist_engine_results(conn, events=engine.events, order=order, trades=trades, engine=engine)

    engine.events = []
    return {
        "order": _serialize_order(order),
        "trades": [_serialize_trade(trade) for trade in trades],
    }


@router.post("/{order_id}/cancel", response_model=OrderResponse)
def cancel_order(order_id: int, request: Request) -> dict:
    engine = request.app.state.engine
    with get_connection() as conn:
        sync_engine_from_database(engine, conn)

    order = engine.cancel_order(order_id)

    with get_connection() as conn:
        with conn.transaction():
            persist_engine_results(conn, events=engine.events, order=order, trades=[], engine=engine)

    engine.events = []
    return _serialize_order(order)
