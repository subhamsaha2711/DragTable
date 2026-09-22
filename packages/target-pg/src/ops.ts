/**
 * Structured schema/data ops against a provisioned target Postgres database.
 * Uses admin-rewritten connection to the target DB (via getTargetPool).
 */

import type pg from "pg";
import { getTargetPool, escIdent, assertSafeCode, withDtInternal } from "./runtime.js";

export type PgCol = {
  id: string;
  name: string;
  dataType: string;
  nullable: boolean;
  unique: boolean;
  isPrimaryKey: boolean;
  position: number;
};

export type DiscoveredColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  unique: boolean;
  isPrimaryKey: boolean;
  position: number;
};

function sqlType(dt: string): string {
  switch (dt) {
    case "integer":
      return "INTEGER";
    case "numeric":
      return "NUMERIC";
    case "boolean":
      return "BOOLEAN";
    case "date":
      return "DATE";
    case "timestamp":
      return "TIMESTAMPTZ";
    case "uuid":
      return "UUID";
    case "jsonb":
      return "JSONB";
    default:
      return "TEXT";
  }
}

function safeName(name: string): string {
  const n = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!n || !/^[a-z]/.test(n)) return `c_${n || "col"}`;
  return n.slice(0, 63);
}

function mapPgType(udt: string): string {
  const t = (udt || "").toLowerCase();
  if (t === "int4" || t === "int2" || t === "int8") return "integer";
  if (t === "numeric" || t === "float4" || t === "float8") return "numeric";
  if (t === "bool") return "boolean";
  if (t === "date") return "date";
  if (t === "timestamp" || t === "timestamptz") return "timestamp";
  if (t === "uuid") return "uuid";
  if (t === "jsonb" || t === "json") return "jsonb";
  return "text";
}

