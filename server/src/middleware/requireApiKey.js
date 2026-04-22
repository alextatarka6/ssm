const { apiKey } = require("../config");

module.exports = function requireApiKey(req, res, next) {
  if (!apiKey) {
    // API_KEY not configured — warn once and allow through (dev mode).
    return next();
  }

  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (token !== apiKey) {
    return res.status(401).json({ detail: "Unauthorized." });
  }

  next();
};
