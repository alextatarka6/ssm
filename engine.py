from dataclasses import dataclass
from enum import Enum
from heapq import heappush, heappop
from itertools import count
from typing import Dict, List, Optional, Tuple

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
    reserved_cash_cents: int

@dataclass
class Holding:
    shares: int
    reserved_shares: int = 0

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
        self.bids = List[Tuple[int, int, int]] = []
        self.asks = List[Tuple[int, int, int]] = []

    
class MatchingEngine:
    def __init__(self) -> None:
        self.accounts: Dict[str, Account] = {}
        self.holdings: Dict[Tuple[str, str], Holding] = {}  # (user_id, asset_id)
        self.orders: Dict[int, Order] = {}
        self.books: Dict[str, Book] = {} # asset_id -> Book
        self.last_price_cents: Dict[str, int] = {} # asset_id -> last trade price

    # ------ Public API ------

    def ensure_user(self, user_id: str, initial_cash_cents: int = 0) -> None:
        self.accounts.setdefault(user_id, Account(cash_cents=initial_cash_cents))

    def ensure_asset(self, asset_id: str, initial_price_cents: int = 1000) -> None:
        self.books.setdefault(asset_id, Book())
        self.last_price_cents.setdefault(asset_id, initial_price_cents)

    def mint_shares(self, user_id: str, asset_id: str, shares: int) -> None:
        """
        Utility for initial distribution. Implement a fixed supply model later
        """
        h = self._getholding(user_id, asset_id)
        h.shares += shares

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
        self._release_reserve_for_order(order)
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
            
            # Apply transfers using reserved balances first
            self._consume_cash_reserve(buyer.user_id, notional)
            self._consume_shares_reserve(seller.user_id, asset_id, qty)

            # Move actual balances
            self.accounts[buyer.user_id].cash_cents -= notional
            self.accounts[seller.user_id].cash_cents += notional

            self._getholding(buyer.user_id, asset_id).shares += qty
            self._getholding(seller.user_id, asset_id).shares -= qty

            # Update order remaining
            taker.remaining_qty -= qty
            maker.remaining_qty -= qty

            # Last price
            self.last_price_cents[asset_id] = price_cents

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
            return order.status == OrderStatus.OPEN
        
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
        
        def _consume_cash_reserve(self, user_id: str, amount_cents: int) -> None:
            acct = self.accounts[user_id]
            if acct.reserved_cash_cents < amount_cents:
                # Should never happen if we reserve correctly upfront, but just in case
                raise InsufficientFunds("reserved cash underflow")
            acct.reserved_cash_cents -= amount_cents

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


# ------ Usage Example ------
if __name__ == "__main__":
    eng = MatchingEngine()
    eng.ensure_user("alice", initial_cash_cents=100_000)  # $1000.00
    eng.ensure_user("bob", initial_cash_cents=100_000)

    eng.ensure_asset("bob-stock", initial_price_cents=1_000)
    eng.mint_shares("bob", "bob-stock", shares=100)

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
        