import express from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { persistEngineResults } from "../persist.js";

const router = express.Router();

router.post("/", async (req, res, next) => {
    try {
        const schema = z.object({
            issuer_user_id: z.string().min(1),
            asset_id: z.string().min(1),
            total_supply: z.number().int().positive().default(1000),
            issuer_pct: z.number().min(0.01).max(0.99).default(0.6),
            name: z.string().optional(),
        });
        const parsed = schema.parse(req.body);

        const eng = req.app.locals.engine;

        const result = eng.createPersonAsset({
            issuerUserId: parsed.issuer_user_id,
            assetId: parsed.asset_id,
            totalSupply: parsed.total_supply,
            issuerPct: parsed.issuer_pct,
            name: parsed.name,
        });

        const client = await pool.connect();
        try {
            await client.query("begin");
            await persistEngineResults(client, { events : result.events });
            await client.query("commit");
        } catch(e) {
            await client.query("rollback");
            throw e;
        } finally {
            client.release();
        }

        eng.setUserDefault(parsed.user_id, parsed.initial_cash_cents);

        res.json({ ok: true });
    } catch(e) {
        next(e);
    }
});

export default router;