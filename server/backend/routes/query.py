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
    return "?" if _is_sqlite(conn) else "%s"


def _placeholders(conn: Any, count: int) -> str:
    return ", ".join(_param(conn, idx + 1) for idx in range(count))


def _parse_row(row: Any) -> dict:
    if hasattr(row, "keys"):
        return {k: row[k] for k in row.keys()}
    return dict(row)


def _get_open_sell_order_shares(engine: Any, asset_id: str) -> int:
    return sum(
        order.remaining_qty
        for order in engine.orders.values()
        if order.asset_id == asset_id
        and order.side == "SELL"
        and order.status in ("OPEN", "PARTIALLY_FILLED")
        and order.remaining_qty > 0
    )


@router.get("/assets", response_model=list[AssetResponse])
def list_assets(request: Request):
    with get_connection() as conn:
        if _is_sqlite(conn):
            engine = request.app.state.engine
            return [
                AssetResponse(
                    asset_id=asset.asset_id,
                    issuer_user_id=asset.issuer_user_id,
                    issuer_username=None,
                    total_supply=asset.total_supply,
                    name=asset.name,
                    last_price_cents=engine.last_price_cents.get(asset.asset_id),
                    sell_order_shares=_get_open_sell_order_shares(engine, asset.asset_id),
                )
                for asset in engine.assets.values()
            ]

        cur = conn.cursor(row_factory=dict_row)
        try:
            cur.execute(
                """
                select
                  a.asset_id,
                  a.issuer_auth_user_id::text as issuer_user_id,
                  p.username as issuer_username,
                  a.total_supply,
                  a.name,
                  (
                    select t.price_cents
                    from public.trades t
                    where t.asset_id = a.asset_id
                    order by t.ts_seq desc, t.id desc
                    limit 1
                  ) as last_price_cents,
                  coalesce((
                    select sum(o.remaining_qty)
                    from public.orders o
                    where o.asset_id = a.asset_id
                      and o.side = 'SELL'
                      and o.status in ('OPEN', 'PARTIALLY_FILLED')
                      and o.remaining_qty > 0
                  ), 0) as sell_order_shares
                from public.assets a
                join public.profiles p on p.id = a.issuer_auth_user_id
                order by a.created_at asc, a.asset_id asc
                """
            )
            rows = cur.fetchall()
        finally:
            cur.close()

    return [AssetResponse(**_parse_row(row)) for row in rows]


@router.get("/assets/{asset_id}", response_model=AssetResponse)
def get_asset(asset_id: str, request: Request):
    with get_connection() as conn:
        if _is_sqlite(conn):
            engine = request.app.state.engine
            asset = engine.assets.get(asset_id)
            if asset is None:
                raise HTTPException(status_code=404, detail="asset not found")
            return AssetResponse(
                asset_id=asset.asset_id,
                issuer_user_id=asset.issuer_user_id,
                issuer_username=None,
                total_supply=asset.total_supply,
                name=asset.name,
                last_price_cents=engine.last_price_cents.get(asset.asset_id),
                sell_order_shares=_get_open_sell_order_shares(engine, asset.asset_id),
            )

        cur = conn.cursor(row_factory=dict_row)
        try:
            cur.execute(
                """
                select
                  a.asset_id,
                  a.issuer_auth_user_id::text as issuer_user_id,
                  p.username as issuer_username,
                  a.total_supply,
                  a.name,
                  (
                    select t.price_cents
                    from public.trades t
                    where t.asset_id = a.asset_id
                    order by t.ts_seq desc, t.id desc
                    limit 1
                  ) as last_price_cents,
                  coalesce((
                    select sum(o.remaining_qty)
                    from public.orders o
                    where o.asset_id = a.asset_id
                      and o.side = 'SELL'
                      and o.status in ('OPEN', 'PARTIALLY_FILLED')
                      and o.remaining_qty > 0
                  ), 0) as sell_order_shares
                from public.assets a
                join public.profiles p on p.id = a.issuer_auth_user_id
                where a.asset_id = %s
                limit 1
                """,
                (asset_id,),
            )
            row = cur.fetchone()
        finally:
            cur.close()

    if row is None:
        raise HTTPException(status_code=404, detail="asset not found")
    return AssetResponse(**_parse_row(row))


@router.get("/assets/{asset_id}/trades", response_model=list[TradeResponse])
def get_asset_trades(asset_id: str, limit: int = Query(100, ge=1, le=1000)):
    with get_connection() as conn:
        cur = conn.cursor(row_factory=dict_row)
        try:
            if _is_sqlite(conn):
                query = (
                    "SELECT id, ts_seq, asset_id, price_cents, qty, buy_order_id, sell_order_id, buyer_id, seller_id "
                    "FROM trades WHERE asset_id = " + _param(conn, 1) + " ORDER BY ts_seq ASC LIMIT " + _param(conn, 2)
                )
                cur.execute(query, (asset_id, limit))  # type: ignore[arg-type]
            else:
                cur.execute(
                    """
                    SELECT
                      id,
                      ts_seq,
                      asset_id,
                      price_cents,
                      qty,
                      buy_order_id,
                      sell_order_id,
                      buyer_auth_user_id::text AS buyer_id,
                      seller_auth_user_id::text AS seller_id
                    FROM public.trades
                    WHERE asset_id = %s
                    ORDER BY ts_seq ASC, id ASC
                    LIMIT %s
                    """,
                    (asset_id, limit),
                )
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
    with get_connection() as conn:
        if _is_sqlite(conn):
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

        cur = conn.cursor(row_factory=dict_row)
        try:
            cur.execute(
                """
                select auth_user_id::text as user_id, cash_cents, reserved_cash_cents
                from public.user_accounts
                where auth_user_id = %s
                limit 1
                """,
                (user_id,),
            )
            account_row = cur.fetchone()
            if account_row is None:
                raise HTTPException(status_code=404, detail="user not found")

            cur.execute(
                """
                select
                  h.asset_id,
                  h.shares,
                  h.reserved_shares,
                  latest_trade.price_cents as last_price_cents
                from public.holdings h
                left join lateral (
                  select t.price_cents
                  from public.trades t
                  where t.asset_id = h.asset_id
                  order by t.ts_seq desc, t.id desc
                  limit 1
                ) latest_trade on true
                where h.auth_user_id = %s
                order by h.created_at asc, h.asset_id asc
                """,
                (user_id,),
            )
            holding_rows = cur.fetchall()
        finally:
            cur.close()

    holdings = [
        HoldingResponse(
            asset_id=row["asset_id"],
            shares=row["shares"],
            reserved_shares=row["reserved_shares"],
            last_price_cents=row["last_price_cents"],
            market_value_cents=(row["last_price_cents"] or 0) * row["shares"],
        )
        for row in holding_rows
    ]

    return UserPortfolioResponse(
        user_id=account_row["user_id"],
        cash_cents=account_row["cash_cents"],
        reserved_cash_cents=account_row["reserved_cash_cents"],
        holdings=holdings,
    )
