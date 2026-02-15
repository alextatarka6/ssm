from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from heapq import heappush, heappop
from itertools import count
from typing import Any, Dict, List, Optional, Tuple

TREASURY_USER = "TREASURY" # special user for initial asset distribution and fees

class Side(str, Enum):
    BUY = "BUY"
    SELL = "SELL"

class OrderStatus(str, Enum):
    OPEN = "OPEN"
    FILLED = "FILLED"
    PARTIALLY_FILLED = "PARTIALLY_FILLED"
    CANCELED = "CANCELED"
    REJECTED = "REJECTED"

_order_id_gen = count(1)
_trade_id_gen = count(1)
_seq_gen = count(1) # Global time-priority sequence generator for all events
_event_id_gen = count(1) # Global event ID generator for all events (orders, trades, cancels, etc)

@dataclass(frozen=True)
class NewOrder:
    user_id: str
    asset_id: str
    side: Side
    qty: int
    limit_price_cents: int # store money as int cents
    client_order_id: Optional[str] = None

@dataclass
class Order:
    id: int
    user_id: str
    asset_id: str
    side: Side
    qty: int
    remaining_qty: int
    limit_price_cents: int
    status: OrderStatus
    seq: int    # time priority (lower = higher priority)

@dataclass(frozen=True)
class Trade:
    id: int
    asset_id: str
    price_cents: int
    qty: int
    buy_order_id: int
    sell_order_id: int
    buyer_id: str
    seller_id: str

@dataclass
class Account:
    cash_cents: int
    reserved_cash_cents: int = 0

@dataclass
class Holding:
    shares: int
    reserved_shares: int = 0

@dataclass(frozen=True)
class Asset:
    asset_id: str
    issuer_user_id: str
    total_supply: int
    name: str

class EventType(str, Enum):
    ASSET_CREATED = "ASSET_CREATED"
    ORDER_PLACED = "ORDER_PLACED"
    ORDER_CANCELED = "ORDER_CANCELED"
    TRADE_EXECUTED = "TRADE_EXECUTED"
    CASH_MOVED = "CASH_MOVED"
    SHARES_MOVED = "SHARES_MOVED"

@dataclass(frozen=True)
class Event:
    id: int
    type: EventType
    ts_seq: int  # reuses global _seq_gen for ordering
    data: Dict[str, Any] = field(default_factory=dict)

class InsufficientFunds(Exception):
    pass

class InsufficientShares(Exception):
    pass

class UnknownOrder(Exception):
    pass

class Book:
    """
    Priority queue for an asset:
        - bids: max price, then earlier time (use negative price)
        - asks: min price, then earlier time
    tuples are: (key_price, seq, order_id)
    """
    def __init__(self) -> None:
        self.bids: List[Tuple[int, int, int]] = []
        self.asks: List[Tuple[int, int, int]] = []

    
