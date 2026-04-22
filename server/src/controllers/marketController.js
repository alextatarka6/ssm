const marketService = require("../services/marketService");

async function buyStock(req, res) {
  const result = await marketService.mutate((market) =>
    market.buyStock(req.validated.body),
  );

  res.status(201).json(result);
}

async function sellStock(req, res) {
  const result = await marketService.mutate((market) =>
    market.sellStock(req.validated.body),
  );

  res.status(201).json(result);
}

async function processOrders(_req, res) {
  const result = await marketService.mutate((market) => market.processOrders());
  res.json(result);
}

function getOrderBook(req, res) {
  res.json(marketService.getMarket().getOrderBook(req.validated.params.assetId));
}

module.exports = {
  buyStock,
  sellStock,
  processOrders,
  getOrderBook,
};
