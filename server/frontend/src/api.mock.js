const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms));

const MOCK_USER_ID = "mock-admin-user";

const ASSETS = [
  { asset_id: "alice", name: "Alice", issuer_user_id: "user-alice", issuer_username: "alice", last_price_cents: 4200, sell_order_shares: 8, treasury_available_shares: 120 },
  { asset_id: "bob", name: "Bob", issuer_user_id: "user-bob", issuer_username: "bob", last_price_cents: 7800, sell_order_shares: 3, treasury_available_shares: 95 },
  { asset_id: "charlie", name: "Charlie", issuer_user_id: MOCK_USER_ID, issuer_username: "dev", last_price_cents: 3100, sell_order_shares: 12, treasury_available_shares: 140 },
  { asset_id: "diana", name: "Diana", issuer_user_id: "user-diana", issuer_username: "diana", last_price_cents: 9500, sell_order_shares: 2, treasury_available_shares: 80 },
  { asset_id: "evan", name: "Evan", issuer_user_id: "user-evan", issuer_username: "evan", last_price_cents: 5600, sell_order_shares: 6, treasury_available_shares: 110 },
];

function generateCandles(basePrice, count = 50) {
  const now = Math.floor(Date.now() / 1000);
  const bars = [];
  let price = basePrice;
  for (let i = count; i >= 0; i--) {
    const change = (Math.random() - 0.48) * price * 0.04;
    const open = price;
    price = Math.max(100, price + change);
    const high = Math.max(open, price) * (1 + Math.random() * 0.01);
    const low = Math.min(open, price) * (1 - Math.random() * 0.01);
    bars.push({ time: now - i * 3600, open, high, low, close: price });
  }
  return bars;
}

let mockOrders = [
  { id: "order-1", asset_id: "alice", side: "BUY", qty: 2, remaining_qty: 0, limit_price_cents: 4000, avg_fill_price_cents: 4050, status: "FILLED" },
  { id: "order-2", asset_id: "bob", side: "BUY", qty: 3, remaining_qty: 3, limit_price_cents: 7500, avg_fill_price_cents: null, status: "OPEN" },
];

let nextOrderId = 3;

export async function getAssets() {
  await delay();
  return ASSETS;
}

export async function getUserPortfolio() {
  await delay();
  return {
    cash_cents: 1050000,
    reserved_cash_cents: 225000,
    holdings: [
      { asset_id: "alice", shares: 2, reserved_shares: 0, market_value_cents: 8400 },
      { asset_id: "bob", shares: 3, reserved_shares: 3, market_value_cents: 23400 },
    ],
  };
}

export async function getUserAccountBalances() {
  await delay();
  return { cash_cents: 1050000, reserved_cash_cents: 225000 };
}

export async function getUserOrders() {
  await delay();
  return { orders: [...mockOrders] };
}

export async function getLeaderboard() {
  await delay();
  return {
    top_cash: { username: "diana", cash_cents: 2400000 },
    top_net_worth: { username: "dev", net_worth_cents: 3100000 },
    paused: false,
  };
}

export async function getAssetCandles(assetId, { limit = 50 } = {}) {
  await delay(300);
  const asset = ASSETS.find((a) => a.asset_id === assetId);
  return { bars: generateCandles(asset?.last_price_cents ?? 5000, limit) };
}

export async function getAssetOrderBook(assetId) {
  await delay(150);
  const asset = ASSETS.find((a) => a.asset_id === assetId);
  const base = asset?.last_price_cents ?? 5000;
  const bids = [1, 2, 3, 4, 5].map((i) => ({ price_cents: Math.round(base * (1 - i * 0.01)), qty: Math.floor(Math.random() * 8) + 1 }));
  const asks = [1, 2, 3, 4, 5].map((i) => ({ price_cents: Math.round(base * (1 + i * 0.01)), qty: Math.floor(Math.random() * 8) + 1 }));
  return { bids, asks };
}

export async function placeOrder(order) {
  await delay(400);
  const newOrder = {
    id: `order-${nextOrderId++}`,
    asset_id: order.asset_id,
    side: order.side,
    qty: order.qty,
    remaining_qty: order.qty,
    limit_price_cents: order.limit_price_cents,
    avg_fill_price_cents: null,
    status: "OPEN",
  };
  mockOrders.unshift(newOrder);
  return newOrder;
}

export async function cancelOrder(orderId) {
  await delay(300);
  mockOrders = mockOrders.map((o) =>
    o.id === orderId ? { ...o, status: "CANCELED" } : o
  );
  return null;
}

export async function createUser() {
  await delay();
  return { user_id: MOCK_USER_ID, username: "dev" };
}

export async function updateUser(_userId, { username } = {}) {
  await delay();
  return { user_id: MOCK_USER_ID, username: username ?? "dev" };
}

export async function updateAsset(assetId, payload) {
  await delay();
  return { asset_id: assetId, ...payload };
}

export async function deleteCurrentProfile() {
  await delay();
  return null;
}

export async function setMarketPaused(paused) {
  await delay(300);
  return { paused };
}

export async function submitSuggestion() {
  await delay(500);
  return { ok: true };
}
