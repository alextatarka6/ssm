from __future__ import annotations

from engine_py.engine import MatchingEngine, NewOrder, Side, OrderStatus, TREASURY_USER, InsufficientFunds, InsufficientShares
import pytest

@pytest.fixture
def eng() -> MatchingEngine:
    return MatchingEngine()

# ----- Helpers -----
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
    asset_supply = {}
    for (uid, asset_id), h in eng.holdings.items():
        if asset_id not in asset_supply:
            asset_supply[asset_id] = 0
        asset_supply[asset_id] += h.shares

    for asset_id, supply in asset_supply.items():
        assert supply == eng.assets[asset_id].total_supply

# ----- Tests -----
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

def test_no_cross_means_no_trade_and_order_rests(eng: MatchingEngine) -> None:
    eng.reset()
    eng.set_user_default("alice", 100_000)
    eng.set_user_default("bob", 0)
    eng.set_user_default(TREASURY_USER, 0)
    eng.create_person_asset("bob", "bob-stock")

    # Bob sells at 1200
    eng.process_order(NewOrder("bob", "bob-stock", Side.SELL, 10, 1200))

    # Alice bids below ask; should not trade
    o2, trades = eng.process_order(NewOrder("alice", "bob-stock", Side.BUY, 7, 1100))
    assert trades == []
    assert o2.status == OrderStatus.OPEN
    assert o2.remaining_qty == 7

    # Cash should be reserved for the resting buy
    assert eng.accounts["alice"].reserved_cash_cents == 7 * 1100

    assert_invariants(eng)

def test_price_time_priority_same_price(eng: MatchingEngine) -> None:
    eng.reset()
    eng.set_user_default("alice", 100_000)
    eng.set_user_default("bob", 0)
    eng.set_user_default("charlie", 0)
    eng.set_user_default(TREASURY_USER, 0)
    eng.create_person_asset("bob", "bob-stock")

    # Give charlie some bob-stock from the treasury too so he can sell
    eng._getholding(TREASURY_USER, "bob-stock").shares -= 10  # take from treasury
    eng._getholding("charlie", "bob-stock").shares += 10

    # Two sell orders at same price; bob posts first then charlie
    o_bob, _ = eng.process_order(NewOrder("bob", "bob-stock", Side.SELL, 5, 1200))
    o_charlie, _ = eng.process_order(NewOrder("charlie", "bob-stock", Side.SELL, 5, 1200))

    # Alice buys 5, should fill bob first (earlier seq)
    o_buy, trades = eng.process_order(NewOrder("alice", "bob-stock", Side.BUY, 5, 1500))

    assert len(trades) == 1
    assert trades[0].sell_order_id == o_bob.id
    assert eng.orders[o_bob.id].status == OrderStatus.FILLED
    assert eng.orders[o_charlie.id].status in (OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED)
    assert eng.orders[o_charlie.id].remaining_qty == 5

    assert_invariants(eng)

def test_multilevel_fill_across_prices(eng: MatchingEngine) -> None:
    eng.reset()
    eng.set_user_default("alice", 200_000)
    eng.set_user_default("bob", 0)
    eng.set_user_default("charlie", 0)
    eng.set_user_default(TREASURY_USER, 0)
    eng.create_person_asset("bob", "bob-stock")

    # Give charlie shares from treasury to sell too
    eng._getholding(TREASURY_USER, "bob-stock").shares -= 10
    eng._getholding("charlie", "bob-stock").shares += 10

    # Best ask 1200 for 4, next ask 1300 for 6
    eng.process_order(NewOrder("bob", "bob-stock", Side.SELL, 4, 1200))
    eng.process_order(NewOrder("charlie", "bob-stock", Side.SELL, 6, 1300))

    # Alice buys 8 at 2000. Expect 2 trades:
    # 4 @ 1200, then 4 @ 1300
    o_buy, trades = eng.process_order(NewOrder("alice", "bob-stock", Side.BUY, 8, 2000))
    assert len(trades) == 2
    assert trades[0].price_cents == 1200 and trades[0].qty == 4
    assert trades[1].price_cents == 1300 and trades[1].qty == 4

    # Check cash spent: 4*1200 + 4*1300 = 4800 + 5200 = 10000
    assert eng.accounts["alice"].cash_cents == 200_000 - 10_000

    # No remaining buy -> no reserved cash
    assert eng.accounts["alice"].reserved_cash_cents == 0

    assert_invariants(eng)

def test_cancel_releases_buy_reserve(eng: MatchingEngine) -> None:
    eng.reset()
    eng.set_user_default("alice", 100_000)
    eng.set_user_default("bob", 0)
    eng.set_user_default(TREASURY_USER, 0)
    eng.create_person_asset("bob", "bob-stock")

    # Place buy that doesn't cross anything (no sells)
    o, trades = eng.process_order(NewOrder("alice", "bob-stock", Side.BUY, 10, 1500))
    assert trades == []
    assert eng.accounts["alice"].reserved_cash_cents == 15_000

    eng.cancel_order(o.id)
    assert eng.orders[o.id].status == OrderStatus.CANCELED
    assert eng.accounts["alice"].reserved_cash_cents == 0

    assert_invariants(eng)

