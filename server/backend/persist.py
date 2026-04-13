import json
from typing import Any, Dict, List, Optional

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .engine import Account, Asset, Book, EventType, Holding, Order, OrderStatus, Side, TREASURY_USER, set_generator_state


def _is_sqlite(conn: Any) -> bool:
    return getattr(conn, "is_sqlite", False)


def _get_value(record: Any, key: str) -> Any:
    if isinstance(record, dict):
        return record[key]
    return getattr(record, key)


def _param(conn: Any, index: int) -> str:
    return "?" if _is_sqlite(conn) else "%s"


def _placeholders(conn: Any, count: int) -> str:
    return ", ".join(_param(conn, idx + 1) for idx in range(count))


def _load_generator_state(conn: Any) -> Dict[str, int]:
    cur = conn.cursor(row_factory=dict_row)
    try:
        if _is_sqlite(conn):
            cur.execute(
                """
                SELECT
                  COALESCE((SELECT MAX(id) FROM orders), 0) AS max_order_id,
                  COALESCE((SELECT MAX(id) FROM trades), 0) AS max_trade_id,
                  COALESCE((SELECT MAX(id) FROM events), 0) AS max_event_id,
                  COALESCE((SELECT MAX(seq) FROM orders), 0) AS max_order_seq,
                  COALESCE((SELECT MAX(ts_seq) FROM trades), 0) AS max_trade_seq,
                  COALESCE((SELECT MAX(ts_seq) FROM events), 0) AS max_event_seq
                """
            )
        else:
            cur.execute(
                """
                SELECT
                  COALESCE((SELECT MAX(id) FROM public.orders), 0) AS max_order_id,
                  COALESCE((SELECT MAX(id) FROM public.trades), 0) AS max_trade_id,
                  COALESCE((SELECT MAX(id) FROM public.events), 0) AS max_event_id,
                  COALESCE((SELECT MAX(seq) FROM public.orders), 0) AS max_order_seq,
                  COALESCE((SELECT MAX(ts_seq) FROM public.trades), 0) AS max_trade_seq,
                  COALESCE((SELECT MAX(ts_seq) FROM public.events), 0) AS max_event_seq
                """
            )
        row = cur.fetchone()
    finally:
        cur.close()

    max_seq = max(row["max_order_seq"], row["max_trade_seq"], row["max_event_seq"])
    return {
        "next_order_id": row["max_order_id"] + 1,
        "next_trade_id": row["max_trade_id"] + 1,
        "next_seq": max_seq + 1,
        "next_event_id": row["max_event_id"] + 1,
    }


def _sync_generators_from_database(conn: Any) -> None:
    set_generator_state(**_load_generator_state(conn))


def _trade_sequence_by_id(events: List[Any]) -> Dict[int, int]:
    seq_by_trade_id: Dict[int, int] = {}
    for event in events:
        event_type = _get_value(event, "type")
        if event_type not in (EventType.TRADE_EXECUTED, EventType.TRADE_EXECUTED.value):
            continue

        data = _get_value(event, "data")
        trade_id = data.get("trade_id")
        if trade_id is None:
            continue
        seq_by_trade_id[trade_id] = _get_value(event, "ts_seq")
    return seq_by_trade_id


def _resolve_trade_ts_seq(trade: Any, trade_seq_by_id: Dict[int, int]) -> int:
    if isinstance(trade, dict) and "ts_seq" in trade:
        return trade["ts_seq"]

    trade_ts_seq = getattr(trade, "ts_seq", None)
    if trade_ts_seq is not None:
        return trade_ts_seq

    trade_id = _get_value(trade, "id")
    if trade_id not in trade_seq_by_id:
        raise ValueError(f"Missing TRADE_EXECUTED event sequence for trade {trade_id}")
    return trade_seq_by_id[trade_id]


def load_all_events(conn: Any) -> List[Dict[str, Any]]:
    cur = conn.cursor(row_factory=dict_row)
    try:
        cur.execute("SELECT id, ts_seq, type, data FROM events ORDER BY ts_seq ASC, id ASC")
        rows = cur.fetchall()
    finally:
        cur.close()

    events = []
    for row in rows:
        event_data = row["data"]
        if isinstance(event_data, str):
            event_data = json.loads(event_data)
        events.append({"id": row["id"], "ts_seq": row["ts_seq"], "type": row["type"], "data": event_data})
    return events


