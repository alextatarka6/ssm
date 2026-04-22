const marketService = require("../services/marketService");

async function placeOrder(req, res) {
  const result = await marketService.mutate((market) =>
    market.placeOrder(req.validated.body),
  );

  res.status(201).json(result);
}

async function cancelOrder(req, res) {
  const result = await marketService.mutate((market) =>
    market.cancelOrder(req.validated.params.orderId),
  );

  res.json(result);
}

module.exports = {
  placeOrder,
  cancelOrder,
};
