-- SQLite schema for local development

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL
);

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
);

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
);
