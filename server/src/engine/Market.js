const User = require("../models/User");
const Stock = require("../models/Stock");
const Order = require("../models/Order");
const Holding = require("../models/Holding");
const Trade = require("../models/Trade");
const {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  InsufficientFundsError,
  InsufficientSharesError,
} = require("../utils/errors");
const { TREASURY_USER, Side, OrderStatus, EventType } = require("./constants");

class Market {
  constructor() {
    this.reset();
  }

  reset() {
    this.users = new Map();
    this.stocks = new Map();
    this.holdings = new Map();
    this.orders = new Map();
    this.trades = [];
    this.events = [];
    this.lastPriceCents = new Map();
    this.generators = {
      nextOrderId: 1,
      nextTradeId: 1,
      nextSeq: 1,
      nextEventId: 1,
    };
  }

  static fromSnapshot(snapshot = {}) {
    // The Python backend rebuilt state from persisted events and open orders.
    // This Node port stores a clean snapshot so the API can stay stateless at the transport layer
    // while preserving the same matching and ledger behavior inside the engine.
    const market = new Market();

    if (snapshot.generators) {
      market.generators = {
        ...market.generators,
        ...snapshot.generators,
      };
    }

    for (const rawUser of snapshot.users || []) {
      const user = new User(rawUser);
      market.users.set(user.userId, user);
    }

    for (const rawStock of snapshot.stocks || []) {
      const stock = new Stock(rawStock);
      market.stocks.set(stock.assetId, stock);
    }

    for (const rawHolding of snapshot.holdings || []) {
      const holding = new Holding(rawHolding);
      market.holdings.set(market._holdingKey(holding.userId, holding.assetId), holding);
    }

    for (const rawOrder of snapshot.orders || []) {
      const order = new Order(rawOrder);
      market.orders.set(order.id, order);
    }

    for (const rawTrade of snapshot.trades || []) {
      market.trades.push(new Trade(rawTrade));
    }

    for (const [assetId, priceCents] of Object.entries(snapshot.lastPriceCents || {})) {
      market.lastPriceCents.set(assetId, priceCents);
    }

    for (const event of snapshot.events || []) {
      market.events.push(event);
    }

    return market;
  }

  toSnapshot() {
    return {
      version: 1,
      generators: { ...this.generators },
      users: [...this.users.values()].map((user) => user.toJSON()),
      stocks: [...this.stocks.values()].map((stock) => stock.toJSON()),
      holdings: [...this.holdings.values()].map((holding) => holding.toJSON()),
      orders: [...this.orders.values()].map((order) => order.toJSON()),
      trades: this.trades.map((trade) => trade.toJSON()),
      lastPriceCents: Object.fromEntries(this.lastPriceCents.entries()),
      events: this.events.map((event) => ({ ...event })),
    };
  }

  createUser({ userId, initialCashCents = 500000, username }) {
    const normalizedUserId = this._normalizeRequiredString(userId, "user_id");

    if (this.users.has(normalizedUserId)) {
      const existingUser = this.users.get(normalizedUserId);
      existingUser.cashCents = initialCashCents;
      return this.serializeUser(existingUser);
    }

    const user = new User({
      userId: normalizedUserId,
      cashCents: initialCashCents,
      reservedCashCents: 0,
    });

    this.users.set(normalizedUserId, user);
    this._emit(EventType.USER_CREATED, {
      userId: normalizedUserId,
      cashCents: initialCashCents,
    });

    if (normalizedUserId !== TREASURY_USER) {
      const assetId = this._slugify(username || normalizedUserId);
      if (assetId && !this.stocks.has(assetId)) {
        try {
          this.createPersonAsset({ issuerUserId: normalizedUserId, assetId, name: "Stock" });
        } catch {
          // Skip if issuance fails (e.g. asset_id collision)
        }
      }
    }

    return this.serializeUser(user);
  }

  listUsers() {
    return [...this.users.values()]
      .sort((left, right) => left.userId.localeCompare(right.userId))
      .map((user) => this.serializeUser(user));
  }

  getUser(userId) {
    const user = this._requireUser(userId);
    return this.serializeUser(user);
  }

  getBalance(userId) {
    const user = this._requireUser(userId);
    return {
      user_id: user.userId,
      cash_cents: user.cashCents,
      reserved_cash_cents: user.reservedCashCents,
      available_cash_cents: user.cashCents - user.reservedCashCents,
    };
  }

