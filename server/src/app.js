const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const { corsAllowedOrigins } = require("./config");
const routes = require("./routes");
const requireApiKey = require("./middleware/requireApiKey");
const requireSupabaseAuth = require("./middleware/requireSupabaseAuth");
const { deleteCurrentUser } = require("./controllers/usersController");
const asyncHandler = require("./utils/asyncHandler");
const notFoundHandler = require("./middleware/notFoundHandler");
const errorHandler = require("./middleware/errorHandler");
const marketService = require("./services/marketService");

const app = express();

app.disable("x-powered-by");
app.use(morgan("combined"));
app.use(express.json({ limit: "1mb" }));

app.use(
  cors({
    origin(origin, callback) {
      // Fail-closed: if CORS_ALLOWED_ORIGINS is not configured, reject all
      // cross-origin requests rather than silently allowing everything.
      if (!corsAllowedOrigins.length) {
        if (!origin) {
          // Same-origin or server-to-server request — allow.
          return callback(null, true);
        }
        return callback(new Error("Origin not allowed by CORS"));
      }

      if (!origin || corsAllowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      callback(new Error("Origin not allowed by CORS"));
    },
  }),
);

app.get("/health", async (_req, res) => {
  try {
    await marketService.ping();
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, detail: "Storage unavailable." });
  }
});

// Registered before requireApiKey — accepts a Supabase JWT rather than the API key.
app.delete("/api/users/me", requireSupabaseAuth, asyncHandler(deleteCurrentUser));

app.use("/api", requireApiKey, routes);

// Serve the pre-built React frontend. Place after /api so API routes take
// precedence, and use a catch-all so React Router handles client-side nav.
const frontendDist = path.join(__dirname, "..", "frontend", "dist");
app.use(express.static(frontendDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
