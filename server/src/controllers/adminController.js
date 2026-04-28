const marketService = require("../services/marketService");

async function pauseMarket(_req, res) {
  const result = await marketService.mutate((market) => market.pauseMarket());
  res.json(result);
}

async function unpauseMarket(_req, res) {
  const result = await marketService.mutate((market) => market.unpauseMarket());
  res.json(result);
}

module.exports = { pauseMarket, unpauseMarket };