  createPersonAsset({
    issuerUserId,
    assetId,
    totalSupply = 1000,
    issuerPct = 0.4,
    name,
  }) {
    const normalizedIssuerId = this._normalizeRequiredString(issuerUserId, "issuer_user_id");
    const normalizedAssetId = this._normalizeRequiredString(assetId, "asset_id");

    this._requireUser(normalizedIssuerId);

    if (this.stocks.has(normalizedAssetId)) {
      throw new ConflictError("Asset already exists.");
    }
    if (!Number.isInteger(totalSupply) || totalSupply <= 0) {
      throw new ValidationError("Total supply must be a positive integer.");
    }
    if (typeof issuerPct !== "number" || issuerPct <= 0 || issuerPct >= 1) {
      throw new ValidationError("Issuer percentage must be between 0 and 1.");
    }

    const stock = new Stock({
      assetId: normalizedAssetId,
      issuerUserId: normalizedIssuerId,
      totalSupply,
      name: typeof name === "string" && name.trim() ? name.trim() : `${normalizedIssuerId}'s ${normalizedAssetId}`,
    });

    this.stocks.set(stock.assetId, stock);
    this.lastPriceCents.set(stock.assetId, 1000);

    const issuerShares = Math.round(totalSupply * issuerPct);
    const treasuryShares = totalSupply - issuerShares;

    if (!this.users.has(TREASURY_USER)) {
      this.createUser({ userId: TREASURY_USER, initialCashCents: 0 });
    }

    this._getHolding(normalizedIssuerId, stock.assetId).shares += issuerShares;
    this._getHolding(TREASURY_USER, stock.assetId).shares += treasuryShares;

    // Grant treasury cash so it can quote both sides of the market from day one
    this.users.get(TREASURY_USER).cashCents += treasuryShares * 1000;

    this._emit(EventType.ASSET_CREATED, {
      assetId: stock.assetId,
      issuerUserId: stock.issuerUserId,
      totalSupply: stock.totalSupply,
      name: stock.name,
      distribution: [
        { userId: normalizedIssuerId, shares: issuerShares },
        { userId: TREASURY_USER, shares: treasuryShares },
      ],
    });

    this._emit(EventType.SHARES_MOVED, {
      assetId: stock.assetId,
      fromUserId: null,
      toUserId: normalizedIssuerId,
      shares: issuerShares,
      reason: "ISSUANCE",
    });

    if (treasuryShares > 0) {
      this._emit(EventType.SHARES_MOVED, {
        assetId: stock.assetId,
        fromUserId: null,
        toUserId: TREASURY_USER,
        shares: treasuryShares,
        reason: "ISSUANCE",
      });
    }

    this._rebalanceTreasuryOrders(stock.assetId);

    return this.serializeAsset(stock);
  }

  updateAsset(assetId, { issuerUserId, name }) {
    const stock = this._requireAsset(assetId);
    const normalizedIssuerId = this._normalizeRequiredString(issuerUserId, "issuer_user_id");
    const normalizedName = this._normalizeRequiredString(name, "name");

    if (stock.issuerUserId !== normalizedIssuerId) {
      throw new ForbiddenError("Only the issuer can update this stock label.");
    }

    stock.name = normalizedName;
    return this.serializeAsset(stock);
  }

  listAssets() {
    return [...this.stocks.values()]
      .sort((left, right) => left.assetId.localeCompare(right.assetId))
      .map((stock) => this.serializeAsset(stock));
  }

  getAsset(assetId) {
    const stock = this._requireAsset(assetId);
    return this.serializeAsset(stock);
  }

  buyStock({ userId, assetId, qty, limitPriceCents }) {
    return this.placeOrder({
      userId,
      assetId,
      side: Side.BUY,
      qty,
      limitPriceCents,
    });
  }

  sellStock({ userId, assetId, qty, limitPriceCents }) {
    return this.placeOrder({
      userId,
      assetId,
      side: Side.SELL,
      qty,
      limitPriceCents,
    });
  }

