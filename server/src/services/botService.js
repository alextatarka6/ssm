const marketService = require("./marketService");
const { Side, OrderStatus, BOT_INITIAL_CASH_CENTS, TREASURY_USER } = require("../engine/constants");

const TICK_INTERVAL_MS = 3 * 60 * 1000;
const STALE_ORDER_AGE_MS = TICK_INTERVAL_MS * 2; // cancel bot orders older than 2 ticks
const STALE_CHECK_INTERVAL_MS = 60 * 1000; // check every minute
const MAX_HOLDING_PCT = 0.12; // bots won't hold more than 12% of any single stock
const ORDER_SIZE = 2; // shares per price level
const QUOTE_LEVELS = 6; // number of price levels quoted on each side
// Bootstrap shares taken from treasury on a bot's first tick for a stock,
// giving them enough sell inventory to quote all sell levels immediately.
const BOOTSTRAP_SHARES = ORDER_SIZE * QUOTE_LEVELS;

const BOTS = [
  { userId: "BOT_ALPHA", username: "Bot Alpha", spreadPct: 0.015 },
  { userId: "BOT_BETA",  username: "Bot Beta",  spreadPct: 0.020 },
  { userId: "BOT_GAMMA", username: "Bot Gamma", spreadPct: 0.025 },
  { userId: "BOT_DELTA", username: "Bot Delta", spreadPct: 0.030 },
];

async function initialize() {
  for (const bot of BOTS) {
    await marketService.mutate((market) => {
      if (!market.users.has(bot.userId)) {
        market.createUser({
          userId: bot.userId,
          username: bot.username,
          initialCashCents: BOT_INITIAL_CASH_CENTS,
          isBot: true,
        });
      }
    });
  }
  console.log("[bot] Bot users initialized");
}

async function tick(bot) {
  await marketService.mutate((market) => {
    if (market.paused) return;

    const botUser = market.users.get(bot.userId);
    if (!botUser) return;

    // Cancel all open orders for this bot before re-quoting
    for (const order of market.orders.values()) {
      if (
        order.userId === bot.userId &&
        [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED].includes(order.status) &&
        order.remainingQty > 0
      ) {
        market.cancelOrder(order.id);
      }
    }

    for (const stock of market.stocks.values()) {
      const lastPrice = market.lastPriceCents.get(stock.assetId) || 1000;
      const holding = market._getHolding(bot.userId, stock.assetId);
      const maxShares = Math.floor(stock.totalSupply * MAX_HOLDING_PCT);

      // Bootstrap sell inventory from treasury on first tick for this stock
      // so bots can quote both sides immediately instead of only buy orders.
      if (holding.shares === 0) {
        const treasuryHolding = market._getHolding(TREASURY_USER, stock.assetId);
        const toTake = Math.min(BOOTSTRAP_SHARES, Math.floor(treasuryHolding.shares * 0.02));
        if (toTake > 0) {
          holding.shares += toTake;
          treasuryHolding.shares -= toTake;
        }
      }

      // Quote buy levels below last price
      for (let level = 1; level <= QUOTE_LEVELS; level++) {
        const availableCash = botUser.cashCents - botUser.reservedCashCents;
        if (holding.shares >= maxShares) break;
        if (availableCash < lastPrice * ORDER_SIZE) break;
        const bidPrice = Math.max(1, Math.round(lastPrice * (1 - bot.spreadPct * level)));
        try {
          market.placeOrder({
            userId: bot.userId,
            assetId: stock.assetId,
            side: Side.BUY,
            qty: ORDER_SIZE,
            limitPriceCents: bidPrice,
          });
        } catch {
          break;
        }
      }

      // Quote sell levels above last price
      for (let level = 1; level <= QUOTE_LEVELS; level++) {
        const availableShares = holding.shares - holding.reservedShares;
        if (availableShares < ORDER_SIZE) break;
        const askPrice = Math.round(lastPrice * (1 + bot.spreadPct * level));
        try {
          market.placeOrder({
            userId: bot.userId,
            assetId: stock.assetId,
            side: Side.SELL,
            qty: ORDER_SIZE,
            limitPriceCents: askPrice,
          });
        } catch {
          break;
        }
      }
    }
  }).catch((err) => {
    console.error(`[bot] ${bot.userId} tick error:`, err.message);
  });
}

async function cancelStaleOrders() {
  await marketService.mutate((market) => {
    if (market.paused) return;
    const botIds = new Set(BOTS.map((b) => b.userId));
    const cutoff = Date.now() - STALE_ORDER_AGE_MS;
    for (const order of market.orders.values()) {
      if (
        botIds.has(order.userId) &&
        [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED].includes(order.status) &&
        order.remainingQty > 0 &&
        order.createdAt < cutoff
      ) {
        market.cancelOrder(order.id);
      }
    }
  }).catch((err) => {
    console.error("[bot] stale order cleanup error:", err.message);
  });
}

function start() {
  // Stagger bot ticks evenly across the interval so they don't all fire at once
  BOTS.forEach((bot, index) => {
    const offset = index * Math.floor(TICK_INTERVAL_MS / BOTS.length);
    setTimeout(() => {
      tick(bot);
      setInterval(() => tick(bot), TICK_INTERVAL_MS);
    }, offset);
  });
  setInterval(cancelStaleOrders, STALE_CHECK_INTERVAL_MS);
  console.log("[bot] Bot traders started");
}

module.exports = { initialize, start };
