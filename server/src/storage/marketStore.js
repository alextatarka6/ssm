const fs = require("fs");
const path = require("path");

const { dataFile, databaseUrl } = require("../config");

class FileMarketStore {
  async initialize() {}

  async ping() {
    return true;
  }

  async loadSnapshot() {
    if (!fs.existsSync(dataFile)) {
      return undefined;
    }

    const raw = fs.readFileSync(dataFile, "utf8");
    if (!raw.trim()) {
      return undefined;
    }

    return JSON.parse(raw);
  }

  async saveSnapshot(snapshot) {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    const tempFile = `${dataFile}.tmp`;
    fs.writeFileSync(tempFile, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    fs.renameSync(tempFile, dataFile);
  }
}

class PostgresMarketStore {
  constructor(connectionString) {
    // `pg` is only needed when a real external database is configured.
    // That keeps local file-backed development lightweight while still letting
    // Elastic Beanstalk use Postgres for durable state.
    const { Pool } = require("pg");
    const shouldUseSsl = process.env.PGSSLMODE
      ? process.env.PGSSLMODE !== "disable"
      : /sslmode=require/i.test(connectionString);

    let ssl = false;
    if (shouldUseSsl) {
      // If a CA bundle path is provided (e.g. the RDS global-bundle.pem),
      // load it so the connection can be fully verified. Without it, fall back
      // to encrypt-only (rejectUnauthorized: false) which is acceptable for
      // traffic that stays inside a VPC.
      const caFile = process.env.PGSSLROOTCERT;
      ssl = caFile
        ? { rejectUnauthorized: true, ca: fs.readFileSync(caFile, "utf8") }
        : { rejectUnauthorized: false };
    }

    this.pool = new Pool({ connectionString, ssl });
  }

  async initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS market_snapshots (
        id INTEGER PRIMARY KEY,
        snapshot JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async ping() {
    await this.pool.query("SELECT 1");
    return true;
  }

  async loadSnapshot() {
    const result = await this.pool.query(
      "SELECT snapshot FROM market_snapshots WHERE id = $1 LIMIT 1",
      [1],
    );

    return result.rows[0] ? result.rows[0].snapshot : undefined;
  }

  async saveSnapshot(snapshot) {
    await this.pool.query(
      `
        INSERT INTO market_snapshots (id, snapshot, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (id) DO UPDATE
        SET snapshot = EXCLUDED.snapshot,
            updated_at = NOW()
      `,
      [1, JSON.stringify(snapshot)],
    );
  }

  async end() {
    await this.pool.end();
  }
}

function createMarketStore() {
  if (databaseUrl) {
    return new PostgresMarketStore(databaseUrl);
  }

  return new FileMarketStore();
}

module.exports = createMarketStore;
