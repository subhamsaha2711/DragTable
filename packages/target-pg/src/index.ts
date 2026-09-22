/**
 * Real PostgreSQL target-database provisioning.
 * TARGET_ADMIN_URL — owner URL that can CREATE DATABASE / ROLE
 * TARGET_DB_HOST / TARGET_DB_PORT — embedded in user-facing connection URLs
 */

import pg from "pg";
import {
  adminUrl,
  assertSafeCode,
  buildTargetNames,
  closeTargetPool,
  escIdent,
  escLit,
  rewriteDatabase,
  targetHost,
  targetPort,
} from "./runtime.js";

export {
  adminUrl,
  assertSafeCode,
  buildTargetNames,
  closeTargetPool,
  escIdent,
  escLit,
  getTargetPool,
  isTargetPgEnabled,
  rewriteDatabase,
  targetHost,
  targetPort,
} from "./runtime.js";

import { getTargetPool } from "./runtime.js";

const { Client } = pg;

export function buildConnectionUrl(dbCode: string, authKey: string): string {
  const { database, user } = buildTargetNames(dbCode);
  return `postgresql://${user}:${encodeURIComponent(authKey)}@${targetHost()}:${targetPort()}/${database}`;
}

export type ProvisionResult = {
  database: string;
  user: string;
  host: string;
  port: string;
  connectionUrl: string;
};

async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = adminUrl();
  if (!url) {
    throw Object.assign(new Error("TARGET_ADMIN_URL is not configured"), {
      code: "PG_NOT_CONFIGURED",
    });
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export async function provisionTargetDatabase(
  dbCode: string,
  authKey: string
): Promise<ProvisionResult> {
  const { database, user } = buildTargetNames(dbCode);
  const host = targetHost();
  const port = targetPort();

  await withAdmin(async (admin) => {
    await admin
      .query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [database]
      )
      .catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${escIdent(database)}`).catch(() => {});
    await admin.query(`DROP ROLE IF EXISTS ${escIdent(user)}`).catch(() => {});
    await admin.query(
      `CREATE ROLE ${escIdent(user)} WITH LOGIN PASSWORD ${escLit(authKey)} NOSUPERUSER NOCREATEDB NOCREATEROLE`
    );
    await admin.query(
      `CREATE DATABASE ${escIdent(database)} OWNER ${escIdent(user)} ENCODING 'UTF8'`
    );
    await admin.query(
      `GRANT ALL PRIVILEGES ON DATABASE ${escIdent(database)} TO ${escIdent(user)}`
    );
  });

  const url = adminUrl()!;
  const metaClient = new Client({ connectionString: rewriteDatabase(url, database) });
  await metaClient.connect();
  try {
    await metaClient.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await metaClient.query(`CREATE SCHEMA IF NOT EXISTS _dt AUTHORIZATION ${escIdent(user)}`);
    await metaClient.query(`GRANT ALL ON SCHEMA public TO ${escIdent(user)}`);
    await metaClient.query(`GRANT CREATE ON SCHEMA public TO ${escIdent(user)}`);
    await metaClient.query(`GRANT ALL ON SCHEMA _dt TO ${escIdent(user)}`);
    await metaClient.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${escIdent(user)}`
    );
    await metaClient.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${escIdent(user)}`
    );
    // Objects created later by this admin connection must be usable by u_*
    await metaClient.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public GRANT ALL ON TABLES TO ${escIdent(user)}`
    );
    await metaClient.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public GRANT ALL ON SEQUENCES TO ${escIdent(user)}`
    );
    await installMetaTables(metaClient, user);
    await metaClient.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${escIdent(user)}`);
    await metaClient.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${escIdent(user)}`);
    await metaClient.query(`GRANT SELECT ON ALL TABLES IN SCHEMA _dt TO ${escIdent(user)}`);
  } finally {
    await metaClient.end().catch(() => {});
  }

  return {
    database,
    user,
    host,
    port,
    connectionUrl: buildConnectionUrl(dbCode, authKey),
  };
}

async function installMetaTables(client: pg.Client, owner: string): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _dt.tables (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      schema_version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS _dt.columns (
      id UUID PRIMARY KEY,
      table_id UUID NOT NULL REFERENCES _dt.tables(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      data_type TEXT NOT NULL,
      nullable BOOLEAN NOT NULL DEFAULT true,
      is_unique BOOLEAN NOT NULL DEFAULT false,
      is_primary_key BOOLEAN NOT NULL DEFAULT false,
      position INT NOT NULL DEFAULT 0,
      UNIQUE (table_id, name)
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS _dt.foreign_keys (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      table_id UUID NOT NULL,
      column_id UUID NOT NULL,
      ref_table_id UUID NOT NULL,
      ref_column_id UUID NOT NULL,
      on_delete TEXT NOT NULL DEFAULT 'restrict',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS _dt.indexes (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      table_id UUID NOT NULL,
      column_ids UUID[] NOT NULL,
      is_unique BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS _dt.checks (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      table_id UUID NOT NULL,
      column_id UUID NOT NULL,
      op TEXT NOT NULL,
      value JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  for (const tbl of ["tables", "columns", "foreign_keys", "indexes", "checks"]) {
    await client.query(`ALTER TABLE _dt.${tbl} OWNER TO ${escIdent(owner)}`);
  }
}

export async function rotateTargetPassword(dbCode: string, newAuthKey: string): Promise<void> {
  const { user } = buildTargetNames(dbCode);
  await withAdmin(async (admin) => {
    await admin.query(`ALTER ROLE ${escIdent(user)} WITH PASSWORD ${escLit(newAuthKey)}`);
  });
}

export async function dropTargetDatabase(dbCode: string): Promise<void> {
  const { database, user } = buildTargetNames(dbCode);
  await withAdmin(async (admin) => {
    await admin
      .query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [database]
      )
      .catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${escIdent(database)}`);
    await admin.query(`DROP ROLE IF EXISTS ${escIdent(user)}`);
  });
}

export * from "./ops.js";
