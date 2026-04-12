import json
from typing import Any, Dict, List, Optional

from psycopg.rows import dict_row


def _is_sqlite(conn: Any) -> bool:
    return getattr(conn, "is_sqlite", False)


def _get_value(record: Any, key: str) -> Any:
    if isinstance(record, dict):
        return record[key]
    return getattr(record, key)


def _param(conn: Any, index: int) -> str:
    return "?" if _is_sqlite(conn) else f"${index}"


def _placeholders(conn: Any, count: int) -> str:
    return ", ".join(_param(conn, idx + 1) for idx in range(count))


def load_all_events(conn: Any) -> List[Dict[str, Any]]:
    cur = conn.cursor(row_factory=dict_row)
    try:
        cur.execute("SELECT ts_seq, type, data FROM events ORDER BY ts_seq ASC, id ASC")
        rows = cur.fetchall()
    finally:
        cur.close()

    events = []
    for row in rows:
        event_data = row["data"]
        if isinstance(event_data, str):
            event_data = json.loads(event_data)
        events.append({"ts_seq": row["ts_seq"], "type": row["type"], "data": event_data})
    return events


def load_all_orders(conn: Any) -> List[Dict[str, Any]]:
    cur = conn.cursor(row_factory=dict_row)
    try:
        cur.execute(
            "SELECT id, user_id, asset_id, side, qty, remaining_qty, limit_price_cents, status, seq FROM orders ORDER BY seq ASC"
        )
        return cur.fetchall()
    finally:
        cur.close()


def persist_engine_results(
    conn: Any,
    events: Optional[List[Any]] = None,
    order: Optional[Any] = None,
    trades: Optional[List[Any]] = None,
) -> None:
    cur = conn.cursor()
    try:
        for event in events or []:
            data_value = _get_value(event, "data")
            if _is_sqlite(conn) and isinstance(data_value, dict):
                data_value = json.dumps(data_value)

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

        for trade in trades or []:
            query = (
                "INSERT INTO trades (id, ts_seq, asset_id, price_cents, qty, buy_order_id, sell_order_id, buyer_id, seller_id) VALUES (" +
                _placeholders(conn, 9) +
                ") ON CONFLICT (id) DO NOTHING"
            )
            cur.execute(query, (
                _get_value(trade, "id"),
                _get_value(trade, "ts_seq"),
                _get_value(trade, "asset_id"),
                _get_value(trade, "price_cents"),
                _get_value(trade, "qty"),
                _get_value(trade, "buy_order_id"),
                _get_value(trade, "sell_order_id"),
                _get_value(trade, "buyer_id"),
                _get_value(trade, "seller_id"),
            ))
    finally:
        cur.close()
