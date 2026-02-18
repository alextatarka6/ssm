import {
    TREASURY_USER,
    Side,
    OrderStatus,
    EventType,
    InsufficientShares,
    InsufficientFunds,
    UnknownOrder,
    UnknownUser,
    UnknownAsset,
} from "./types.js";
import { Heap } from "./heaps.js";

function makeIdGen(start = 1) {
    let x = start;
    return () => x++;
}

export function makeEngine() {
    return new MatchingEngine();
}

class Book {
  constructor() {
    // Each heap entry is { price, seq, orderId }
    // bids: higher price first, then lower seq
    this.bids = new Heap((a, b) => {
      if (a.price !== b.price) return a.price > b.price;
      return a.seq < b.seq;
    });

    // asks: lower price first, then lower seq
    this.asks = new Heap((a, b) => {
      if (a.price !== b.price) return a.price < b.price;
      return a.seq < b.seq;
    });
  }
}

class MatchingEngine {
    constructor() {
    this._orderId = makeIdGen(1);
    this._tradeId = makeIdGen(1);
    this._eventId = makeIdGen(1);
    this._seq = makeIdGen(1);

    this.accounts = new Map();  // userId -> { cash, reservedCash }
    this.holdings = new Map();  // `${userId}|${assetId}` -> { shares, reservedShares }
    this.assets = new Map();    // assetId -> { assetId, issuerUserId, totalSupply, name }
    this.orders = new Map();    // orderId -> order
    this.books = new Map();     // assetId -> Book
    this.lastPrice = new Map(); // assetId -> last price cents

    this.events = [];           // append-only
  }

  // ---------- Setup ----------
  setUserDefault(userId, initialCashCents = 0) {
    if (!this.accounts.has(userId)) {
      this.accounts.set(userId, { cash: initialCashCents, reservedCash: 0 });
    } else {
      const acct = this.accounts.get(userId);
      acct.cash = initialCashCents;
      acct.reservedCash = 0;
    }
  }

  ensureUser(userId) {
    if (!this.accounts.has(userId)) {
      this.accounts.set(userId, { cash: 0, reservedCash: 0 });
    }
  }

  ensureBook(assetId, initialPriceCents = 1000) {
    if (!this.books.has(assetId)) this.books.set(assetId, new Book());
    if (!this.lastPrice.has(assetId)) this.lastPrice.set(assetId, initialPriceCents);
  }

  validateUser(userId) {
    if (!this.accounts.has(userId)) throw new UnknownUser(userId);
  }

  validateAsset(assetId) {
    if (!this.assets.has(assetId)) throw new UnknownAsset(assetId);
  }

  createPersonAsset({ issuerUserId, assetId, totalSupply = 1000, issuerPct = 0.6, name = null }) {
    if (this.assets.has(assetId)) throw new Error("asset already exists");
    if (totalSupply <= 0) throw new Error("totalSupply must be > 0");
    if (!(issuerPct > 0 && issuerPct < 1)) throw new Error("issuerPct must be between 0 and 1");

    this.ensureUser(issuerUserId);
    this.ensureUser(TREASURY_USER);
    this.ensureBook(assetId);

    const issuerShares = Math.round(totalSupply * issuerPct);
    const treasuryShares = totalSupply - issuerShares;

    this.assets.set(assetId, {
      assetId,
      issuerUserId,
      totalSupply,
      name: name ?? `${issuerUserId}'s ${assetId}`,
    });

    this._getHolding(issuerUserId, assetId).shares += issuerShares;
    this._getHolding(TREASURY_USER, assetId).shares += treasuryShares;

    const seq = this._nextSeq();
    this._emit(EventType.ASSET_CREATED, seq, {
      asset_id: assetId,
      issuer_user_id: issuerUserId,
      total_supply: totalSupply,
      distribution: [
        { user_id: issuerUserId, shares: issuerShares },
        { user_id: TREASURY_USER, shares: treasuryShares },
      ],
    });

    this._emit(EventType.SHARES_MOVED, this._nextSeq(), {
      asset_id: assetId,
      from_user_id: null,
      to_user_id: issuerUserId,
      shares: issuerShares,
      reason: "ISSUANCE",
    });

    if (treasuryShares !== 0) {
      this._emit(EventType.SHARES_MOVED, this._nextSeq(), {
        asset_id: assetId,
        from_user_id: null,
        to_user_id: TREASURY_USER,
        shares: treasuryShares,
        reason: "ISSUANCE",
      });
    }

    return { events: this._drainNewEvents() };
  }

