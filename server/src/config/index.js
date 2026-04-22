const path = require("path");

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseOrigins(value) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

module.exports = {
  port: parsePort(process.env.PORT, 8080),
  apiKey: process.env.API_KEY || "",
  databaseUrl: process.env.DATABASE_URL || "",
  dataFile: process.env.DATA_FILE
    ? path.resolve(process.cwd(), process.env.DATA_FILE)
    : path.resolve(__dirname, "..", "..", "data", "market-state.json"),
  corsAllowedOrigins: parseOrigins(process.env.CORS_ALLOWED_ORIGINS),
};
