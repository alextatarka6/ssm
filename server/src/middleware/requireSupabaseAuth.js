const { getSupabaseAdmin } = require("../utils/supabaseAdmin");

module.exports = async function requireSupabaseAuth(req, res, next) {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return res.status(503).json({ detail: "Authentication service is not configured." });
  }

  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ detail: "Missing authorization token." });
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({ detail: "Invalid or expired token." });
  }

  req.supabaseUser = data.user;
  next();
};