  placeOrder({ userId, assetId, side, qty, limitPriceCents }) {
    const normalizedUserId = this._normalizeRequiredString(userId, "user_id");
    const normalizedAssetId = this._normalizeRequiredString(assetId, "asset_id");

    if (!Object.values(Side).includes(side)) {
      throw new ValidationError("Order side must be BUY or SELL.");
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new ValidationError("Order quantity must be a positive integer.");
    }
    if (!Number.isInteger(limitPriceCents) || limitPriceCents <= 0) {
      throw new ValidationError("Limit price must be a positive integer.");
    }

    this._requireUser(normalizedUserId);
    this._requireAsset(normalizedAssetId);

    const order = new Order({
      id: this.generators.nextOrderId++,
      userId: normalizedUserId,
      assetId: normalizedAssetId,
      side,
      qty,
      remainingQty: qty,
      limitPriceCents,
      status: OrderStatus.OPEN,
      seq: this._nextSeq(),
    });

    this._reserveForOrder(order);
    this._emit(EventType.ORDER_PLACED, {
      orderId: order.id,
      userId: order.userId,
      assetId: order.assetId,
      side: order.side,
      qty: order.qty,
      limitPriceCents: order.limitPriceCents,
    });

    const trades = this._match(order);

    if (order.remainingQty > 0 && ![OrderStatus.REJECTED, OrderStatus.CANCELED].includes(order.status)) {
      if (order.remainingQty < order.qty) {
        order.status = OrderStatus.PARTIALLY_FILLED;
      } else {
        order.status = OrderStatus.OPEN;
      }
    } else if (order.remainingQty === 0) {
      order.status = OrderStatus.FILLED;
    }

    this.orders.set(order.id, order);

    if (trades.length > 0) {
      this._rebalanceTreasuryOrders(normalizedAssetId);
    }

    return {
      order: this.serializeOrder(order),
      trades: trades.map((trade) => this.serializeTrade(trade)),
    };
  }

  cancelOrder(orderId) {
    const numericOrderId = this._normalizePositiveInteger(orderId, "order_id");
    const order = this.orders.get(numericOrderId);

    if (!order) {
      throw new NotFoundError("Order not found.");
    }

    if ([OrderStatus.FILLED, OrderStatus.CANCELED, OrderStatus.REJECTED].includes(order.status)) {
      return this.serializeOrder(order);
    }

    order.status = OrderStatus.CANCELED;
    this._releaseRemainingReserve(order);
    this._emit(EventType.ORDER_CANCELED, {
      orderId: order.id,
      userId: order.userId,
      assetId: order.assetId,
      side: order.side,
      remainingQty: order.remainingQty,
    });

    return this.serializeOrder(order);
  }

  processOrders() {
    return {
      ok: true,
      processed_order_count: 0,
      message: "Orders are price-matched immediately when they are submitted.",
    };
  }

  getOrderBook(assetId) {
    const normalizedAssetId = this._normalizeRequiredString(assetId, "asset_id");
    this._requireAsset(normalizedAssetId);

    const buyOrders = [];
    const sellOrders = [];

    for (const order of this.orders.values()) {
      if (
        order.assetId !== normalizedAssetId ||
        ![OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED].includes(order.status) ||
        order.remainingQty <= 0
      ) {
        continue;
      }

      const target = order.side === Side.BUY ? buyOrders : sellOrders;
      target.push(this.serializeOrder(order));
    }

    buyOrders.sort((left, right) => right.limit_price_cents - left.limit_price_cents || left.seq - right.seq);
    sellOrders.sort((left, right) => left.limit_price_cents - right.limit_price_cents || left.seq - right.seq);

    return {
      asset_id: normalizedAssetId,
      buys: buyOrders,
      sells: sellOrders,
    };
  }

  getTrades(assetId, limit = 100) {
    const normalizedAssetId = this._normalizeRequiredString(assetId, "asset_id");
    this._requireAsset(normalizedAssetId);

    return this.trades
      .filter((trade) => trade.assetId === normalizedAssetId)
      .sort((left, right) => left.tsSeq - right.tsSeq || left.id - right.id)
      .slice(0, limit)
      .map((trade) => this.serializeTrade(trade));
  }

