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
  suggestionsFile: process.env.SUGGESTIONS_FILE
    ? path.resolve(process.cwd(), process.env.SUGGESTIONS_FILE)
    : path.resolve(__dirname, "..", "..", "data", "suggestions.json"),
  corsAllowedOrigins: parseOrigins(process.env.CORS_ALLOWED_ORIGINS),
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || "",
  adminUserId: process.env.ADMIN_USER_ID || "",
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: parsePort(process.env.SMTP_PORT, 587),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  suggestionEmailTo: process.env.SUGGESTION_EMAIL_TO || "alextatarka6@gmail.com",
};
