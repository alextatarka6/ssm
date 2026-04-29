require("dotenv").config();

const cron = require("node-cron");
const app = require("./src/app");
const { port } = require("./src/config");
const marketService = require("./src/services/marketService");
const botService = require("./src/services/botService");
const { sendDailyEmail } = require("./src/services/suggestionsService");

async function startServer() {
  await marketService.initialize();
  await botService.initialize();
  botService.start();

  const server = app.listen(port, () => {
    console.log(`Section Stock Market backend listening on port ${port}`);
  });

  // Send daily suggestions email at 11:59 PM UTC
  cron.schedule("59 23 * * *", () => {
    sendDailyEmail().catch((err) => console.error("[suggestions] Failed to send daily email:", err));
  });

  async function shutdown(signal) {
    console.log(`${signal} received, shutting down gracefully...`);
    server.close(async () => {
      await marketService.persist();
      if (marketService.store.end) {
        await marketService.store.end().catch(() => {});
      }
      process.exit(0);
    });

    // Force exit if graceful shutdown takes too long (EB allows ~30s).
    setTimeout(() => process.exit(1), 25000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch((error) => {
  console.error("Unable to start backend:", error);
  process.exit(1);
});