  getCandles(assetId, intervalTrades = 5, limit = 50) {
    const trades = this.getTrades(assetId, intervalTrades * limit);

    if (trades.length === 0) {
      throw new NotFoundError("No trade history for asset.");
    }

    const prices = trades.map((trade) => trade.price_cents / 100);
    const bars = [];
    const barCount = Math.ceil(prices.length / intervalTrades);
    const nowSec = Math.floor(Date.now() / 1000);

    for (let index = 0; index < prices.length; index += intervalTrades) {
      const barIndex = index / intervalTrades;
      const window = prices.slice(index, index + intervalTrades);
      bars.push({
        time: nowSec - (barCount - 1 - barIndex) * 60,
        open: window[0],
        high: Math.max(...window),
        low: Math.min(...window),
        close: window[window.length - 1],
      });
    }

    let previousHaOpen = (bars[0].open + bars[0].close) / 2;
    let previousHaClose = (bars[0].open + bars[0].high + bars[0].low + bars[0].close) / 4;

    return {
      asset_id: assetId,
      bars: bars.map((bar) => {
        const haClose = (bar.open + bar.high + bar.low + bar.close) / 4;
        const haOpen = (previousHaOpen + previousHaClose) / 2;
        const haHigh = Math.max(bar.high, haOpen, haClose);
        const haLow = Math.min(bar.low, haOpen, haClose);

        previousHaOpen = haOpen;
        previousHaClose = haClose;

        return {
          ...bar,
          ha_open: haOpen,
          ha_high: haHigh,
          ha_low: haLow,
          ha_close: haClose,
        };
      }),
    };
  }

  deleteUser(userId) {
    const normalizedUserId = this._normalizeRequiredString(userId, "user_id");

    if (!this.users.has(normalizedUserId)) {
      throw new NotFoundError(`Unknown user: ${normalizedUserId}`);
    }

    for (const order of this.orders.values()) {
      if (
        order.userId === normalizedUserId &&
        [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED].includes(order.status) &&
        order.remainingQty > 0
      ) {
        order.status = OrderStatus.CANCELED;
        this._releaseRemainingReserve(order);
      }
    }

    for (const [key, holding] of this.holdings.entries()) {
      if (holding.userId === normalizedUserId) {
        this.holdings.delete(key);
      }
    }

    this.users.delete(normalizedUserId);
  }

  getPortfolio(userId) {
    const user = this._requireUser(userId);
    const holdings = [];

    for (const holding of this.holdings.values()) {
      if (holding.userId !== user.userId) {
        continue;
      }

      holdings.push({
        asset_id: holding.assetId,
        shares: holding.shares,
        reserved_shares: holding.reservedShares,
        last_price_cents: this.lastPriceCents.get(holding.assetId) || null,
        market_value_cents: (this.lastPriceCents.get(holding.assetId) || 0) * holding.shares,
      });
    }

    holdings.sort((left, right) => left.asset_id.localeCompare(right.asset_id));

    return {
      user_id: user.userId,
      cash_cents: user.cashCents,
      reserved_cash_cents: user.reservedCashCents,
      holdings,
    };
  }

  serializeUser(user) {
    return {
      user_id: user.userId,
      cash_cents: user.cashCents,
      reserved_cash_cents: user.reservedCashCents,
    };
  }

  serializeAsset(stock) {
    return {
      asset_id: stock.assetId,
      issuer_user_id: stock.issuerUserId,
      issuer_username: null,
      issuer_avatar_url: null,
      total_supply: stock.totalSupply,
      name: stock.name,
      last_price_cents: this.lastPriceCents.get(stock.assetId) || null,
      sell_order_shares: this._getOpenSellOrderShares(stock.assetId),
    };
  }

  serializeOrder(order) {
    return {
      id: order.id,
      user_id: order.userId,
      asset_id: order.assetId,
      side: order.side,
      qty: order.qty,
      remaining_qty: order.remainingQty,
      limit_price_cents: order.limitPriceCents,
      status: order.status,
      seq: order.seq,
    };
  }

  serializeTrade(trade) {
    return {
      id: trade.id,
      asset_id: trade.assetId,
      price_cents: trade.priceCents,
      qty: trade.qty,
      buy_order_id: trade.buyOrderId,
      sell_order_id: trade.sellOrderId,
      buyer_id: trade.buyerId,
      seller_id: trade.sellerId,
      ts_seq: trade.tsSeq,
    };
  }

  _rebalanceTreasuryOrders(assetId) {
    // Cancel all open treasury orders for this asset
    for (const order of this.orders.values()) {
      if (
        order.userId === TREASURY_USER &&
        order.assetId === assetId &&
        [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED].includes(order.status) &&
        order.remainingQty > 0
      ) {
        order.status = OrderStatus.CANCELED;
        this._releaseRemainingReserve(order);
      }
    }

    const lastPrice = this.lastPriceCents.get(assetId);
    if (!lastPrice) return;

    const treasury = this.users.get(TREASURY_USER);
    if (!treasury) return;

    const holding = this._getHolding(TREASURY_USER, assetId);
    const availableShares = holding.shares - holding.reservedShares;
    const availableCash = treasury.cashCents - treasury.reservedCashCents;

    const sellPrice = Math.max(1, Math.round(lastPrice * 1.05));
    const buyPrice = Math.max(1, Math.round(lastPrice * 0.95));

    if (availableShares > 0) {
      const qty = Math.max(1, Math.floor(availableShares * 0.1));
      this._placeTreasuryOrder(assetId, Side.SELL, qty, sellPrice);
    }

    if (availableCash >= buyPrice) {
      const maxQty = Math.floor(availableCash / buyPrice);
      const qty = Math.max(1, Math.floor(maxQty * 0.1));
      this._placeTreasuryOrder(assetId, Side.BUY, qty, buyPrice);
    }
  }

