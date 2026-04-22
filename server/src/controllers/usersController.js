const marketService = require("../services/marketService");

async function createUser(req, res) {
  const user = await marketService.mutate((market) =>
    market.createUser(req.validated.body),
  );

  res.status(201).json({
    ok: true,
    user,
  });
}

function listUsers(_req, res) {
  res.json(marketService.getMarket().listUsers());
}

function getUser(req, res) {
  res.json(marketService.getMarket().getUser(req.validated.params.userId));
}

function getBalance(req, res) {
  res.json(marketService.getMarket().getBalance(req.validated.params.userId));
}

function getPortfolio(req, res) {
  res.json(marketService.getMarket().getPortfolio(req.validated.params.userId));
}

function deleteCurrentUser(_req, res) {
  res.status(501).json({
    detail:
      "Profile deletion is not implemented in this Node backend because it requires an external identity-backed data store.",
  });
}

module.exports = {
  createUser,
  listUsers,
  getUser,
  getBalance,
  getPortfolio,
  deleteCurrentUser,
};