  // ---------- Trading API ----------
  processOrder(req) {
    this._validateNewOrder(req);

    const order = {
      id: this._orderId(),
      userId: req.userId,
      assetId: req.assetId,
      side: req.side,
      qty: req.qty,
      remainingQty: req.qty,
      limitPriceCents: req.limitPriceCents,
      status: OrderStatus.OPEN,
      seq: this._nextSeq(),
    };

    // reserve upfront
    this._reserveForOrder(order);

    this._emit(EventType.ORDER_PLACED, order.seq, {
      order_id: order.id,
      user_id: order.userId,
      asset_id: order.assetId,
      side: order.side,
      qty: order.qty,
      limit_price_cents: order.limitPriceCents,
    });

    // match
    const trades = this._match(order);

    // rest remaining
    if (order.remainingQty > 0 && order.status !== OrderStatus.CANCELED && order.status !== OrderStatus.REJECTED) {
      this._addToBook(order);
      if (order.remainingQty < order.qty) order.status = OrderStatus.PARTIALLY_FILLED;
    } else {
      if (order.remainingQty === 0) order.status = OrderStatus.FILLED;
    }

    this.orders.set(order.id, order);

    return { order, trades, events: this._drainNewEvents() };
  }

  cancelOrder(orderId) {
    const order = this.orders.get(orderId);
    if (!order) throw new UnknownOrder(orderId);
    if ([OrderStatus.FILLED, OrderStatus.CANCELED, OrderStatus.REJECTED].includes(order.status)) {
      return { order, events: [] };
    }

    order.status = OrderStatus.CANCELED;
    this._releaseRemainingReserve(order);

    const seq = this._nextSeq();
    this._emit(EventType.ORDER_CANCELED, seq, {
      order_id: order.id,
      user_id: order.userId,
      asset_id: order.assetId,
      side: order.side,
      remaining_qty: 0,
    });

    return { order, events: this._drainNewEvents() };
  }

  _match(incoming) {
    this.ensureBook(incoming.assetId);
    const book = this.books.get(incoming.assetId);
    const trades = [];

    while (incoming.remainingQty > 0) {
      const bestId = this._peekBestOpposite(book, incoming.side);
      if (bestId == null) break;

      const resting = this.orders.get(bestId);
      if (!resting || !this._isOpen(resting)) {
        this._popBestOpposite(book, incoming.side);
        continue;
      }

      if (!this._isPriceCross(incoming, resting)) break;

      this._popBestOpposite(book, incoming.side);

      const fillQty = Math.min(incoming.remainingQty, resting.remainingQty);
      const tradePrice = resting.limitPriceCents;

      const trade = this._executeTrade({
        assetId: incoming.assetId,
        priceCents: tradePrice,
        qty: fillQty,
        taker: incoming,
        maker: resting,
      });

      trades.push(trade);

      if (resting.remainingQty > 0) {
        resting.status = OrderStatus.PARTIALLY_FILLED;
        this._addToBook(resting);
      } else {
        resting.status = OrderStatus.FILLED;
      }

      if (incoming.remainingQty === 0) incoming.status = OrderStatus.FILLED;
    }

    return trades;
  }

   _executeTrade({ assetId, priceCents, qty, taker, maker }) {
    const isTakerBuy = taker.side === Side.BUY;
    const buyer = isTakerBuy ? taker : maker;
    const seller = isTakerBuy ? maker : taker;

    const notional = priceCents * qty;

    // Buy-side reserve release at LIMIT*qty, spend at TRADE*qty
    this._consumeBuyReserveOnFill(buyer, qty);
    this._acct(buyer.userId).cash -= notional;

    // Seller reserve shares, deliver shares, receive cash
    this._consumeSharesReserve(seller.userId, assetId, qty);
    this._getHolding(seller.userId, assetId).shares -= qty;
    this._acct(seller.userId).cash += notional;

    // Buyer receives shares
    this._getHolding(buyer.userId, assetId).shares += qty;

    taker.remainingQty -= qty;
    maker.remainingQty -= qty;

    this.lastPrice.set(assetId, priceCents);

    const trade = {
      id: this._tradeId(),
      assetId,
      priceCents,
      qty,
      buyOrderId: buyer.id,
      sellOrderId: seller.id,
      buyerId: buyer.userId,
      sellerId: seller.userId,
      tsSeq: this._nextSeq(),
    };

    this._emit(EventType.TRADE_EXECUTED, trade.tsSeq, {
      trade_id: trade.id,
      asset_id: assetId,
      price_cents: priceCents,
      qty,
      buy_order_id: trade.buyOrderId,
      sell_order_id: trade.sellOrderId,
      buyer_id: trade.buyerId,
      seller_id: trade.sellerId,
    });

    this._emit(EventType.CASH_MOVED, this._nextSeq(), {
      asset_id: assetId,
      from_user_id: trade.buyerId,
      to_user_id: trade.sellerId,
      cash_cents: notional,
      reason: "TRADE",
      trade_id: trade.id,
    });

    this._emit(EventType.SHARES_MOVED, this._nextSeq(), {
      asset_id: assetId,
      from_user_id: trade.sellerId,
      to_user_id: trade.buyerId,
      shares: qty,
      reason: "TRADE",
      trade_id: trade.id,
    });

    return trade;
  }

  // ---------- Book helpers ----------
  _addToBook(order) {
    this.ensureBook(order.assetId);
    const book = this.books.get(order.assetId);

    if (order.side === Side.BUY) {
      book.bids.push({ price: order.limitPriceCents, seq: order.seq, orderId: order.id });
    } else {
      book.asks.push({ price: order.limitPriceCents, seq: order.seq, orderId: order.id });
    }

    this.orders.set(order.id, order);
  }