  _placeTreasuryOrder(assetId, side, qty, limitPriceCents) {
    const order = new Order({
      id: this.generators.nextOrderId++,
      userId: TREASURY_USER,
      assetId,
      side,
      qty,
      remainingQty: qty,
      limitPriceCents,
      status: OrderStatus.OPEN,
      seq: this._nextSeq(),
    });

    try {
      this._reserveForOrder(order);
    } catch {
      // Treasury lacks the funds or shares for this order; skip it
      return;
    }

    this.orders.set(order.id, order);
  }

  _match(incoming) {
    const trades = [];

    while (incoming.remainingQty > 0) {
      const resting = this._findBestOppositeOrder(incoming);
      if (!resting || !this._isPriceCross(incoming, resting)) {
        break;
      }

      const fillQty = Math.min(incoming.remainingQty, resting.remainingQty);
      const tradePrice = resting.limitPriceCents;
      trades.push(this._executeTrade({ incoming, resting, fillQty, tradePrice }));

      if (resting.remainingQty === 0) {
        resting.status = OrderStatus.FILLED;
      } else {
        resting.status = OrderStatus.PARTIALLY_FILLED;
      }
    }

    return trades;
  }

  _executeTrade({ incoming, resting, fillQty, tradePrice }) {
    const buyer = incoming.side === Side.BUY ? incoming : resting;
    const seller = incoming.side === Side.SELL ? incoming : resting;
    const notional = tradePrice * fillQty;

    this._consumeBuyReserveOnFill(buyer, fillQty);
    this._requireUser(buyer.userId).cashCents -= notional;

    this._consumeSharesReserve(seller.userId, seller.assetId, fillQty);
    this._getHolding(seller.userId, seller.assetId).shares -= fillQty;
    this._requireUser(seller.userId).cashCents += notional;

    this._getHolding(buyer.userId, buyer.assetId).shares += fillQty;

    incoming.remainingQty -= fillQty;
    resting.remainingQty -= fillQty;

    if (incoming.remainingQty === 0) {
      incoming.status = OrderStatus.FILLED;
    }

    this.lastPriceCents.set(incoming.assetId, tradePrice);

    const trade = new Trade({
      id: this.generators.nextTradeId++,
      assetId: incoming.assetId,
      priceCents: tradePrice,
      qty: fillQty,
      buyOrderId: buyer.id,
      sellOrderId: seller.id,
      buyerId: buyer.userId,
      sellerId: seller.userId,
      tsSeq: this._nextSeq(),
    });

    this.trades.push(trade);

    this._emit(EventType.TRADE_EXECUTED, {
      tradeId: trade.id,
      assetId: trade.assetId,
      priceCents: trade.priceCents,
      qty: trade.qty,
      buyOrderId: trade.buyOrderId,
      sellOrderId: trade.sellOrderId,
      buyerId: trade.buyerId,
      sellerId: trade.sellerId,
    }, trade.tsSeq);

    this._emit(EventType.CASH_MOVED, {
      assetId: trade.assetId,
      fromUserId: buyer.userId,
      toUserId: seller.userId,
      cashCents: notional,
      reason: "TRADE",
    });

    this._emit(EventType.SHARES_MOVED, {
      assetId: trade.assetId,
      fromUserId: seller.userId,
      toUserId: buyer.userId,
      shares: fillQty,
      reason: "TRADE",
    });

    return trade;
  }

  _findBestOppositeOrder(incoming) {
    const candidates = [...this.orders.values()].filter((order) => {
      if (order.assetId !== incoming.assetId || order.side === incoming.side) {
        return false;
      }

      return [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED].includes(order.status) && order.remainingQty > 0;
    });

    candidates.sort((left, right) => {
      if (incoming.side === Side.BUY) {
        return left.limitPriceCents - right.limitPriceCents || left.seq - right.seq;
      }

      return right.limitPriceCents - left.limitPriceCents || left.seq - right.seq;
    });

    return candidates[0] || null;
  }

