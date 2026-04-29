const marketService = require("../services/marketService");

function getLeaderboard(_req, res) {
  res.json(marketService.getMarket().getLeaderboard());
}

module.exports = { getLeaderboard };
