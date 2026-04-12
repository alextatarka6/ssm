from typing import Any, Dict, List, Optional

from psycopg import Connection
from psycopg.rows import dict_row


def load_all_events(conn: Connection) -> List[Dict[str, Any]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT ts_seq, type, data FROM events ORDER BY ts_seq ASC, id ASC")
        return cur.fetchall()


def load_all_orders(conn: Connection) -> List[Dict[str, Any]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT id, user_id, asset_id, side, qty, remaining_qty, limit_price_cents, status, seq FROM orders ORDER BY seq ASC"
        )
        return cur.fetchall()


def _get_value(record: Any, key: str) -> Any:
    if isinstance(record, dict):
        return record[key]
    return getattr(record, key)


def persist_engine_results(
    conn: Connection,
    events: Optional[List[Any]] = None,
    order: Optional[Any] = None,
    trades: Optional[List[Any]] = None,
) -> None:
    with conn.cursor() as cur:
        for event in events or []:
            cur.execute(
                "INSERT INTO events (ts_seq, type, data) VALUES (%s, %s, %s)",
                (
                    _get_value(event, "ts_seq"),
                    _get_value(event, "type"),
                    _get_value(event, "data"),
                ),
            )

        if order is not None:
            cur.execute(
                """
                INSERT INTO orders (id, user_id, asset_id, side, qty, remaining_qty, limit_price_cents, status, seq)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    remaining_qty = EXCLUDED.remaining_qty,
                    status = EXCLUDED.status,
                    seq = EXCLUDED.seq
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
            cur.execute(
                """
                INSERT INTO trades (id, ts_seq, asset_id, price_cents, qty, buy_order_id, sell_order_id, buyer_id, seller_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                (
                    _get_value(trade, "id"),
                    _get_value(trade, "ts_seq"),
                    _get_value(trade, "asset_id"),
                    _get_value(trade, "price_cents"),
                    _get_value(trade, "qty"),
                    _get_value(trade, "buy_order_id"),
                    _get_value(trade, "sell_order_id"),
                    _get_value(trade, "buyer_id"),
                    _get_value(trade, "seller_id"),
                ),
            )
