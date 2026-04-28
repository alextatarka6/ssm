const marketService = require("./marketService");
const { Side, OrderStatus, BOT_INITIAL_CASH_CENTS } = require("../engine/constants");

const TICK_INTERVAL_MS = 3 * 60 * 1000;
const MAX_HOLDING_PCT = 0.12; // bots won't hold more than 12% of any single stock
const ORDER_SIZE = 3; // shares per order

const BOTS = [
  { userId: "BOT_ALPHA", username: "Bot Alpha", spreadPct: 0.020 },
  { userId: "BOT_BETA",  username: "Bot Beta",  spreadPct: 0.030 },
  { userId: "BOT_GAMMA", username: "Bot Gamma", spreadPct: 0.025 },
  { userId: "BOT_DELTA", username: "Bot Delta", spreadPct: 0.035 },
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
      const availableCash = botUser.cashCents - botUser.reservedCashCents;
      const availableShares = holding.shares - holding.reservedShares;

      if (holding.shares < maxShares && availableCash >= lastPrice * ORDER_SIZE) {
        const bidPrice = Math.max(1, Math.round(lastPrice * (1 - bot.spreadPct)));
        try {
          market.placeOrder({
            userId: bot.userId,
            assetId: stock.assetId,
            side: Side.BUY,
            qty: ORDER_SIZE,
            limitPriceCents: bidPrice,
          });
        } catch {
          // insufficient funds or cap — skip
        }
      }

      if (availableShares >= ORDER_SIZE) {
        const askPrice = Math.round(lastPrice * (1 + bot.spreadPct));
        try {
          market.placeOrder({
            userId: bot.userId,
            assetId: stock.assetId,
            side: Side.SELL,
            qty: ORDER_SIZE,
            limitPriceCents: askPrice,
          });
        } catch {
          // insufficient shares — skip
        }
      }
    }
  }).catch((err) => {
    console.error(`[bot] ${bot.userId} tick error:`, err.message);
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
  console.log("[bot] Bot traders started");
}

module.exports = { initialize, start };
