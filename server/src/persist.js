export async function persistEngineResults(client, { events, order, trades }) {
    // events
    for (const ev of events ?? []) {
        await client.query(
            "INSERT INTO events (ts_seq, type, data) VALUES ($1, $2, $3)",
            [ev.tsSeq, ev.type, ev.data],
        );
    }

    // order upsert
    if (order) {
        await client.query(
            `INSERT INTO orders (id, user_id, asset_id, side, qty, remaining_qty, limit_price_cents, status, seq)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO UPDATE SET
                remaining_qty = EXCLUDED.remaining_qty,
                status = EXCLUDED.status`,
            [
                order.id,
                order.userId,
                order.assetId,
                order.side,
                order.qty,
                order.remainingQty,
                order.limitPriceCents,
                order.status,
                order.seq,
            ]
        );
    }

    // trades
    for (const t of trades ?? []) {
        await client.query(
            `INSERT INTO trades (id, ts_seq, asset_id, price_cents, qty, buy_order_id, sell_order_id, buyer_id, seller_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO NOTHING`,
            [
                t.id,
                t.tsSeq ?? 0,
                t.assetId,
                t.priceCents,
                t.qty,
                t.buyOrderId,
                t.sellOrderId,
                t.buyerId,
                t.sellerId,
            ]
        );
    }
}