export async function pgCreateTable(
  dbCode: string,
  table: {
    id: string;
    name: string;
    columns: PgCol[];
  }
): Promise<void> {
  assertSafeCode(dbCode);
  const pool = getTargetPool(dbCode, "");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.dt_internal', '1', true)`);
    await client.query(
      `INSERT INTO _dt.tables (id, name, schema_version) VALUES ($1, $2, 1)
       ON CONFLICT (id) DO NOTHING`,
      [table.id, table.name]
    );
    for (const c of table.columns) {
      await client.query(
        `INSERT INTO _dt.columns (id, table_id, name, data_type, nullable, is_unique, is_primary_key, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [
          c.id,
          table.id,
          c.name,
          c.dataType,
          c.nullable,
          c.unique,
          c.isPrimaryKey,
          c.position,
        ]
      );
    }

    const colDefs: string[] = [
      `_dt_row_id UUID PRIMARY KEY DEFAULT gen_random_uuid()`,
      `_dt_version INT NOT NULL DEFAULT 1`,
      `_dt_created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
      `_dt_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
    ];
    const pks: string[] = [];
    const systemUuidPks: string[] = [];
    for (const c of table.columns) {
      const cn = safeName(c.name);
      let def = `${escIdent(cn)} ${sqlType(c.dataType)}`;
      const isSysId =
        cn === "id" ||
        (c.isPrimaryKey && String(c.dataType).toLowerCase() === "uuid");
      if (isSysId) {
        def = `${escIdent(cn)} UUID NOT NULL DEFAULT gen_random_uuid()`;
        systemUuidPks.push(cn);
      } else {
        if (!c.nullable) def += " NOT NULL";
      }
      if (c.unique && !c.isPrimaryKey) def += " UNIQUE";
      colDefs.push(def);
      if (c.isPrimaryKey) pks.push(escIdent(cn));
    }
    if (pks.length) {
      colDefs.push(`UNIQUE (${pks.join(", ")})`);
    }
    const tname = safeName(table.name);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${escIdent(tname)} (${colDefs.join(", ")})`
    );
    await client.query("COMMIT");
    for (const cn of systemUuidPks) {
      try {
        await installSystemIdGuard(dbCode, tname, cn);
      } catch (e) {
        console.error("[target-pg] system id guard", tname, cn, e);
      }
    }
    try {
      await pgAttachChangeNotify(dbCode, table.name);
    } catch (e) {
      console.error("[target-pg] notify trigger", e);
    }
    try {
      await syncOwnerTableGrants(dbCode);
    } catch (e) {
      console.error("[target-pg] syncOwnerTableGrants", e);
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function pgDropTable(dbCode: string, tableName: string, tableId: string): Promise<void> {
  const tname = safeName(tableName);
  await withDtInternal(dbCode, async (client) => {
    await client.query(`DROP TABLE IF EXISTS ${escIdent(tname)} CASCADE`);
    await client.query(`DELETE FROM _dt.tables WHERE id = $1`, [tableId]);
  });
}

export async function pgRenameTable(
  dbCode: string,
  tableId: string,
  oldName: string,
  newName: string
): Promise<void> {
  await withDtInternal(dbCode, async (client) => {
    await client.query(
      `ALTER TABLE ${escIdent(safeName(oldName))} RENAME TO ${escIdent(safeName(newName))}`
    );
    await client.query(
      `UPDATE _dt.tables SET name = $1, schema_version = schema_version + 1, updated_at = now() WHERE id = $2`,
      [newName, tableId]
    );
  });
}

export async function pgAddColumn(
  dbCode: string,
  tableName: string,
  col: PgCol
): Promise<void> {
  const tname = safeName(tableName);
  const cn = safeName(col.name);
  let def = `${escIdent(cn)} ${sqlType(col.dataType)}`;
  if (!col.nullable) def += " NOT NULL";
  await withDtInternal(dbCode, async (client) => {
    await client.query(`ALTER TABLE ${escIdent(tname)} ADD COLUMN IF NOT EXISTS ${def}`);
    await client.query(
      `INSERT INTO _dt.columns (id, table_id, name, data_type, nullable, is_unique, is_primary_key, position)
       VALUES ($1,(SELECT id FROM _dt.tables WHERE name = $2),$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [
        col.id,
        tableName,
        col.name,
        col.dataType,
        col.nullable,
        col.unique,
        col.isPrimaryKey,
        col.position,
      ]
    );
  });
}

export async function pgDropColumn(
  dbCode: string,
  tableName: string,
  columnName: string,
  columnId: string
): Promise<void> {
  await withDtInternal(dbCode, async (client) => {
    await client.query(
      `ALTER TABLE ${escIdent(safeName(tableName))} DROP COLUMN IF EXISTS ${escIdent(safeName(columnName))} CASCADE`
    );
    await client.query(`DELETE FROM _dt.columns WHERE id = $1`, [columnId]);
  });
}

export async function pgInsertRow(
  dbCode: string,
  tableName: string,
  columns: PgCol[],
  valuesByColId: Record<string, unknown>,
  rowId: string
): Promise<{ rowId: string; valuesByColId: Record<string, unknown> }> {
  const tname = safeName(tableName);
  const names: string[] = ["_dt_row_id"];
  const params: unknown[] = [rowId];
  for (const c of columns) {
    const cn = safeName(c.name);
    if (cn === "id") continue;
    names.push(cn);
    params.push(valuesByColId[c.id] ?? null);
  }
  const placeholders = params.map((_, i) => `$${i + 1}`).join(", ");
  const returningCols = ["_dt_row_id", ...columns.map((c) => safeName(c.name))];
  return withDtInternal(dbCode, async (client) => {
    const res = await client.query(
      `INSERT INTO ${escIdent(tname)} (${names.map(escIdent).join(", ")})
       VALUES (${placeholders})
       RETURNING ${returningCols.map(escIdent).join(", ")}`,
      params
    );
    const row = res.rows[0] ?? {};
    const outValues: Record<string, unknown> = { ...valuesByColId };
    for (const c of columns) {
      const cn = safeName(c.name);
      if (row[cn] !== undefined) {
        outValues[c.id] = row[cn];
      }
    }
    const systemId = row.id != null ? String(row.id) : null;
    const actualRowId = systemId || (row._dt_row_id as string) || rowId;
    return { rowId: actualRowId, valuesByColId: outValues };
  });
}

export async function pgUpdateCell(
  dbCode: string,
  tableName: string,
  columnName: string,
  rowId: string,
  value: unknown,
  expectedVersion: number
): Promise<{ version: number } | null> {
  const tname = safeName(tableName);
  const cn = safeName(columnName);
  if (cn === "id") return null;
  return withDtInternal(dbCode, async (client) => {
    let res = await client.query(
      `UPDATE ${escIdent(tname)}
       SET ${escIdent(cn)} = $1, _dt_version = _dt_version + 1, _dt_updated_at = now()
       WHERE _dt_row_id = $2::uuid AND _dt_version = $3
       RETURNING _dt_version`,
      [value, rowId, expectedVersion]
    ).catch(() => null);
    if (!res || !res.rowCount) {
      res = await client.query(
        `UPDATE ${escIdent(tname)}
         SET ${escIdent(cn)} = $1,
             _dt_version = COALESCE(_dt_version, 1) + 1,
             _dt_updated_at = now()
         WHERE ${escIdent("id")} = $2::uuid
           AND (COALESCE(_dt_version, 1) = $3 OR _dt_version IS NULL)
         RETURNING COALESCE(_dt_version, 1) AS _dt_version`,
        [value, rowId, expectedVersion]
      ).catch(() => null);
    }
    if (!res || !res.rowCount) {
      res = await client.query(
        `UPDATE ${escIdent(tname)}
         SET ${escIdent(cn)} = $1,
             _dt_version = COALESCE(_dt_version, 1) + 1,
             _dt_updated_at = now()
         WHERE ${escIdent("id")} = $2::uuid OR _dt_row_id = $2::uuid
         RETURNING COALESCE(_dt_version, 1) AS _dt_version`,
        [value, rowId]
      ).catch(() => null);
    }
    if (!res || !res.rowCount) return null;
    return { version: Number(res.rows[0]._dt_version) };
  });
}

export async function pgDeleteRow(
  dbCode: string,
  tableName: string,
  rowId: string,
  expectedVersion: number
): Promise<boolean> {
  return withDtInternal(dbCode, async (client) => {
    const tname = safeName(tableName);
    let res = await client.query(
      `DELETE FROM ${escIdent(tname)} WHERE _dt_row_id = $1::uuid AND _dt_version = $2`,
      [rowId, expectedVersion]
    ).catch(() => null);
    if (res && (res.rowCount ?? 0) > 0) return true;
    res = await client.query(
      `DELETE FROM ${escIdent(tname)}
       WHERE ${escIdent("id")} = $1::uuid
         AND (COALESCE(_dt_version, 1) = $2 OR _dt_version IS NULL)`,
      [rowId, expectedVersion]
    ).catch(() => null);
    if (res && (res.rowCount ?? 0) > 0) return true;
    res = await client.query(
      `DELETE FROM ${escIdent(tname)}
       WHERE ${escIdent("id")} = $1::uuid OR _dt_row_id = $1::uuid`,
      [rowId]
    ).catch(() => null);
    return !!res && (res.rowCount ?? 0) > 0;
  });
}

export async function pgListRows(
  dbCode: string,
  tableName: string,
  columns: PgCol[],
  limit = 100,
  offset = 0
): Promise<{
  rows: Array<{
    id: string;
    version: number;
    values: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
}> {
  const pool = getTargetPool(dbCode, "");
  const tname = tableName.trim();
  const countRes = await pool.query(`SELECT count(*)::int AS n FROM ${escIdent(tname)}`);
  const total = countRes.rows[0]?.n ?? 0;
  let res;
  try {
    res = await pool.query(
      `SELECT * FROM ${escIdent(tname)} ORDER BY _dt_created_at ASC NULLS LAST LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
  } catch {
    res = await pool.query(
      `SELECT * FROM ${escIdent(tname)} LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
  }
  const colByName = new Map(columns.map((c) => [safeName(c.name), c]));
  for (const c of columns) {
    colByName.set(c.name.toLowerCase(), c);
  }
  const rows = res.rows.map((r) => {
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (k.startsWith("_dt_")) continue;
      const col = colByName.get(k.toLowerCase()) ?? colByName.get(k);
      if (col) values[col.id] = v;
    }
    let rid: string | null = null;
    if (r.id != null && String(r.id).length > 0) rid = String(r.id);
    else if (r._dt_row_id != null) rid = String(r._dt_row_id);
    else {
      for (const c of columns) {
        if (c.name.toLowerCase() === "id" && values[c.id] != null) {
          rid = String(values[c.id]);
          break;
        }
      }
    }
    if (!rid) rid = crypto.randomUUID();
    return {
      id: rid,
      version: Number(r._dt_version ?? 1),
      values,
      createdAt: r._dt_created_at
        ? new Date(r._dt_created_at).toISOString()
        : new Date().toISOString(),
      updatedAt: r._dt_updated_at
        ? new Date(r._dt_updated_at).toISOString()
        : new Date().toISOString(),
    };
  });
  return { rows, total };
}

export async function installSystemIdGuard(
  dbCode: string,
  tableName: string,
  idCol = "id"
): Promise<void> {
  const pool = getTargetPool(dbCode, "");
  const tname = safeName(tableName);
  const cn = safeName(idCol);
  const fnIns = `_dt_force_id_ins_${tname}`.replace(/[^a-z0-9_]/g, "_").slice(0, 63);
  const fnUpd = `_dt_force_id_upd_${tname}`.replace(/[^a-z0-9_]/g, "_").slice(0, 63);
  await pool.query(`
    CREATE OR REPLACE FUNCTION ${escIdent(fnIns)}() RETURNS trigger AS $$
    BEGIN
      NEW.${escIdent(cn)} := gen_random_uuid();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    CREATE OR REPLACE FUNCTION ${escIdent(fnUpd)}() RETURNS trigger AS $$
    BEGIN
      NEW.${escIdent(cn)} := OLD.${escIdent(cn)};
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`DROP TRIGGER IF EXISTS ${escIdent(fnIns + "_trg")} ON ${escIdent(tname)}`);
  await pool.query(`
    CREATE TRIGGER ${escIdent(fnIns + "_trg")}
    BEFORE INSERT ON ${escIdent(tname)}
    FOR EACH ROW EXECUTE FUNCTION ${escIdent(fnIns)}()
  `);
  await pool.query(`DROP TRIGGER IF EXISTS ${escIdent(fnUpd + "_trg")} ON ${escIdent(tname)}`);
  await pool.query(`
    CREATE TRIGGER ${escIdent(fnUpd + "_trg")}
    BEFORE UPDATE ON ${escIdent(tname)}
    FOR EACH ROW EXECUTE FUNCTION ${escIdent(fnUpd)}()
  `);
}

export async function pgEnsureDtColumns(dbCode: string, tableName: string): Promise<void> {
  const pool = getTargetPool(dbCode, "");
  const tname = safeName(tableName);
  await pool.query(`SELECT set_config('app.dt_internal', '1', false)`);
  await pool.query(
    `ALTER TABLE ${escIdent(tname)} ADD COLUMN IF NOT EXISTS _dt_row_id UUID DEFAULT gen_random_uuid()`
  ).catch(() => {});
  await pool.query(
    `ALTER TABLE ${escIdent(tname)} ADD COLUMN IF NOT EXISTS _dt_version INT DEFAULT 1`
  ).catch(() => {});
  await pool.query(
    `ALTER TABLE ${escIdent(tname)} ADD COLUMN IF NOT EXISTS _dt_created_at TIMESTAMPTZ DEFAULT now()`
  ).catch(() => {});
  await pool.query(
    `ALTER TABLE ${escIdent(tname)} ADD COLUMN IF NOT EXISTS _dt_updated_at TIMESTAMPTZ DEFAULT now()`
  ).catch(() => {});
  await pool.query(`SELECT set_config('app.dt_internal', '0', false)`);
}

export async function enforceSystemUuidId(dbCode: string, tableName: string): Promise<void> {
  const pool = getTargetPool(dbCode, "");
  const tname = safeName(tableName);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.dt_internal', '1', true)`);
    const cols = await client.query(
      `SELECT column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [tname]
    );
    const names = cols.rows.map((r) => String(r.column_name).toLowerCase());
    const hasId = names.includes("id");
    const idRow = cols.rows.find((r) => String(r.column_name).toLowerCase() === "id");
    const idIsUuid =
      idRow &&
      (String(idRow.udt_name).toLowerCase() === "uuid" ||
        String(idRow.data_type).toLowerCase().includes("uuid"));

    if (hasId && idIsUuid) {
      await client.query("COMMIT");
      await installSystemIdGuard(dbCode, tname, "id").catch(() => {});
      await pgEnsureDtColumns(dbCode, tname).catch(() => {});
      return;
    }

    const rebuild = `_dt_rebuild_${tname}`.slice(0, 63);
    const dataCols = cols.rows.filter((r) => {
      const n = String(r.column_name).toLowerCase();
      return n !== "id" && !n.startsWith("_dt_");
    });
    const defs = [
      `id UUID NOT NULL DEFAULT gen_random_uuid()`,
      `_dt_row_id UUID PRIMARY KEY DEFAULT gen_random_uuid()`,
      `_dt_version INT NOT NULL DEFAULT 1`,
      `_dt_created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
      `_dt_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
    ];
    for (const c of dataCols) {
      const cn = String(c.column_name);
      const dt = mapPgType(String(c.udt_name));
      let d = `${escIdent(cn)} ${sqlType(dt)}`;
      if (String(c.is_nullable).toUpperCase() === "NO") d += " NOT NULL";
      defs.push(d);
    }
    await client.query(`CREATE TABLE ${escIdent(rebuild)} (${defs.join(", ")})`);
    if (dataCols.length) {
      const colList = dataCols.map((c) => escIdent(String(c.column_name))).join(", ");
      await client.query(
        `INSERT INTO ${escIdent(rebuild)} (id, ${colList})
         SELECT gen_random_uuid(), ${colList} FROM ${escIdent(tname)}`
      ).catch(async () => {
        await client.query(
          `INSERT INTO ${escIdent(rebuild)} (${colList})
           SELECT ${colList} FROM ${escIdent(tname)}`
        );
      });
    }
    await client.query(`DROP TABLE ${escIdent(tname)} CASCADE`);
    await client.query(`ALTER TABLE ${escIdent(rebuild)} RENAME TO ${escIdent(tname)}`);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  await installSystemIdGuard(dbCode, tname, "id").catch(() => {});
  await pgEnsureDtColumns(dbCode, tname).catch(() => {});
}

export async function pgAttachChangeNotify(dbCode: string, tableName: string): Promise<void> {
  const pool = getTargetPool(dbCode, "");
  const tname = safeName(tableName);
  const fn = `_dt_row_notify_${tname}`.replace(/[^a-z0-9_]/g, "_").slice(0, 63);
  await pool.query(`
    CREATE OR REPLACE FUNCTION ${escIdent(fn)}() RETURNS trigger AS $$
    BEGIN
      IF current_setting('app.dt_internal', true) = '1' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
      END IF;
      PERFORM pg_notify(
        'dt_change',
        json_build_object(
          'table', TG_TABLE_NAME,
          'op', TG_OP,
          'at', NOW(),
          'actor', session_user
        )::text
      );
      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`DROP TRIGGER IF EXISTS ${escIdent(fn + "_trg")} ON ${escIdent(tname)}`);
  await pool.query(`
    CREATE TRIGGER ${escIdent(fn + "_trg")}
    AFTER INSERT OR UPDATE OR DELETE ON ${escIdent(tname)}
    FOR EACH ROW EXECUTE FUNCTION ${escIdent(fn)}()
  `);
}

export async function syncOwnerTableGrants(dbCode: string): Promise<void> {
  const pool = getTargetPool(dbCode, "");
  const { user } = await import("./runtime.js").then((m) => m.buildTargetNames(dbCode));
  await pool.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${escIdent(user)}`).catch(() => {});
  await pool.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${escIdent(user)}`).catch(() => {});
}

export async function applyMemberPgGrants(input: {
  dbCode: string;
  userId: string;
  permissions: string[];
  fullAccess: boolean;
}): Promise<void> {
  const pool = getTargetPool(input.dbCode, "");
  const role = memberRoleName(input.dbCode, input.userId);
  const exists = await pool.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role]);
  if (!exists.rowCount) return;

  await pool.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${escIdent(role)}`).catch(() => {});
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${escIdent(role)}`).catch(() => {});

  if (input.fullAccess) {
    await pool.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${escIdent(role)}`).catch(() => {});
    await pool.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${escIdent(role)}`).catch(() => {});
    await pool.query(`GRANT CREATE ON SCHEMA public TO ${escIdent(role)}`).catch(() => {});
    return;
  }

  const perms = new Set(input.permissions);
  const select = perms.has("data.read");
  const insert = perms.has("data.insert");
  const update = perms.has("data.update");
  const del = perms.has("data.delete");
  const create = perms.has("table.create");

  if (select || insert || update || del) {
    const parts: string[] = [];
    if (select) parts.push("SELECT");
    if (insert) parts.push("INSERT");
    if (update) parts.push("UPDATE");
    if (del) parts.push("DELETE");
    if (parts.length) {
      await pool
        .query(`GRANT ${parts.join(", ")} ON ALL TABLES IN SCHEMA public TO ${escIdent(role)}`)
        .catch(() => {});
    }
  }
  if (create) {
    await pool.query(`GRANT CREATE ON SCHEMA public TO ${escIdent(role)}`).catch(() => {});
  }
}

function memberRoleName(dbCode: string, userId: string): string {
  const code = dbCode.toLowerCase();
  const prefix = userId.replace(/-/g, "").slice(0, 8).toLowerCase();
  return `m_${code}_${prefix}`.slice(0, 63);
}

export async function ensureMemberPgRole(input: {
  dbCode: string;
  userId: string;
  password: string;
  permissions: string[];
  fullAccess: boolean;
}): Promise<{ user: string; pgUser: string; connectionUrl: string }> {
  const pool = getTargetPool(input.dbCode, "");
  const role = memberRoleName(input.dbCode, input.userId);
  const exists = await pool.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role]);
  if (!exists.rowCount) {
    await pool.query(
      `CREATE ROLE ${escIdent(role)} WITH LOGIN PASSWORD ${escLit(input.password)} NOSUPERUSER NOCREATEDB NOCREATEROLE`
    );
  } else {
    await pool.query(`ALTER ROLE ${escIdent(role)} WITH PASSWORD ${escLit(input.password)}`);
  }
  await pool.query(`GRANT CONNECT ON DATABASE current_database() TO ${escIdent(role)}`).catch(() => {});
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${escIdent(role)}`).catch(() => {});
  await applyMemberPgGrants({
    dbCode: input.dbCode,
    userId: input.userId,
    permissions: input.permissions,
    fullAccess: input.fullAccess,
  });
  const { database } = await import("./runtime.js").then((m) => m.buildTargetNames(input.dbCode));
  const host = process.env.TARGET_DB_HOST || process.env.PGHOST || "127.0.0.1";
  const port = String(process.env.TARGET_DB_PORT || process.env.PGPORT || "5432");
  const connectionUrl = `postgresql://${role}:${encodeURIComponent(input.password)}@${host}:${port}/${database}`;
  return { user: role, pgUser: role, connectionUrl };
}

