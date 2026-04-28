const marketService = require("../services/marketService");

async function pauseMarket(_req, res) {
  const result = await marketService.mutate((market) => market.pauseMarket());
  res.json(result);
}

async function unpauseMarket(_req, res) {
  const result = await marketService.mutate((market) => market.unpauseMarket());
  res.json(result);
}

async function resetMarket(_req, res) {
  const result = await marketService.mutate((market) => market.resetMarket());
  res.json(result);
}

async function resetUser(req, res) {
  const { userId } = req.params;
  const result = await marketService.mutate((market) => market.resetUser(userId));
  res.json(result);
}

module.exports = { pauseMarket, unpauseMarket, resetMarket, resetUser };
