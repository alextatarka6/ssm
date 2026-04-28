const cache = new Map(); // key -> { status, body, expiresAt }
const TTL_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}, 60_000).unref();

module.exports = function idempotency(req, res, next) {
  const raw = req.headers["idempotency-key"];
  if (!raw || typeof raw !== "string" || !raw.trim()) return next();

  const key = raw.trim();
  if (key.length > 128) {
    return res.status(400).json({ detail: "Idempotency-Key must be 128 characters or fewer." });
  }

  const now = Date.now();
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now) {
    res.set("Idempotent-Replayed", "true");
    return res.status(cached.status).json(cached.body);
  }

  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode >= 200 && res.statusCode < 500) {
      cache.set(key, { status: res.statusCode, body, expiresAt: now + TTL_MS });
    }
    return originalJson(body);
  };

  next();
};