  _isPriceCross(incoming, resting) {
    if (incoming.side === Side.BUY) {
      return incoming.limitPriceCents >= resting.limitPriceCents;
    }

    return incoming.limitPriceCents <= resting.limitPriceCents;
  }

  _reserveForOrder(order) {
    if (order.side === Side.BUY) {
      const user = this._requireUser(order.userId);
      const needed = order.limitPriceCents * order.remainingQty;
      const available = user.cashCents - user.reservedCashCents;

      if (available < needed) {
        throw new InsufficientFundsError(`need: ${needed}, available: ${available}`);
      }

      user.reservedCashCents += needed;
      return;
    }

    const holding = this._getHolding(order.userId, order.assetId);
    const availableShares = holding.shares - holding.reservedShares;

    if (availableShares < order.remainingQty) {
      throw new InsufficientSharesError(`need: ${order.remainingQty}, available: ${availableShares}`);
    }

    holding.reservedShares += order.remainingQty;
  }

  _consumeBuyReserveOnFill(order, fillQty) {
    const user = this._requireUser(order.userId);
    const release = order.limitPriceCents * fillQty;

    if (user.reservedCashCents < release) {
      throw new InsufficientFundsError("Reserved cash underflow on fill.");
    }

    user.reservedCashCents -= release;
  }

  _consumeSharesReserve(userId, assetId, shares) {
    const holding = this._getHolding(userId, assetId);

    if (holding.reservedShares < shares) {
      throw new InsufficientSharesError("Reserved shares underflow.");
    }

    holding.reservedShares -= shares;
  }

  _releaseRemainingReserve(order) {
    if (order.remainingQty <= 0) {
      return;
    }

    if (order.side === Side.BUY) {
      const refund = order.limitPriceCents * order.remainingQty;
      const user = this._requireUser(order.userId);
      user.reservedCashCents = Math.max(0, user.reservedCashCents - refund);
    } else {
      const holding = this._getHolding(order.userId, order.assetId);
      holding.reservedShares = Math.max(0, holding.reservedShares - order.remainingQty);
    }

    order.remainingQty = 0;
  }

  _getOpenSellOrderShares(assetId) {
    let shares = 0;

    for (const order of this.orders.values()) {
      if (
        order.assetId === assetId &&
        order.side === Side.SELL &&
        [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED].includes(order.status) &&
        order.remainingQty > 0
      ) {
        shares += order.remainingQty;
      }
    }

    return shares;
  }

  _getHolding(userId, assetId) {
    const key = this._holdingKey(userId, assetId);
    if (!this.holdings.has(key)) {
      this.holdings.set(
        key,
        new Holding({
          userId,
          assetId,
          shares: 0,
          reservedShares: 0,
        }),
      );
    }
    return this.holdings.get(key);
  }

  _requireUser(userId) {
    const normalizedUserId = this._normalizeRequiredString(userId, "user_id");
    const user = this.users.get(normalizedUserId);
    if (!user) {
      throw new NotFoundError(`Unknown user: ${normalizedUserId}`);
    }
    return user;
  }

  _requireAsset(assetId) {
    const normalizedAssetId = this._normalizeRequiredString(assetId, "asset_id");
    const asset = this.stocks.get(normalizedAssetId);
    if (!asset) {
      throw new NotFoundError(`Unknown asset: ${normalizedAssetId}`);
    }
    return asset;
  }

  _normalizeRequiredString(value, field) {
    if (typeof value !== "string" || !value.trim()) {
      throw new ValidationError(`${field} is required.`);
    }
    return value.trim();
  }

  _normalizePositiveInteger(value, field) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new ValidationError(`${field} must be a positive integer.`);
    }
    return parsed;
  }

  _slugify(value) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || null;
  }

  _holdingKey(userId, assetId) {
    return `${userId}::${assetId}`;
  }

  _nextSeq() {
    const current = this.generators.nextSeq;
    this.generators.nextSeq += 1;
    return current;
  }

  _emit(type, data, tsSeq = this._nextSeq()) {
    const event = {
      id: this.generators.nextEventId++,
      type,
      ts_seq: tsSeq,
      data,
    };

    this.events.push(event);
    return event;
  }
}

module.exports = {
  Market,
  TREASURY_USER,
  Side,
  OrderStatus,
  EventType,
};
