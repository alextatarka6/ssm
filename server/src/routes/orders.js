import express from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { persistEngineResults } from "../persist.js";
import { Side } from "../engine/types.js";

const router = express.Router();

router.post("/", async (req, res, next) => {
    try {
        const schema = z.object({
            user_id: z.string().min(1),
            asset_id: z.string().min(1),
            side: z.enum([Side.BUY, Side.SELL]),
            qty: z.number().int().positive(),
            limit_price_cents: z.number().int().positive(),
        });
        const parsed = schema.parse(req.body);

        const eng = req.app.locals.engine;
        const result = eng.processOrder({
            userId: parsed.user_id,
            assetId: parsed.asset_id,
            side: parsed.side,
            qty: parsed.qty,
            limitPriceCents: parsed.limit_price_cents,
        });

        const client = await pool.connect();
        try {
            await client.query("begin");
            await persistEngineResults(client, result);
            await client.query("commit");
        } catch(e) {
            await client.query("rollback");
            throw e;
        } finally {
            client.release();
        }

        res.json({ 
            order: result.order,
            trades: result.trades,
        });
    } catch(e) {
        next(e);
    }
});

router.post("/:id/cancel", async (req, res, next) => {
    try {
        const schema = z.object({ id: z.string().regex(/^\d+$/) });
        const id = schema.parse(req.params);
        const orderId = Number(id);

        const eng = req.app.locals.engine;
        const result = eng.cancelOrder(orderId);

        const client = await pool.connect();
        try {
            await client.query("begin");
            await persistEngineResults(client, { events : result.events, order: result.order, trades: [] });
            await client.query("commit");
        } catch(e) {
            await client.query("rollback");
            throw e;
        } finally {
            client.release();
        }

        res.json({ order: result.order });
    } catch(e) {
        next(e);
    }
});

export default router;