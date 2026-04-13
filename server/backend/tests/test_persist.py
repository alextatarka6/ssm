import sqlite3
import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from server.backend.engine import EventType, MatchingEngine, NewOrder, Side, get_generator_state, set_generator_state
from server.backend.db import SQLiteConnection
from server.backend.persist import persist_engine_results, sync_engine_from_database

SQLITE_SCHEMA = (ROOT_DIR / "server" / "backend" / "sqlite_schema.sql").read_text()


@pytest.fixture(autouse=True)
def restore_generators():
    original_state = get_generator_state()
    yield
    set_generator_state(**original_state)


def _make_sqlite_conn() -> SQLiteConnection:
    raw_conn = sqlite3.connect(":memory:")
    raw_conn.row_factory = sqlite3.Row
    raw_conn.executescript(SQLITE_SCHEMA)
    return SQLiteConnection(raw_conn)


def _persist(conn: SQLiteConnection, engine: MatchingEngine, *, order=None, trades=None) -> None:
    with conn.transaction():
        persist_engine_results(conn, events=engine.events, order=order, trades=trades or [], engine=engine)
    engine.events = []


def test_persist_engine_results_uses_trade_event_sequence():
    set_generator_state()
    conn = _make_sqlite_conn()
    engine = MatchingEngine()

    engine.set_user_default("alice", 100_000)
    engine.set_user_default("bob", 0)
    engine.create_person_asset("bob", "bob-stock")
    _persist(conn, engine)

    resting_order, _ = engine.process_order(NewOrder("bob", "bob-stock", Side.SELL, 4, 1200))
    _persist(conn, engine, order=resting_order)

    incoming_order, trades = engine.process_order(NewOrder("alice", "bob-stock", Side.BUY, 4, 1500))
    trade_event = next(event for event in engine.events if event.type == EventType.TRADE_EXECUTED)
    _persist(conn, engine, order=incoming_order, trades=trades)

    cur = conn.cursor()
    try:
        cur.execute("SELECT id, ts_seq, price_cents FROM trades ORDER BY ts_seq ASC, id ASC")
        rows = cur.fetchall()
    finally:
        cur.close()
        conn.close()

    assert len(rows) == 1
    assert rows[0]["id"] == trades[0].id
    assert rows[0]["ts_seq"] == trade_event.ts_seq
    assert rows[0]["price_cents"] == 1200


def test_sync_engine_from_database_restores_global_generators():
    set_generator_state()
    conn = _make_sqlite_conn()
    engine = MatchingEngine()

    engine.set_user_default("alice", 100_000)
    engine.set_user_default("bob", 0)
    engine.create_person_asset("bob", "bob-stock")
    _persist(conn, engine)

    first_order, _ = engine.process_order(NewOrder("bob", "bob-stock", Side.SELL, 4, 1200))
    _persist(conn, engine, order=first_order)

    second_order, trades = engine.process_order(NewOrder("alice", "bob-stock", Side.BUY, 2, 1500))
    max_seq_before_restart = max(event.ts_seq for event in engine.events)
    _persist(conn, engine, order=second_order, trades=trades)

    set_generator_state()

    restarted_engine = MatchingEngine()
    sync_engine_from_database(restarted_engine, conn)

    synced_state = get_generator_state()
    assert synced_state["next_order_id"] == second_order.id + 1
    assert synced_state["next_trade_id"] == trades[-1].id + 1
    assert synced_state["next_seq"] == max_seq_before_restart + 1

    next_order, _ = restarted_engine.process_order(NewOrder("bob", "bob-stock", Side.SELL, 1, 1300))
    conn.close()

    assert next_order.id == second_order.id + 1
    assert next_order.seq == max_seq_before_restart + 1