class MatchingEngine:
    def __init__(self) -> None:
        self.accounts: Dict[str, Account] = {}
        self.holdings: Dict[Tuple[str, str], Holding] = {}  # (user_id, asset_id)
        self.orders: Dict[int, Order] = {}
        self.books: Dict[str, Book] = {} # asset_id -> Book
        self.last_price_cents: Dict[str, int] = {} # asset_id -> last trade price
        self.assets: Dict[str, Asset] = {}
        self.events: List[Event] = [] # global event log for all state changes (orders, trades, cancels, etc)

    # ------ Public API ------

    def ensure_user(self, user_id: str, initial_cash_cents: int = 0) -> None:
        self.accounts.setdefault(user_id, Account(cash_cents=initial_cash_cents))

    def ensure_asset(self, asset_id: str, initial_price_cents: int = 1000) -> None:
        self.books.setdefault(asset_id, Book())
        self.last_price_cents.setdefault(asset_id, initial_price_cents)

    def create_person_asset(
            self, 
            issuer_user_id: str, 
            asset_id: str,
            total_supply: int = 1000,
            issuer_pct: float = 0.6
            ) -> None:
        
        if asset_id in self.assets:
            raise ValueError("Asset already exists")
        if total_supply <= 0:
            raise ValueError("Total supply must be positive")
        if not (0 < issuer_pct < 1):
            raise ValueError("Issuer percentage must be between 0 and 1")

        self.assets[asset_id] = Asset(
            asset_id=asset_id,
            issuer_user_id=issuer_user_id,
            total_supply=total_supply,
            # TODO - allow custom names
            name=f"USER{asset_id}"
        )

        issuer_shares = int(round(total_supply * issuer_pct))
        treasury_shares = total_supply - issuer_shares

        self._getholding(issuer_user_id, asset_id).shares += issuer_shares
        self._getholding(TREASURY_USER, asset_id).shares += treasury_shares

        # Emit asset creation event with initial distribution details
        seq = next(_seq_gen)
        self._emit(
            EventType.ASSET_CREATED, 
            seq, 
            asset_id=asset_id, 
            issuer_user_id=issuer_user_id, 
            total_supply=total_supply, 
            distribution=[
                {"user_id": issuer_user_id, "shares": issuer_shares},         
                {"user_id": TREASURY_USER, "shares": treasury_shares},
            ],
        )

        self._emit(EventType.SHARES_MOVED, next(_seq_gen), asset_id=asset_id, from_user_id=None, to_user_id=issuer_user_id, shares=issuer_shares, reason="ISSUANCE")
        self._emit(EventType.SHARES_MOVED, next(_seq_gen), asset_id=asset_id, from_user_id=None, to_user_id="TREASURY", shares=treasury_shares, reason="ISSUANCE")


    def place_order(self, req: NewOrder) -> Tuple[Order, List[Trade]]:
        self._validate_new_order(req)

        order = Order(
            id=next(_order_id_gen),
            user_id=req.user_id,
            asset_id=req.asset_id,
            side=req.side,
            qty=req.qty,
            remaining_qty=req.qty,
            limit_price_cents=req.limit_price_cents,
            status=OrderStatus.OPEN,
            seq=next(_seq_gen)
        )

        # Reserve upfront so we never go negative during matching
        self._reserve_for_order(order)

        seq = order.seq
        self._emit(
            EventType.ORDER_PLACED, 
            seq, 
            order_id=order.id, 
            user_id=order.user_id, 
            asset_id=order.asset_id, 
            side=order.side, 
            qty=order.qty, 
            limit_price_cents=order.limit_price_cents
        )

        # Match immediately against the opposite side
        trades: List[Trade] = self._match(order)

        # If still remaining, rest on the book
        if order.remaining_qty > 0 and order.status not in (OrderStatus.REJECTED, OrderStatus.CANCELED):
            self._add_to_book(order)
            if order.remaining_qty < order.qty:
                order.status = OrderStatus.PARTIALLY_FILLED

        else:
            order.status = OrderStatus.FILLED if order.remaining_qty == 0 else order.status

        self.orders[order.id] = order
        return order, trades

    def cancel_order(self, order_id: int) -> Order:
        """
        Simple cancel: mark status and release remaining reserves.
        Notes: For a production engine we need to remove from it the heap efficiently
        For MVP, we do lazy deletion (skip non-open orders when popping).
        """
        order = self.orders.get(order_id)
        if order is None:
            raise UnknownOrder(order_id)
        if order.status in (OrderStatus.FILLED, OrderStatus.CANCELED, OrderStatus.REJECTED):
            return order
        
        order.status = OrderStatus.CANCELED
        self._release_remaining_reserve(order)

        seq = next(_seq_gen)
        self._emit(
            EventType.ORDER_CANCELED, 
            seq, 
            order_id=order.id, 
            user_id=order.user_id, 
            asset_id=order.asset_id, 
            side=order.side, 
            remaining_qty=order.remaining_qty
        )
        return order
    
    # ------ Matching Logic ------

    def _match(self, incoming: Order) -> List[Trade]:
        book = self.books[incoming.asset_id]
        trades: List[Trade] = []

        while incoming.remaining_qty > 0:
            # peek automatically discards non-open orders, so we are guaranteed a valid resting order or None
            best_order_id = self._peek_best_opposite(book, incoming.side)
            if best_order_id is None:
                break

            resting = self.orders[best_order_id]

            if not self._is_price_cross(incoming, resting):
                break

            # Pop it now to trade against it
            self._pop_best_opposite(book, incoming.side)

            fill_qty = min(incoming.remaining_qty, resting.remaining_qty)
            trade_price = resting.limit_price_cents # price is determined by resting order

            trade = self._execute_trade(
                asset_id=incoming.asset_id,
                price_cents=trade_price,
                qty=fill_qty,
                taker=incoming,
                maker=resting
            )
            trades.append(trade)

            # If the resting order still has remaining qty, put it back on the book
            if resting.remaining_qty > 0:
                resting.status = OrderStatus.PARTIALLY_FILLED
                self._add_to_book(resting)
            else:
                resting.status = OrderStatus.FILLED
            
            if incoming.remaining_qty == 0:
                incoming.status = OrderStatus.FILLED
            
        return trades
        
    def _execute_trade(self, asset_id: str, price_cents: int, qty: int, taker: Order, maker: Order):
        # determine buyer/seller based on sides
        if taker.side == Side.BUY:
            buyer, seller = taker, maker
        else:
            buyer, seller = maker, taker
        
        notional = price_cents * qty
        
        # Buyer: reduce reserved at LIMIT*qty, spend at TRADE*qty
        self._consume_buy_reserve_on_fill(buyer, qty)
        self.accounts[buyer.user_id].cash_cents -= notional

        # Seller: reduce reserved shares, receive cash
        self._consume_shares_reserve(seller.user_id, asset_id, qty)
        self._getholding(seller.user_id, asset_id).shares -= qty
        self.accounts[seller.user_id].cash_cents += notional

        # Buyer receives shares
        self._getholding(buyer.user_id, asset_id).shares += qty

        # Update order remaining
        taker.remaining_qty -= qty
        maker.remaining_qty -= qty

        # Last price
        self.last_price_cents[asset_id] = price_cents

        seq = next(_seq_gen)
        trade = Trade(
            id=next(_trade_id_gen),
            asset_id=asset_id,
            price_cents=price_cents,
            qty=qty,
            buy_order_id=buyer.id,
            sell_order_id=seller.id,
            buyer_id=buyer.user_id,
            seller_id=seller.user_id
        )

        # Emit trade event with details as well as account movements
        self._emit(
            EventType.TRADE_EXECUTED,
            seq,
            trade_id=trade.id,
            asset_id=asset_id,
            price_cents=price_cents,
            qty=qty,
            buy_order_id=buyer.id,
            sell_order_id=seller.id,
            buyer_id=buyer.user_id,
            seller_id=seller.user_id
        )

        self._emit(EventType.CASH_MOVED, next(_seq_gen), asset_id=asset_id, from_user_id=buyer.user_id, to_user_id=seller.user_id, cash_cents=notional, reason="TRADE")
        self._emit(EventType.SHARES_MOVED, next(_seq_gen), asset_id=asset_id, from_user_id=seller.user_id, to_user_id=buyer.user_id, shares=qty, reason="TRADE")

        return trade
    
    # ------ Book Helpers ------

    def _add_to_book(self, order: Order) -> None:
        book = self.books[order.asset_id]
        if order.side == Side.BUY:
            # max-heap by price using negative price, then time priority
            heappush(book.bids, (-order.limit_price_cents, order.seq, order.id))
        else:
            heappush(book.asks, (order.limit_price_cents, order.seq, order.id))

        self.orders[order.id] = order # ensure present

    def _peek_best_opposite(self, book: Book, incoming_side: Side) -> Optional[int]:
        heap = book.asks if incoming_side == Side.BUY else book.bids
        while heap:
            _, _, order_id = heap[0]
            o = self.orders.get(order_id)
            if o is not None and self._is_open(o):
                return order_id
            heappop(heap) # discard lazy-dead top
        return None   

    def _pop_best_opposite(self, book: Book, incoming_side: Side) -> Optional[int]:
        heap = book.asks if incoming_side == Side.BUY else book.bids
        while heap:
            _, _, order_id = heappop(heap)
            o = self.orders.get(order_id)
            if o is not None and self._is_open(o):
                return order_id
        return None
    
    def _is_price_cross(self, incoming: Order, resting: Order) -> bool:
        if incoming.side == Side.BUY:
            return incoming.limit_price_cents >= resting.limit_price_cents
        else:
            return incoming.limit_price_cents <= resting.limit_price_cents
        
    def _is_open(self, order: Order) -> bool:
        return order.status in [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED] and order.remaining_qty > 0
    
    # ------ Validation and reserves ------
    def _validate_new_order(self, req: NewOrder) -> None:
        if req.qty <= 0:
            raise ValueError("Order quantity must be positive")
        if req.limit_price_cents <= 0:
            raise ValueError("Limit price must be positive")
        self.ensure_user(req.user_id)
        self.ensure_asset(req.asset_id)

    def _reserve_for_order(self, order: Order) -> None:
        if order.side == Side.BUY:
            needed = order.limit_price_cents * order.remaining_qty
            acct = self.accounts[order.user_id]
            available = acct.cash_cents - acct.reserved_cash_cents
            if available < needed:
                raise InsufficientFunds(f"need: {needed}, available: {available}")
            acct.reserved_cash_cents += needed
        else:
            h = self._getholding(order.user_id, order.asset_id)
            available = h.shares - h.reserved_shares
            if available < order.remaining_qty:
                raise InsufficientShares(f"need: {order.remaining_qty}, available: {available}")
            h.reserved_shares += order.remaining_qty

    def _consume_buy_reserve_on_fill(self, buy_order: Order, fill_qty: int) -> None:
        acct = self.accounts[buy_order.user_id]
        release = buy_order.limit_price_cents * fill_qty
        if acct.reserved_cash_cents < release:
            raise InsufficientFunds("reserved cash underflow on fill")
        acct.reserved_cash_cents -= release

    def _consume_shares_reserve(self, user_id: str, asset_id: str, shares: int) -> None:
        h = self._getholding(user_id, asset_id)
        if h.reserved_shares < shares:
            raise InsufficientShares("reserved shares underflow")
        h.reserved_shares -= shares
    
    def _release_remaining_reserve(self, order: Order) -> None:
        if order.remaining_qty <= 0:
            return
        if order.side == Side.BUY:
            refund = order.limit_price_cents * order.remaining_qty
            acct = self.accounts[order.user_id]
            acct.reserved_cash_cents = max(0, acct.reserved_cash_cents - refund)
        else:
            h = self._getholding(order.user_id, order.asset_id)
            h.reserved_shares = max(0, h.reserved_shares - order.remaining_qty)

        order.remaining_qty = 0

    # ------ State Helpers ------
    def _getholding(self, user_id: str, asset_id: str) -> Holding:
        key = (user_id, asset_id)
        if key not in self.holdings:
            self.holdings[key] = Holding(shares=0)
        return self.holdings[key]
    
    # ------ Event Logging ------
    def _emit(self, etype: EventType, ts_seq: int, **data: Any) -> Event:
        event = Event(
            id=next(_event_id_gen),
            type=etype,
            ts_seq=ts_seq,
            data=data
        )
        self.events.append(event)
        return event
    
    def rebuild_from_events(self) -> None:
        # wipe derived state
        for acct in self.accounts.values():
            acct.cash_cents = 0
            acct.reserved_cash_cents = 0
        for h in self.holdings.values():
            h.shares = 0
            h.reserved_shares = 0
        
        # for now just rebuild balances from ledger events
        for event in sorted(self.events, key=lambda e: (e.ts_seq, e.id)):
            if event.type == EventType.CASH_MOVED:
                from_user = event.data["from_user_id"]
                to_user = event.data["to_user_id"]
                cash_cents = event.data["cash_cents"]
                if from_user:
                    self.accounts[from_user].cash_cents -= cash_cents
                if to_user:
                    self.accounts[to_user].cash_cents += cash_cents
                    
            elif event.type == EventType.SHARES_MOVED:
                from_user = event.data["from_user_id"]
                to_user = event.data["to_user_id"]
                asset_id = event.data["asset_id"]
                shares = event.data["shares"]
                if from_user:
                    self._getholding(from_user, asset_id).shares -= shares
                if to_user:
                    self._getholding(to_user, asset_id).shares += shares


# ------ Usage Example ------
if __name__ == "__main__":
    eng = MatchingEngine()
    eng.ensure_user("alice", initial_cash_cents=100_000)  # $1000.00
    eng.ensure_user("bob", initial_cash_cents=100_000)
    eng.ensure_user(TREASURY_USER)

    eng.ensure_asset("bob-stock", initial_price_cents=1_000)
    eng.create_person_asset("bob-stock", "bob")

    # Bob posts a sell: 10 shares at $12
    o1, t1 = eng.place_order(NewOrder(
        user_id="bob", asset_id="bob-stock", side=Side.SELL, qty=10, limit_price_cents=1_200
    ))

    # Alice buys: 7 shares at $15 (crosses, fills at $12)
    o2, t2 = eng.place_order(NewOrder(
        user_id="alice", asset_id="bob-stock", side=Side.BUY, qty=7, limit_price_cents=1_500
    ))

    print(o1)
    print(o2)
    print(t2)
    print("Alice cash:", eng.accounts["alice"].cash_cents, "shares:", eng.holdings[("alice", "bob-stock")].shares)
    print("Bob cash:", eng.accounts["bob"].cash_cents, "shares:", eng.holdings[("bob", "bob-stock")].shares)
        