def test_cancel_releases_sell_reserve(eng: MatchingEngine) -> None:
    eng.reset()
    eng.set_user_default("bob", 0)
    eng.set_user_default("alice", 0)
    eng.set_user_default(TREASURY_USER, 0)
    eng.create_person_asset("bob", "bob-stock")

    # Bob sells 10, should reserve 10 shares
    o, trades = eng.process_order(NewOrder("bob", "bob-stock", Side.SELL, 10, 1200))
    assert trades == []
    assert eng._getholding("bob", "bob-stock").reserved_shares == 10

    eng.cancel_order(o.id)
    assert eng.orders[o.id].status == OrderStatus.CANCELED
    assert eng._getholding("bob", "bob-stock").reserved_shares == 0

    assert_invariants(eng)

def test_reject_buy_insufficient_funds(eng: MatchingEngine) -> None:
    eng.reset()
    eng.set_user_default("alice", 1000)  # $10.00
    eng.set_user_default("bob", 0)
    eng.set_user_default(TREASURY_USER, 0)
    eng.create_person_asset("bob", "bob-stock")

    # Needs 10 * 200 = 2000 > 1000
    with pytest.raises(InsufficientFunds):
        eng.process_order(NewOrder("alice", "bob-stock", Side.BUY, 10, 200))

    assert_invariants(eng)

def test_reject_sell_insufficient_shares(eng: MatchingEngine) -> None:
    eng.reset()
    eng.set_user_default("bob", 0)
    eng.set_user_default("alice", 0)
    eng.set_user_default(TREASURY_USER, 0)
    eng.create_person_asset("bob", "bob-stock")

    # Bob has issuer_shares from create_person_asset, but try to sell way more than total supply
    with pytest.raises(InsufficientShares):
        eng.process_order(NewOrder("bob", "bob-stock", Side.SELL, 1_000_000, 1200))

    assert_invariants(eng)

def test_event_log_rebuild_matches_state_for_ledger(eng: MatchingEngine) -> None:
    eng.reset()
    eng.set_user_default("alice")
    eng.set_user_default("bob")
    eng.set_user_default(TREASURY_USER, 0)
    eng.create_person_asset("bob", "bob-stock")

    # Bob sells 10 @ 1200
    eng.process_order(NewOrder("bob", "bob-stock", Side.SELL, 10, 1200))
    # Alice buys 7 @ 1500 -> fills 7 @ 1200
    eng.process_order(NewOrder("alice", "bob-stock", Side.BUY, 7, 1500))

    snap_cash = {u: (a.cash_cents, a.reserved_cash_cents) for u, a in eng.accounts.items()}
    snap_shares = {(u, a): (h.shares, h.reserved_shares) for (u, a), h in eng.holdings.items()}

    # Rebuild from events
    # Important: rebuild_from_events() wipes balances; accounts must still exist (they do).
    eng.rebuild_from_events()

    # After rebuild, reserves should be 0 because you only replay ledger moves
    # (This is expected: ledger doesn't encode open orders/reserves.)
    for u, acct in eng.accounts.items():
        assert acct.reserved_cash_cents == 0
    for key, h in eng.holdings.items():
        assert h.reserved_shares == 0

    # Compare only the non-reserved components
    for u, (cash, _res) in snap_cash.items():
        assert eng.accounts[u].cash_cents == cash

    for key, (shares, _res) in snap_shares.items():
        assert eng.holdings[key].shares == shares

    assert_invariants(eng)

def test_lazy_delete_canceled_order_does_not_trade(eng: MatchingEngine) -> None:
    eng.reset()
    eng.set_user_default("alice", 100_000)
    eng.set_user_default("bob", 0)
    eng.set_user_default(TREASURY_USER, 0)
    eng.create_person_asset("bob", "bob-stock")

    # Bob posts a sell, then cancels it. It will still be in the heap, but should be skipped.
    o_sell, _ = eng.process_order(NewOrder("bob", "bob-stock", Side.SELL, 10, 1200))
    eng.cancel_order(o_sell.id)

    # Alice buys; should NOT match the canceled sell
    o_buy, trades = eng.process_order(NewOrder("alice", "bob-stock", Side.BUY, 10, 1500))
    assert trades == []
    assert o_buy.status == OrderStatus.OPEN
    assert o_buy.remaining_qty == 10

    assert_invariants(eng)





def main():
    eng = MatchingEngine()

    test_price_improvement_releases_cash(eng)
    print("Test: price improvement releases cash - Passed!")

    test_partial_fill_incoming_order(eng)
    print("Test: partial fill incoming order - Passed!")

    test_partial_fill_resting_order(eng)
    print("Test: partial fill resting order - Passed!")

    test_no_cross_means_no_trade_and_order_rests(eng)
    print("Test: no cross means no trade and order rests - Passed!")

    test_price_time_priority_same_price(eng)
    print("Test: price-time priority same price - Passed!")

    test_multilevel_fill_across_prices(eng)
    print("Test: multilevel fill across prices - Passed!")

    test_cancel_releases_buy_reserve(eng)
    print("Test: cancel releases buy reserve - Passed!")

    test_cancel_releases_sell_reserve(eng)
    print("Test: cancel releases sell reserve - Passed!")

    test_reject_buy_insufficient_funds(eng)
    print("Test: reject buy insufficient funds - Passed!")

    test_reject_sell_insufficient_shares(eng)
    print("Test: reject sell insufficient shares - Passed!")

    test_event_log_rebuild_matches_state_for_ledger(eng)
    print("Test: event log rebuild matches state for ledger - Passed!")

    print("\nAll tests passed!")

if __name__ == "__main__":
    main()