import json
import os
import sqlite3
from pathlib import Path
from urllib.parse import urlparse

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

DOTENV_PATH = Path(__file__).resolve().parent / ".env"
if DOTENV_PATH.exists():
    load_dotenv(DOTENV_PATH)

DATABASE_URL = os.environ.get("DATABASE_URL")
SQLITE_DEFAULT_PATH = Path(__file__).resolve().parent / "local.db"


def _sqlite_path_from_url(url: str) -> Path:
    parsed = urlparse(url)
    if parsed.scheme != "sqlite":
        raise ValueError("Unsupported SQLite URL")
    path = parsed.path
    if path.startswith("/") and len(path) > 1:
        return Path(path)
    return SQLITE_DEFAULT_PATH


class SQLiteConnection:
    def __init__(self, connection: sqlite3.Connection):
        self._conn = connection
        self.is_sqlite = True

    def __getattr__(self, name):
        return getattr(self._conn, name)

    def cursor(self, *args, **kwargs):
        return self._conn.cursor()

    def transaction(self):
        return self

    def __enter__(self):
        self._conn.execute("BEGIN")
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        if exc_type:
            self._conn.rollback()
        else:
            self._conn.commit()


def _initialize_sqlite_database(sqlite_path: Path) -> None:
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(sqlite_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts_seq INTEGER NOT NULL,
            type TEXT NOT NULL,
            data TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY,
            user_id TEXT NOT NULL,
            asset_id TEXT NOT NULL,
            side TEXT NOT NULL,
            qty INTEGER NOT NULL,
            remaining_qty INTEGER NOT NULL,
            limit_price_cents INTEGER NOT NULL,
            status TEXT NOT NULL,
            seq INTEGER NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY,
            ts_seq INTEGER NOT NULL,
            asset_id TEXT NOT NULL,
            price_cents INTEGER NOT NULL,
            qty INTEGER NOT NULL,
            buy_order_id INTEGER NOT NULL,
            sell_order_id INTEGER NOT NULL,
            buyer_id TEXT NOT NULL,
            seller_id TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


def _get_sqlite_connection() -> SQLiteConnection:
    sqlite_path = SQLITE_DEFAULT_PATH
    if DATABASE_URL and DATABASE_URL.startswith("sqlite://"):
        sqlite_path = _sqlite_path_from_url(DATABASE_URL)
    _initialize_sqlite_database(sqlite_path)
    conn = sqlite3.connect(sqlite_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return SQLiteConnection(conn)


def get_connection():
    if DATABASE_URL is None or DATABASE_URL.startswith("sqlite://"):
        return _get_sqlite_connection()
    return psycopg.connect(DATABASE_URL)
