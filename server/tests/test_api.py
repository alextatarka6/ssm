import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@localhost:5432/db")

from server.app import app
from engine_py.engine import TREASURY_USER


class DummyCursor:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, *args, **kwargs):
        pass

    def fetchall(self):
        return []


class DummyTransaction:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class DummyConnection:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def cursor(self, row_factory=None):
        return DummyCursor()

    def transaction(self):
        return DummyTransaction()


@pytest.fixture(autouse=True)
def client(monkeypatch):
    import server.app as app_mod
    import server.routes.assets as assets_mod
    import server.routes.orders as orders_mod

    monkeypatch.setattr(app_mod, "get_connection", lambda: DummyConnection())
    monkeypatch.setattr(app_mod, "load_all_events", lambda conn: [])
    monkeypatch.setattr(app_mod, "load_all_orders", lambda conn: [])
    monkeypatch.setattr(assets_mod, "get_connection", lambda: DummyConnection())
    monkeypatch.setattr(orders_mod, "get_connection", lambda: DummyConnection())
    monkeypatch.setattr(assets_mod, "persist_engine_results", lambda conn, events, order, trades: None)
    monkeypatch.setattr(orders_mod, "persist_engine_results", lambda conn, events, order, trades: None)

    with TestClient(app) as test_client:
        yield test_client


def test_create_user(client):
    response = client.post("/users/", json={"user_id": "alice", "initial_cash_cents": 10000})
    assert response.status_code == 201
    assert response.json() == {"ok": True}
    assert app.state.engine.accounts["alice"].cash_cents == 10000


def test_create_asset_assigns_all_supply_to_treasury(client):
    client.post("/users/", json={"user_id": "bob", "initial_cash_cents": 0})
    response = client.post("/assets/", json={"issuer_user_id": "bob", "asset_id": "bob-stock"})
    assert response.status_code == 201
    assert response.json() == {"ok": True}
    assert (TREASURY_USER, "bob-stock") in app.state.engine.holdings
    assert app.state.engine.holdings[(TREASURY_USER, "bob-stock")].shares == 1000
    assert app.state.engine.holdings.get(("bob", "bob-stock"), None) is None or app.state.engine.holdings[("bob", "bob-stock")].shares == 0


def test_place_buy_order_and_cancel(client):
    client.post("/users/", json={"user_id": "bob", "initial_cash_cents": 0})
    client.post("/assets/", json={"issuer_user_id": "bob", "asset_id": "bob-stock"})
    client.post("/users/", json={"user_id": "alice", "initial_cash_cents": 100000})

    response = client.post(
        "/orders/",
        json={"user_id": "alice", "asset_id": "bob-stock", "side": "BUY", "qty": 10, "limit_price_cents": 1200},
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["order"]["status"] == "OPEN"
    assert payload["order"]["remaining_qty"] == 10

    order_id = payload["order"]["id"]
    cancel_response = client.post(f"/orders/{order_id}/cancel")
    assert cancel_response.status_code == 200
    assert cancel_response.json()["status"] == "CANCELED"


def test_reject_buying_own_stock(client):
    client.post("/users/", json={"user_id": "bob", "initial_cash_cents": 100000})
    client.post("/assets/", json={"issuer_user_id": "bob", "asset_id": "bob-stock"})

    response = client.post(
        "/orders/",
        json={"user_id": "bob", "asset_id": "bob-stock", "side": "BUY", "qty": 1, "limit_price_cents": 1000},
    )
    assert response.status_code == 400
    assert "may not buy their own stock" in response.json()["detail"]
