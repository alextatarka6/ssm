from __future__ import annotations

from engine import MatchingEngine, NewOrder, Side, OrderStatus
import pytest

@pytest.fixture
def eng() -> MatchingEngine:
    return MatchingEngine()

def assert_invariants(eng: MatchingEngine) -> None:
    # cash and reserves
    for uid, acct in eng.accounts.items():
        assert acct.cash_cents >= 0
        assert acct.reserved_cash_cents >= 0
        assert acct.reserved_cash_cents <= acct.cash_cents

    # shares and reserves
    for (uid, asset_id), h in eng.holdings.items():
        assert h.shares >= 0
        assert h.reserved_shares >= 0
        assert h.reserved_shares <= h.shares

    # fixed supply
    for asset_id, asset in eng.assets.items():
        total = 0
        for (uid, a), h in eng.holdings.items():
            if a == asset_id:
                total += h.shares
        assert total == asset.total_supply


def test_price_improvement_releases_cash(eng: MatchingEngine) -> None:
    eng.reset()
    eng.set_user_default("alice", 100_000)
    eng.set_user_default("bob", 0)
    eng.create_person_asset("bob", "bob-stock")

    # bob sells 10 at 1200
    eng.process_order(NewOrder("bob", "bob-stock", Side.SELL, 10, 1200))

    # alice bids 10 at 1500, fills at 1200
    o2, trades = eng.process_order(NewOrder("alice", "bob-stock", Side.BUY, 10, 1500))

    assert len(trades) == 1
    assert trades[0].price_cents == 1200

    # alice spent 12000, NOT 15000
    assert eng.accounts["alice"].cash_cents == 100_000 - 12_000
    # alice should have no extra reserved cash left from the order
    assert eng.accounts["alice"].reserved_cash_cents == 0

    assert_invariants(eng)

def test_partial_fill_incoming_order(eng: MatchingEngine) -> None:
    eng.reset()
    eng.set_user_default("alice", 100_000)
    eng.set_user_default("bob", 0)
    eng.create_person_asset("bob", "bob-stock")

    # bob sells 10 at 1200
    o1, _ = eng.process_order(NewOrder("bob", "bob-stock", Side.SELL, 10, 1200))
    # alice buys 15 at 1500
    o2, trades = eng.process_order(NewOrder("alice", "bob-stock", Side.BUY, 15, 1500))

    assert len(trades) == 1
    assert trades[0].qty == 10
    assert trades[0].price_cents == 1200
    # alice should have spent 12000 for the filled portion, and have 7500 reserved for the remaining portion
    assert eng.accounts["alice"].cash_cents == 100_000 - 12_000
    assert eng.accounts["alice"].reserved_cash_cents == 7_500

    assert_invariants(eng)

def test_partial_fill_resting_order(eng: MatchingEngine) -> None:
    eng.reset()
    eng.set_user_default("alice", 100_000)
    eng.set_user_default("bob", 0)
    eng.create_person_asset("bob", "bob-stock")

    # bob sells 10 at 1200
    o1, _ = eng.process_order(NewOrder("bob", "bob-stock", Side.SELL, 10, 1200))
    # alice buys 7 at 1500
    o2, trades = eng.process_order(NewOrder("alice", "bob-stock", Side.BUY, 7, 1500))

    assert len(trades) == 1
    assert trades[0].qty == 7
    # bob's resting order should have 3 remaining
    assert eng.orders[o1.id].remaining_qty == 3
    assert eng.orders[o1.id].status == OrderStatus.PARTIALLY_FILLED

    assert_invariants(eng)



def main():
    eng = MatchingEngine()

    test_price_improvement_releases_cash(eng)
    print("Test: price improvement releases cash passed!")

    test_partial_fill_incoming_order(eng)
    print("Test: partial fill incoming order passed!")

    test_partial_fill_resting_order(eng)
    print("Test: partial fill resting order passed!")

    print("\nAll tests passed!")

if __name__ == "__main__":
    main()