  _peekBestOpposite(book, incomingSide) {
    const heap = incomingSide === Side.BUY ? book.asks : book.bids;
    while (heap.size()) {
      const top = heap.peek();
      const o = this.orders.get(top.orderId);
      if (o && this._isOpen(o)) return top.orderId;
      heap.pop(); // lazy delete
    }
    return null;
  }

  _popBestOpposite(book, incomingSide) {
    const heap = incomingSide === Side.BUY ? book.asks : book.bids;
    while (heap.size()) {
      const top = heap.pop();
      const o = this.orders.get(top.orderId);
      if (o && this._isOpen(o)) return top.orderId;
    }
    return null;
  }

  _isPriceCross(incoming, resting) {
    if (incoming.side === Side.BUY) return incoming.limitPriceCents >= resting.limitPriceCents;
    return incoming.limitPriceCents <= resting.limitPriceCents;
  }

  _isOpen(order) {
    return (order.status === OrderStatus.OPEN || order.status === OrderStatus.PARTIALLY_FILLED) && order.remainingQty > 0;
  }

  // ---------- Validation + reserves ----------
  _validateNewOrder(req) {
    if (!req || typeof req !== "object") throw new Error("bad order");
    if (req.qty <= 0) throw new Error("qty must be > 0");
    if (req.limitPriceCents <= 0) throw new Error("limitPriceCents must be > 0");
    this.validateUser(req.userId);
    this.validateAsset(req.assetId);
  }

  _reserveForOrder(order) {
    if (order.side === Side.BUY) {
      const needed = order.limitPriceCents * order.remainingQty;
      const acct = this._acct(order.userId);
      const available = acct.cash - acct.reservedCash;
      if (available < needed) {
        order.status = OrderStatus.REJECTED;
        throw new InsufficientFunds(`need ${needed}, available ${available}`);
      }
      acct.reservedCash += needed;
    } else {
      const h = this._getHolding(order.userId, order.assetId);
      const available = h.shares - h.reservedShares;
      if (available < order.remainingQty) {
        order.status = OrderStatus.REJECTED;
        throw new InsufficientShares(`need ${order.remainingQty}, available ${available}`);
      }
      h.reservedShares += order.remainingQty;
    }
  }

  _consumeBuyReserveOnFill(buyOrder, fillQty) {
    const acct = this._acct(buyOrder.userId);
    const release = buyOrder.limitPriceCents * fillQty;
    if (acct.reservedCash < release) throw new InsufficientFunds("reserved cash underflow on fill");
    acct.reservedCash -= release;
  }

  _consumeSharesReserve(userId, assetId, shares) {
    const h = this._getHolding(userId, assetId);
    if (h.reservedShares < shares) throw new InsufficientShares("reserved shares underflow");
    h.reservedShares -= shares;
  }

  _releaseRemainingReserve(order) {
    if (order.remainingQty <= 0) return;

    if (order.side === Side.BUY) {
      const refund = order.limitPriceCents * order.remainingQty;
      const acct = this._acct(order.userId);
      acct.reservedCash = Math.max(0, acct.reservedCash - refund);
    } else {
      const h = this._getHolding(order.userId, order.assetId);
      h.reservedShares = Math.max(0, h.reservedShares - order.remainingQty);
    }
    order.remainingQty = 0;
  }

  // ---------- Events + replay ----------
  _emit(type, tsSeq, data) {
    const ev = { id: this._eventId(), type, tsSeq, data };
    this.events.push(ev);
    return ev;
  }

  _drainNewEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  rebuildFromEvents(rows) {
    // rows: [{ ts_seq, type, data }]
    // wipe balances/holdings
    for (const acct of this.accounts.values()) {
      acct.cash = 0;
      acct.reservedCash = 0;
    }
    for (const h of this.holdings.values()) {
      h.shares = 0;
      h.reservedShares = 0;
    }

    const sorted = [...rows].sort((a, b) => (a.ts_seq - b.ts_seq));
    for (const r of sorted) {
      if (r.type === EventType.CASH_MOVED) {
        const { from_user_id, to_user_id, cash_cents } = r.data;
        if (from_user_id) this._acct(from_user_id).cash -= cash_cents;
        if (to_user_id) this._acct(to_user_id).cash += cash_cents;
      }
      if (r.type === EventType.SHARES_MOVED) {
        const { asset_id, from_user_id, to_user_id, shares } = r.data;
        this.ensureBook(asset_id);
        if (from_user_id) this._getHolding(from_user_id, asset_id).shares -= shares;
        if (to_user_id) this._getHolding(to_user_id, asset_id).shares += shares;
      }
    }
  }

  // ---------- State helpers ----------
  _acct(userId) {
    this.ensureUser(userId);
    return this.accounts.get(userId);
  }

  _holdingKey(userId, assetId) {
    return `${userId}|${assetId}`;
  }

  _getHolding(userId, assetId) {
    const k = this._holdingKey(userId, assetId);
    if (!this.holdings.has(k)) this.holdings.set(k, { shares: 0, reservedShares: 0 });
    return this.holdings.get(k);
  }

  _nextSeq() {
    return this._seq();
  }
}