def load_all_orders(conn: Any) -> List[Dict[str, Any]]:
    cur = conn.cursor(row_factory=dict_row)
    try:
        if _is_sqlite(conn):
            cur.execute(
                "SELECT id, user_id, asset_id, side, qty, remaining_qty, limit_price_cents, status, seq FROM orders ORDER BY seq ASC"
            )
        else:
            cur.execute(
                """
                SELECT
                  id,
                  auth_user_id::text AS user_id,
                  asset_id,
                  side,
                  qty,
                  remaining_qty,
                  limit_price_cents,
                  status,
                  seq
                FROM public.orders
                ORDER BY seq ASC
                """
            )
        return cur.fetchall()
    finally:
        cur.close()


def sync_engine_from_database(engine: Any, conn: Any) -> None:
    if _is_sqlite(conn):
        events = load_all_events(conn)
        orders = load_all_orders(conn)
        engine.rebuild_from_events(events, active_orders=orders)
        _sync_generators_from_database(conn)
        return

    cur = conn.cursor(row_factory=dict_row)
    try:
        cur.execute(
            """
            SELECT
              auth_user_id::text AS user_id,
              cash_cents,
              reserved_cash_cents
            FROM public.user_accounts
            """
        )
        account_rows = cur.fetchall()

        cur.execute(
            """
            SELECT
              a.asset_id,
              a.issuer_auth_user_id::text AS issuer_user_id,
              a.total_supply,
              a.name,
              (
                SELECT t.price_cents
                FROM public.trades t
                WHERE t.asset_id = a.asset_id
                ORDER BY t.ts_seq DESC, t.id DESC
                LIMIT 1
              ) AS last_price_cents
            FROM public.assets a
            """
        )
        asset_rows = cur.fetchall()

        cur.execute(
            """
            SELECT
              auth_user_id::text AS user_id,
              asset_id,
              shares,
              reserved_shares
            FROM public.holdings
            """
        )
        holding_rows = cur.fetchall()

        cur.execute(
            """
            SELECT
              id,
              auth_user_id::text AS user_id,
              asset_id,
              side,
              qty,
              remaining_qty,
              limit_price_cents,
              status,
              seq
            FROM public.orders
            WHERE status IN ('OPEN', 'PARTIALLY_FILLED') AND remaining_qty > 0
            ORDER BY seq ASC
            """
        )
        open_order_rows = cur.fetchall()
    finally:
        cur.close()

    engine.reset()

    for row in account_rows:
        engine.accounts[row["user_id"]] = Account(
            cash_cents=row["cash_cents"],
            reserved_cash_cents=row["reserved_cash_cents"],
        )

    for row in asset_rows:
        engine.assets[row["asset_id"]] = Asset(
            asset_id=row["asset_id"],
            issuer_user_id=row["issuer_user_id"],
            total_supply=row["total_supply"],
            name=row["name"] or f"{row['issuer_user_id']}'s {row['asset_id']}",
        )
        engine.books[row["asset_id"]] = Book()
        engine.last_price_cents[row["asset_id"]] = row["last_price_cents"] or 1000

    for row in holding_rows:
        engine.holdings[(row["user_id"], row["asset_id"])] = Holding(
            shares=row["shares"],
            reserved_shares=row["reserved_shares"],
        )

    for row in open_order_rows:
        order = Order(
            id=row["id"],
            user_id=row["user_id"],
            asset_id=row["asset_id"],
            side=Side(row["side"]),
            qty=row["qty"],
            remaining_qty=row["remaining_qty"],
            limit_price_cents=row["limit_price_cents"],
            status=OrderStatus(row["status"]),
            seq=row["seq"],
        )
        engine.orders[order.id] = order
        engine._add_to_book(order)

    engine.events = []
    _sync_generators_from_database(conn)


