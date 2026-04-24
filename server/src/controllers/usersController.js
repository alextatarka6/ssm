const marketService = require("../services/marketService");
const { getSupabaseAdmin } = require("../utils/supabaseAdmin");

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

async function deleteCurrentUser(req, res) {
  const userId = req.supabaseUser.id;

  await marketService.mutate((market) => market.deleteUser(userId));

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) {
      throw error;
    }
  }

  res.status(204).end();
}

module.exports = {
  createUser,
  listUsers,
  getUser,
  getBalance,
  getPortfolio,
  deleteCurrentUser,
};
