const marketService = require("../services/marketService");
const { getSupabaseAdmin } = require("../utils/supabaseAdmin");
const { ApiError } = require("../utils/errors");

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

function getUserOrders(req, res) {
  res.json(marketService.getMarket().getUserOrders(req.validated.params.userId));
}

async function updateUser(req, res) {
  const user = await marketService.mutate((market) =>
    market.updateUser(req.validated.params.userId, req.validated.body),
  );
  res.json({ ok: true, user });
}

async function deleteCurrentUser(req, res) {
  const userId = req.supabaseUser.id;

  await marketService.mutate((market) => market.deleteUser(userId));

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) {
      throw new ApiError(502, `Auth service error: ${error.message}`);
    }
  }

  res.status(204).end();
}

module.exports = {
  createUser,
  listUsers,
  getUser,
  updateUser,
  getBalance,
  getPortfolio,
  getUserOrders,
  deleteCurrentUser,
};
