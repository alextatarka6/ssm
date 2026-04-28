const rateLimit = require("express-rate-limit");

const message = (detail) => ({ detail });

// General limit for all API routes
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: message("Too many requests. Please try again later."),
});

// Tighter limit specifically for order placement
const orderLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: message("Too many order requests. Please slow down."),
});

module.exports = { apiLimiter, orderLimiter };
