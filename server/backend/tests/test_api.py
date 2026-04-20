import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from server.backend.engine import MatchingEngine, TREASURY_USER
from server.backend.routes.assets import create_asset
from server.backend.routes.orders import cancel_order, place_order
from server.backend.routes.users import create_user
from server.backend.schemas import AssetCreate, OrderCreate, UserCreate


class DummyTransaction:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class DummyConnection:
    is_sqlite = True

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def transaction(self):
        return DummyTransaction()


@pytest.fixture()
def engine():
    return MatchingEngine()


@pytest.fixture(autouse=True)
def patch_persistence(monkeypatch):
    import server.backend.routes.assets as assets_mod
    import server.backend.routes.orders as orders_mod
    import server.backend.routes.users as users_mod

    monkeypatch.setattr(assets_mod, "get_connection", lambda: DummyConnection())
    monkeypatch.setattr(orders_mod, "get_connection", lambda: DummyConnection())
    monkeypatch.setattr(users_mod, "get_connection", lambda: DummyConnection())
    monkeypatch.setattr(assets_mod, "sync_engine_from_database", lambda engine, conn: None)
    monkeypatch.setattr(orders_mod, "sync_engine_from_database", lambda engine, conn: None)
    monkeypatch.setattr(users_mod, "persist_engine_results", lambda conn, events, order, trades, engine=None: None)
    monkeypatch.setattr(assets_mod, "persist_engine_results", lambda conn, events, order, trades, engine=None: None)
    monkeypatch.setattr(orders_mod, "persist_engine_results", lambda conn, events, order, trades, engine=None: None)


def build_request(engine: MatchingEngine):
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(engine=engine)))


def test_create_user(engine):
    response = create_user(
        UserCreate(user_id="alice"),
        build_request(engine),
    )

    assert response == {"ok": True}
    assert engine.accounts["alice"].cash_cents == 500000


def test_create_asset_splits_supply_between_issuer_and_public_float(engine):
    create_user(UserCreate(user_id="bob", initial_cash_cents=0), build_request(engine))

    response = create_asset(
        AssetCreate(issuer_user_id="bob", asset_id="bob-stock"),
        build_request(engine),
    )

    assert response == {"ok": True}
    assert engine.holdings[("bob", "bob-stock")].shares == 400
    assert (TREASURY_USER, "bob-stock") in engine.holdings
    assert engine.holdings[(TREASURY_USER, "bob-stock")].shares == 600


def test_place_buy_order_and_cancel(engine):
    request = build_request(engine)
    create_user(UserCreate(user_id="bob", initial_cash_cents=0), request)
    create_asset(AssetCreate(issuer_user_id="bob", asset_id="bob-stock"), request)
    create_user(UserCreate(user_id="alice", initial_cash_cents=100000), request)

    response = place_order(
        OrderCreate(
            user_id="alice",
            asset_id="bob-stock",
            side="BUY",
            qty=10,
            limit_price_cents=1200,
        ),
        request,
    )

    assert response["order"]["status"] == "OPEN"
    assert response["order"]["remaining_qty"] == 10

    order_id = response["order"]["id"]
    cancel_response = cancel_order(order_id, request)
    assert cancel_response["status"] == "CANCELED"


def test_allow_buying_own_stock(engine):
    request = build_request(engine)
    create_user(UserCreate(user_id="bob", initial_cash_cents=100000), request)
    create_asset(AssetCreate(issuer_user_id="bob", asset_id="bob-stock"), request)

    place_order(
        OrderCreate(
            user_id="bob",
            asset_id="bob-stock",
            side="SELL",
            qty=1,
            limit_price_cents=1000,
        ),
        request,
    )

    response = place_order(
        OrderCreate(
            user_id="bob",
            asset_id="bob-stock",
            side="BUY",
            qty=1,
            limit_price_cents=1000,
        ),
        request,
    )

    assert response["order"]["status"] == "FILLED"
    assert response["order"]["remaining_qty"] == 0
    assert len(response["trades"]) == 1
    assert response["trades"][0]["buyer_id"] == "bob"
    assert response["trades"][0]["seller_id"] == "bob"