export async function dropMemberPgRole(dbCode: string, userId: string): Promise<void> {
  const pool = getTargetPool(dbCode, "");
  const role = memberRoleName(dbCode, userId);
  await pool.query(`DROP ROLE IF EXISTS ${escIdent(role)}`).catch(() => {});
}

function escLit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export async function pgDiscoverTables(dbCode: string): Promise<
  Array<{ name: string; columns: DiscoveredColumn[] }>
> {
  const pool = getTargetPool(dbCode, "");
  const tables = await pool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       AND left(table_name, 3) <> '_dt'
     ORDER BY table_name`
  );
  const out: Array<{ name: string; columns: DiscoveredColumn[] }> = [];
  for (const row of tables.rows) {
    const name = String(row.table_name);
    const cols = await pool.query(
      `SELECT c.column_name, c.udt_name, c.is_nullable, c.ordinal_position,
              CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_pk,
              CASE WHEN u.column_name IS NOT NULL THEN true ELSE false END AS is_unique
       FROM information_schema.columns c
       LEFT JOIN (
         SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
       ) pk ON pk.column_name = c.column_name
       LEFT JOIN (
         SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'UNIQUE'
       ) u ON u.column_name = c.column_name
       WHERE c.table_schema = 'public' AND c.table_name = $1
         AND left(c.column_name, 3) <> '_dt'
       ORDER BY c.ordinal_position`,
      [name]
    );
    let columns: DiscoveredColumn[] = cols.rows.map((c, i) => ({
      name: String(c.column_name),
      dataType: mapPgType(String(c.udt_name)),
      nullable: String(c.is_nullable).toUpperCase() !== "NO",
      unique: !!c.is_unique || !!c.is_pk,
      isPrimaryKey: !!c.is_pk,
      position: i,
    }));
    const idIdx = columns.findIndex((c) => c.name.toLowerCase() === "id");
    if (idIdx > 0) {
      const [idCol] = columns.splice(idIdx, 1);
      columns.unshift({ ...idCol!, position: 0, isPrimaryKey: true, unique: true, nullable: false });
      columns = columns.map((c, i) => ({ ...c, position: i }));
    }
    out.push({ name, columns });
  }
  return out;
}

async function upsertDiscoveredTable(
  dbCode: string,
  table: { name: string; columns: DiscoveredColumn[] }
): Promise<{ tableId: string; columns: Array<DiscoveredColumn & { id: string }> }> {
  const pool = getTargetPool(dbCode, "");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let tableId: string;
    const existing = await client.query(
      `SELECT id FROM _dt.tables WHERE lower(name) = lower($1) LIMIT 1`,
      [table.name]
    );
    if (existing.rowCount && existing.rows[0]?.id) {
      tableId = String(existing.rows[0].id);
      await client.query(
        `UPDATE _dt.tables SET name = $1, schema_version = schema_version + 1, updated_at = now() WHERE id = $2`,
        [table.name, tableId]
      );
    } else {
      tableId = crypto.randomUUID();
      await client.query(
        `INSERT INTO _dt.tables (id, name, schema_version) VALUES ($1, $2, 1)`,
        [tableId, table.name]
      );
    }

    const colRows = await client.query(
      `SELECT id, name FROM _dt.columns WHERE table_id = $1`,
      [tableId]
    );
    const byName = new Map<string, string>();
    for (const r of colRows.rows) {
      byName.set(String(r.name).toLowerCase(), String(r.id));
    }
    const keepNames = new Set(table.columns.map((c) => c.name.toLowerCase()));
    for (const [n, id] of byName) {
      if (!keepNames.has(n)) {
        await client.query(`DELETE FROM _dt.columns WHERE id = $1`, [id]);
        byName.delete(n);
      }
    }

    const columns: Array<DiscoveredColumn & { id: string }> = [];
    for (const c of table.columns) {
      let id = byName.get(c.name.toLowerCase());
      if (!id) {
        id = crypto.randomUUID();
        await client.query(
          `INSERT INTO _dt.columns (id, table_id, name, data_type, nullable, is_unique, is_primary_key, position)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, tableId, c.name, c.dataType, c.nullable, c.unique, c.isPrimaryKey, c.position]
        );
      } else {
        await client.query(
          `UPDATE _dt.columns
           SET name = $1, data_type = $2, nullable = $3, is_unique = $4, is_primary_key = $5, position = $6
           WHERE id = $7`,
          [c.name, c.dataType, c.nullable, c.unique, c.isPrimaryKey, c.position, id]
        );
      }
      columns.push({ ...c, id });
    }
    await client.query("COMMIT");
    return { tableId, columns };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function pgInstallDdlNotify(dbCode: string): Promise<void> {
  const pool = getTargetPool(dbCode, "");
  await pool.query(`
    CREATE OR REPLACE FUNCTION _dt_ddl_notify() RETURNS event_trigger AS $$
    DECLARE
      r RECORD;
      tname text;
    BEGIN
      IF current_setting('app.dt_internal', true) = '1' THEN
        RETURN;
      END IF;
      FOR r IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
        IF r.command_tag IN ('CREATE TABLE', 'DROP TABLE') THEN
          tname := split_part(r.object_identity, '.', 2);
          IF tname IS NULL OR tname = '' THEN
            tname := r.object_identity;
          END IF;
          IF position('_dt' in lower(coalesce(tname, ''))) = 1 THEN
            CONTINUE;
          END IF;
          PERFORM pg_notify(
            'dt_change',
            json_build_object(
              'table', tname,
              'op', 'DDL',
              'command', r.command_tag,
              'at', NOW(),
              'actor', session_user
            )::text
          );
        END IF;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = '_dt_ddl_notify_trg') THEN
        DROP EVENT TRIGGER IF EXISTS _dt_ddl_notify_trg;
      END IF;
      CREATE EVENT TRIGGER _dt_ddl_notify_trg
        ON ddl_command_end
        WHEN TAG IN ('CREATE TABLE', 'DROP TABLE')
        EXECUTE FUNCTION _dt_ddl_notify();
    END $$;
  `);
}

