const requireSupabaseAuth = require("./requireSupabaseAuth");
const { adminUserId } = require("../config");

module.exports = async function requireAdmin(req, res, next) {
  if (!adminUserId) {
    return res.status(503).json({ detail: "Admin access is not configured." });
  }

  await requireSupabaseAuth(req, res, async () => {
    if (req.supabaseUser.id !== adminUserId) {
      return res.status(403).json({ detail: "Forbidden." });
    }
    next();
  });
};
