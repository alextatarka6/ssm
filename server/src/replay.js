export async function loadAllEvents(pool) {
    const { rows } = await pool.query("SELECT ts_seq, type, data FROM events ORDER BY ts_seq ASC, id ASC")
    return rows;
}