const tableLimitByCode = new Map<string, number>();

export function getTableLimit(dbCode: string): number | undefined {
  return tableLimitByCode.get(dbCode.toLowerCase());
}

export async function pgSetTableLimit(dbCode: string, maxTables: number): Promise<void> {
  const pool = getTargetPool(dbCode, "");
  const lim = Math.max(0, Math.floor(Number(maxTables) || 0));
  tableLimitByCode.set(dbCode.toLowerCase(), lim);

  await pool.query(`CREATE SCHEMA IF NOT EXISTS _dt`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _dt.config (
      key text PRIMARY KEY,
      value text NOT NULL
    )
  `);
  await pool.query(
    `INSERT INTO _dt.config (key, value) VALUES ('max_tables', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [String(lim)]
  );

  await pool.query(`
    CREATE OR REPLACE FUNCTION _dt_table_limit_guard() RETURNS event_trigger AS $$
    DECLARE
      r RECORD;
      tname text;
      cnt int;
      lim int;
    BEGIN
      IF current_setting('app.dt_internal', true) = '1' THEN
        RETURN;
      END IF;

      SELECT NULLIF(value, '')::int INTO lim FROM _dt.config WHERE key = 'max_tables';
      IF lim IS NULL OR lim < 0 THEN
        RETURN;
      END IF;

      FOR r IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
        IF r.command_tag = 'CREATE TABLE' THEN
          tname := split_part(r.object_identity, '.', 2);
          IF tname IS NULL OR tname = '' THEN
            tname := r.object_identity;
          END IF;
          IF position('_dt' in lower(coalesce(tname, ''))) = 1 THEN
            CONTINUE;
          END IF;

          SELECT count(*)::int INTO cnt
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
            AND left(table_name, 3) <> '_dt';

          IF cnt > lim THEN
            RAISE EXCEPTION 'DragTable plan table limit reached (max % tables per database)', lim
              USING ERRCODE = 'check_violation';
          END IF;
        END IF;
      END LOOP;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = '_dt_table_limit_trg') THEN
        DROP EVENT TRIGGER IF EXISTS _dt_table_limit_trg;
      END IF;
      CREATE EVENT TRIGGER _dt_table_limit_trg
        ON ddl_command_end
        WHEN TAG IN ('CREATE TABLE')
        EXECUTE FUNCTION _dt_table_limit_guard();
    END $$;
  `);
}

const ddlInstalled = new Set<string>();
const reconcileInflight = new Map<
  string,
  Promise<{
    tables: Array<{
      tableId: string;
      name: string;
      columns: Array<DiscoveredColumn & { id: string }>;
    }>;
  }>
>();

export async function pgReconcileDatabase(dbCode: string): Promise<{
  tables: Array<{
    tableId: string;
    name: string;
    columns: Array<DiscoveredColumn & { id: string }>;
  }>;
}> {
  const code = dbCode.toLowerCase();
  const existing = reconcileInflight.get(code);
  if (existing) return existing;

  const job = (async () => {
    await pgInstallDdlNotify(code).catch((e) =>
      console.error("[target-pg] ddl notify install", e)
    );
    ddlInstalled.add(code);

    const lim = tableLimitByCode.get(code);
    if (lim !== undefined) {
      await pgSetTableLimit(code, lim).catch((e) =>
        console.error("[target-pg] table limit install", e)
      );
    }

    let discovered = await pgDiscoverTables(code);

    if (lim !== undefined && lim >= 0 && discovered.length > lim) {
      const pool = getTargetPool(code, "");
      const sorted = [...discovered].sort((a, b) => a.name.localeCompare(b.name));
      const excess = sorted.slice(lim);
      for (const t of excess) {
        try {
          await pool.query(`SELECT set_config('app.dt_internal', '1', false)`);
          await pool.query(`DROP TABLE IF EXISTS ${escIdent(t.name)} CASCADE`);
          await pool
            .query(`DELETE FROM _dt.tables WHERE lower(name) = lower($1)`, [t.name])
            .catch(() => {});
          await pool.query(`SELECT set_config('app.dt_internal', '0', false)`);
          console.warn(`[target-pg] dropped excess table ${t.name} (plan limit ${lim})`);
        } catch (e) {
          console.error("[target-pg] drop excess table", t.name, e);
        }
      }
      discovered = await pgDiscoverTables(code);
    }

    const results: Array<{
      tableId: string;
      name: string;
      columns: Array<DiscoveredColumn & { id: string }>;
    }> = [];

    for (const t of discovered) {
      try {
        await enforceSystemUuidId(code, t.name).catch(() => {});
        await pgEnsureDtColumns(code, t.name).catch(() => {});
        await pgAttachChangeNotify(code, t.name).catch(() => {});
        const refreshed = await pgDiscoverTables(code);
        const current = refreshed.find((x) => x.name.toLowerCase() === t.name.toLowerCase()) ?? t;
        const upserted = await upsertDiscoveredTable(code, current);
        results.push({ tableId: upserted.tableId, name: current.name, columns: upserted.columns });
      } catch (e) {
        console.error("[target-pg] reconcile table", t.name, e);
      }
    }

    try {
      await syncOwnerTableGrants(code);
    } catch {
    }

    return { tables: results };
  })();

  reconcileInflight.set(code, job);
  try {
    return await job;
  } finally {
    reconcileInflight.delete(code);
  }
}
