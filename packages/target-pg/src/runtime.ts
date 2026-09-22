import pg from "pg";

const { Client, Pool } = pg;

export function adminUrl(): string | null {
  const u =
    process.env.TARGET_ADMIN_URL ||
    process.env.TARGET_PG_ADMIN_URL ||
    process.env.DATABASE_URL ||
    null;
  return u && u.length > 0 ? u : null;
}

export function targetHost(): string {
  return process.env.TARGET_DB_HOST || process.env.PGHOST || "127.0.0.1";
}

export function targetPort(): string {
  return String(process.env.TARGET_DB_PORT || process.env.PGPORT || "5432");
}

export function assertSafeCode(dbCode: string): string {
  const c = dbCode.toLowerCase();
  if (!/^[a-z0-9]{3,16}$/.test(c)) {
    throw Object.assign(new Error("Invalid database code for Postgres identifiers"), {
      code: "VALIDATION_FAILED",
    });
  }
  return c;
}

export function escIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

export function escLit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function buildTargetNames(dbCode: string) {
  const c = assertSafeCode(dbCode);
  return { database: `dt_${c}`, user: `u_${c}` };
}

export function rewriteDatabase(connectionString: string, database: string): string {
  try {
    const u = new URL(connectionString);
    u.pathname = "/" + database;
    return u.toString();
  } catch {
    const q = connectionString.indexOf("?");
    const base = q >= 0 ? connectionString.slice(0, q) : connectionString;
    const qs = q >= 0 ? connectionString.slice(q) : "";
    const i = base.lastIndexOf("/");
    return (i >= 0 ? base.slice(0, i + 1) + database : base) + qs;
  }
}

const pools = new Map<string, pg.Pool>();

export function getTargetPool(dbCode: string, _authKey: string): pg.Pool {
  const { database, user } = buildTargetNames(dbCode);
  const key = database;
  let pool = pools.get(key);
  if (!pool) {
    const base = adminUrl();
    const host = targetHost();
    const port = targetPort();
    const connectionString = base
      ? rewriteDatabase(base, database)
      : `postgresql://${user}@${host}:${port}/${database}`;
    pool = new Pool({ connectionString, max: 8, idleTimeoutMillis: 30_000 });
    // Prevent unhandled pool errors from crashing the API process
    pool.on("error", (err) => {
      console.error("[target-pg] pool error", database, err.message);
    });
    pools.set(key, pool);
  }
  return pool;
}

export async function closeTargetPool(dbCode: string): Promise<void> {
  const { database } = buildTargetNames(dbCode);
  const pool = pools.get(database);
  if (pool) {
    pools.delete(database);
    await pool.end().catch(() => {});
  }
}

export function isTargetPgEnabled(): boolean {
  return !!adminUrl();
}

/**
 * Run work as DragTable internal dual-write so row/DDL triggers skip NOTIFY.
 * Prevents duplicate audit entries attributed to @postgres for UI actions.
 */
export async function withDtInternal<T>(
  dbCode: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const pool = getTargetPool(dbCode, "");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.dt_internal', '1', true)`);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
