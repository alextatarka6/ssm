import express from "express";
import { z } from "zod";

const router = express.Router();

router.post("/", (req, res) => {
    const schema = z.object({
        user_id: z.string().min(1),
        initial_cash_cents: z.number().int().nonnegative().default(0),
    });
    
    const parsed = schema.parse(req.body);
    const eng = req.app.locals.engine;

    eng.setUserDefault(parsed.user_id, parsed.initial_cash_cents);

    res.json({ ok: true });
});

export default router;