def _sync_public_state(conn: Any, engine: Any, events: List[Any], order: Optional[Any], trades: List[Any]) -> None:
    cur = conn.cursor()
    try:
        user_ids = set()
        asset_ids = set()
        holding_keys = set()

        for event in events:
            event_type = _get_value(event, "type")
            data = _get_value(event, "data")

            if event_type == "USER_CREATED":
                user_ids.add(data["user_id"])
            elif event_type == "ASSET_CREATED":
                asset_ids.add(data["asset_id"])
                user_ids.add(data["issuer_user_id"])
                for distribution in data.get("distribution", []):
                    if distribution.get("user_id"):
                        user_ids.add(distribution["user_id"])
                        holding_keys.add((distribution["user_id"], data["asset_id"]))
            elif event_type == "CASH_MOVED":
                if data.get("from_user_id"):
                    user_ids.add(data["from_user_id"])
                if data.get("to_user_id"):
                    user_ids.add(data["to_user_id"])
            elif event_type == "SHARES_MOVED":
                asset_ids.add(data["asset_id"])
                if data.get("from_user_id"):
                    user_ids.add(data["from_user_id"])
                    holding_keys.add((data["from_user_id"], data["asset_id"]))
                if data.get("to_user_id"):
                    user_ids.add(data["to_user_id"])
                    holding_keys.add((data["to_user_id"], data["asset_id"]))

        if order is not None:
            user_ids.add(_get_value(order, "user_id"))
            asset_ids.add(_get_value(order, "asset_id"))
            holding_keys.add((_get_value(order, "user_id"), _get_value(order, "asset_id")))

        for trade in trades:
            asset_ids.add(_get_value(trade, "asset_id"))
            user_ids.add(_get_value(trade, "buyer_id"))
            user_ids.add(_get_value(trade, "seller_id"))
            holding_keys.add((_get_value(trade, "buyer_id"), _get_value(trade, "asset_id")))
            holding_keys.add((_get_value(trade, "seller_id"), _get_value(trade, "asset_id")))

        user_ids = {user_id for user_id in user_ids if user_id and user_id != TREASURY_USER}
        holding_keys = {
            (user_id, asset_id)
            for user_id, asset_id in holding_keys
            if user_id and user_id != TREASURY_USER and asset_id in engine.assets
        }
        asset_ids = {asset_id for asset_id in asset_ids if asset_id in engine.assets}

        for user_id in user_ids:
            account = engine.accounts.get(user_id)
            if account is None:
                continue
            cur.execute(
                """
                INSERT INTO public.user_accounts (auth_user_id, cash_cents, reserved_cash_cents)
                VALUES (%s, %s, %s)
                ON CONFLICT (auth_user_id) DO UPDATE
                SET cash_cents = EXCLUDED.cash_cents,
                    reserved_cash_cents = EXCLUDED.reserved_cash_cents,
                    updated_at = timezone('utc', now())
                """,
                (user_id, account.cash_cents, account.reserved_cash_cents),
            )

        for asset_id in asset_ids:
            asset = engine.assets.get(asset_id)
            if asset is None:
                continue
            cur.execute(
                """
                INSERT INTO public.assets (asset_id, issuer_auth_user_id, total_supply, name)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (asset_id) DO UPDATE
                SET issuer_auth_user_id = EXCLUDED.issuer_auth_user_id,
                    total_supply = EXCLUDED.total_supply,
                    name = EXCLUDED.name,
                    updated_at = timezone('utc', now())
                """,
                (asset.asset_id, asset.issuer_user_id, asset.total_supply, asset.name),
            )

        for user_id, asset_id in holding_keys:
            holding = engine.holdings.get((user_id, asset_id))
            if holding is None:
                continue
            cur.execute(
                """
                INSERT INTO public.holdings (auth_user_id, asset_id, shares, reserved_shares)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (auth_user_id, asset_id) DO UPDATE
                SET shares = EXCLUDED.shares,
                    reserved_shares = EXCLUDED.reserved_shares,
                    updated_at = timezone('utc', now())
                """,
                (user_id, asset_id, holding.shares, holding.reserved_shares),
            )
    finally:
        cur.close()


