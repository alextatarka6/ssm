from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from psycopg.rows import dict_row

from ..db import get_connection
from ..schemas import (
    AssetResponse,
    CandleBar,
    CandleResponse,
    HoldingResponse,
    TradeResponse,
    UserPortfolioResponse,
)

router = APIRouter(tags=["query"])


def _is_sqlite(conn: Any) -> bool:
    return getattr(conn, "is_sqlite", False)


def _param(conn: Any, index: int) -> str:
    return "?" if _is_sqlite(conn) else f"${index}"


def _placeholders(conn: Any, count: int) -> str:
    return ", ".join(_param(conn, idx + 1) for idx in range(count))


def _parse_row(row: Any) -> dict:
    if hasattr(row, "keys"):
        return {k: row[k] for k in row.keys()}
    return dict(row)


@router.get("/assets", response_model=list[AssetResponse])
def list_assets(request: Request):
    engine = request.app.state.engine
    return [
        AssetResponse(
            asset_id=asset.asset_id,
            issuer_user_id=asset.issuer_user_id,
            total_supply=asset.total_supply,
            name=asset.name,
            last_price_cents=engine.last_price_cents.get(asset.asset_id),
        )
        for asset in engine.assets.values()
    ]


@router.get("/assets/{asset_id}", response_model=AssetResponse)
def get_asset(asset_id: str, request: Request):
    engine = request.app.state.engine
    asset = engine.assets.get(asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    return AssetResponse(
        asset_id=asset.asset_id,
        issuer_user_id=asset.issuer_user_id,
        total_supply=asset.total_supply,
        name=asset.name,
        last_price_cents=engine.last_price_cents.get(asset.asset_id),
    )


@router.get("/assets/{asset_id}/trades", response_model=list[TradeResponse])
def get_asset_trades(asset_id: str, limit: int = Query(100, ge=1, le=1000)):
    with get_connection() as conn:
        cur = conn.cursor(row_factory=dict_row)
        try:
            query = (
                "SELECT id, ts_seq, asset_id, price_cents, qty, buy_order_id, sell_order_id, buyer_id, seller_id "
                "FROM trades WHERE asset_id = " + _param(conn, 1) + " ORDER BY ts_seq ASC LIMIT " + _param(conn, 2)
            )
            cur.execute(query, (asset_id, limit))  # type: ignore[arg-type]
            rows = cur.fetchall()
        finally:
            cur.close()

    return [TradeResponse(**_parse_row(row)) for row in rows]


@router.get("/assets/{asset_id}/candles", response_model=CandleResponse)
def get_asset_candles(
    asset_id: str,
    interval_trades: int = Query(5, ge=1, le=50),
    limit: int = Query(50, ge=1, le=200),
):
    with get_connection() as conn:
        cur = conn.cursor(row_factory=dict_row)
        try:
            query = (
                "SELECT price_cents FROM trades WHERE asset_id = " + _param(conn, 1) + " ORDER BY ts_seq ASC LIMIT " + _param(conn, 2)
            )
            cur.execute(query, (asset_id, limit * interval_trades))  # type: ignore[arg-type]
            rows = cur.fetchall()
        finally:
            cur.close()

    prices = [row["price_cents"] / 100.0 for row in rows]
    if not prices:
        raise HTTPException(status_code=404, detail="no trade history for asset")

    bars = []
    for i in range(0, len(prices), interval_trades):
        window = prices[i : i + interval_trades]
        bars.append(
            {
                "time": i // interval_trades,
                "open": window[0],
                "high": max(window),
                "low": min(window),
                "close": window[-1],
            }
        )

    ha_bars = []
    prev_ha_open = (bars[0]["open"] + bars[0]["close"]) / 2
    prev_ha_close = (bars[0]["open"] + bars[0]["high"] + bars[0]["low"] + bars[0]["close"]) / 4
    for bar in bars:
        ha_close = (bar["open"] + bar["high"] + bar["low"] + bar["close"]) / 4
        ha_open = (prev_ha_open + prev_ha_close) / 2
        ha_high = max(bar["high"], ha_open, ha_close)
        ha_low = min(bar["low"], ha_open, ha_close)

        ha_bars.append(
            CandleBar(
                time=bar["time"],
                open=bar["open"],
                high=bar["high"],
                low=bar["low"],
                close=bar["close"],
                ha_open=ha_open,
                ha_high=ha_high,
                ha_low=ha_low,
                ha_close=ha_close,
            )
        )

        prev_ha_open = ha_open
        prev_ha_close = ha_close

    return CandleResponse(asset_id=asset_id, bars=ha_bars)


@router.get("/users/{user_id}/portfolio", response_model=UserPortfolioResponse)
def get_user_portfolio(user_id: str, request: Request):
    engine = request.app.state.engine
    if user_id not in engine.accounts:
        raise HTTPException(status_code=404, detail="user not found")

    holdings = []
    for (holder_id, asset_id), holding in engine.holdings.items():
        if holder_id != user_id:
            continue
        last_price = engine.last_price_cents.get(asset_id)
        market_value = (last_price or 0) * holding.shares
        holdings.append(
            HoldingResponse(
                asset_id=asset_id,
                shares=holding.shares,
                reserved_shares=holding.reserved_shares,
                last_price_cents=last_price,
                market_value_cents=market_value,
            )
        )

    account = engine.accounts[user_id]
    return UserPortfolioResponse(
        user_id=user_id,
        cash_cents=account.cash_cents,
        reserved_cash_cents=account.reserved_cash_cents,
        holdings=holdings,
    )
