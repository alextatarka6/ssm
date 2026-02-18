import express from "express";
import dotenv from "dotenv";
import { pool } from "./db.js";
import { makeEngine } from "./engine/engine.js";
import { loadAllEvents } from "./replay.js";

import usersRouter from "./routes/users.js";
import assetsRouter from "./routes/assets.js";
import ordersRouter from "./routes/orders.js";

dotenv.config();

const app = express();
app.use(express.json());

const engine = makeEngine();

async function boot() {
    const events = await loadAllEvents(pool);
    engine.rebuildFromEvents(events);

    app.locals.engine = engine;
    app.locals.pool = pool;

    app.use("/users", usersRouter);
    app.use("/assets", assetsRouter);
    app.use("/orders", ordersRouter);

    const port = Number(process.env.PORT || 3000);
    app.listen(port, () => console.log(`listening on port ${port}`));
}

boot().catch((err) => {
    console.error(err);
    process.exit(1);
});