def persist_engine_results(
    conn: Any,
    events: Optional[List[Any]] = None,
    order: Optional[Any] = None,
    trades: Optional[List[Any]] = None,
    engine: Optional[Any] = None,
) -> None:
    persisted_events = list(events or [])
    trade_seq_by_id = _trade_sequence_by_id(persisted_events)

    cur = conn.cursor()
    try:
        for event in persisted_events:
            data_value = _get_value(event, "data")
            if _is_sqlite(conn) and isinstance(data_value, dict):
                data_value = json.dumps(data_value)
            elif not _is_sqlite(conn) and isinstance(data_value, dict):
                data_value = Jsonb(data_value)

            query = (
                "INSERT INTO events (ts_seq, type, data) VALUES (" +
                ", ".join(_param(conn, idx + 1) for idx in range(3)) +
                ")"
            )
            cur.execute(query, (
                _get_value(event, "ts_seq"),
                _get_value(event, "type"),
                data_value,
            ))

        if order is not None:
            if _is_sqlite(conn):
                query = (
                    "INSERT INTO orders (id, user_id, asset_id, side, qty, remaining_qty, limit_price_cents, status, seq) VALUES (" +
                    _placeholders(conn, 9) +
                    ") ON CONFLICT (id) DO UPDATE SET remaining_qty = EXCLUDED.remaining_qty, status = EXCLUDED.status, seq = EXCLUDED.seq"
                )
                cur.execute(query, (
                    _get_value(order, "id"),
                    _get_value(order, "user_id"),
                    _get_value(order, "asset_id"),
                    _get_value(order, "side"),
                    _get_value(order, "qty"),
                    _get_value(order, "remaining_qty"),
                    _get_value(order, "limit_price_cents"),
                    _get_value(order, "status"),
                    _get_value(order, "seq"),
                ))
            else:
                cur.execute(
                    """
                    INSERT INTO public.orders (
                      id,
                      auth_user_id,
                      asset_id,
                      side,
                      qty,
                      remaining_qty,
                      limit_price_cents,
                      status,
                      seq
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE
                    SET remaining_qty = EXCLUDED.remaining_qty,
                        status = EXCLUDED.status,
                        seq = EXCLUDED.seq,
                        updated_at = timezone('utc', now())
                    """,
                    (
                        _get_value(order, "id"),
                        _get_value(order, "user_id"),
                        _get_value(order, "asset_id"),
                        _get_value(order, "side"),
                        _get_value(order, "qty"),
                        _get_value(order, "remaining_qty"),
                        _get_value(order, "limit_price_cents"),
                        _get_value(order, "status"),
                        _get_value(order, "seq"),
                    ),
                )

        for trade in trades or []:
            trade_ts_seq = _resolve_trade_ts_seq(trade, trade_seq_by_id)
            if _is_sqlite(conn):
                query = (
                    "INSERT INTO trades (id, ts_seq, asset_id, price_cents, qty, buy_order_id, sell_order_id, buyer_id, seller_id) VALUES (" +
                    _placeholders(conn, 9) +
                    ") ON CONFLICT (id) DO NOTHING"
                )
                cur.execute(query, (
                    _get_value(trade, "id"),
                    trade_ts_seq,
                    _get_value(trade, "asset_id"),
                    _get_value(trade, "price_cents"),
                    _get_value(trade, "qty"),
                    _get_value(trade, "buy_order_id"),
                    _get_value(trade, "sell_order_id"),
                    _get_value(trade, "buyer_id"),
                    _get_value(trade, "seller_id"),
                ))
            else:
                cur.execute(
                    """
                    INSERT INTO public.trades (
                      id,
                      ts_seq,
                      asset_id,
                      price_cents,
                      qty,
                      buy_order_id,
                      sell_order_id,
                      buyer_auth_user_id,
                      seller_auth_user_id
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        _get_value(trade, "id"),
                        trade_ts_seq,
                        _get_value(trade, "asset_id"),
                        _get_value(trade, "price_cents"),
                        _get_value(trade, "qty"),
                        _get_value(trade, "buy_order_id"),
                        _get_value(trade, "sell_order_id"),
                        _get_value(trade, "buyer_id"),
                        _get_value(trade, "seller_id"),
                    ),
                )
    finally:
        cur.close()

    if not _is_sqlite(conn) and engine is not None:
        _sync_public_state(conn, engine, persisted_events, order, list(trades or []))
