/**
 * Target data plane — structured table/row operations (no arbitrary SQL).
 * In-memory for hackathon bootstrap; maps to real PG later.
 */

import type { DataType } from "@dragtable/contracts";
import { isValidTableName, isValidColumnName, planAllowsNewTable } from "@dragtable/domain";
import type { PlanId } from "@dragtable/contracts";
import fs from "node:fs";
import path from "node:path";

function targetDataDir(): string {
  return process.env.DATA_DIR || path.resolve(process.cwd(), ".data");
}

let targetPersistTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleTargetPersist() {
  if (targetPersistTimer) clearTimeout(targetPersistTimer);
  targetPersistTimer = setTimeout(() => {
    try {
      const dir = targetDataDir();
      fs.mkdirSync(dir, { recursive: true });
      const tablesObj: Record<string, TableMeta[]> = {};
      for (const [dbId, map] of tables.entries()) {
        tablesObj[dbId] = [...map.values()];
      }
      const rowsObj: Record<string, RowRecord[]> = {};
      for (const [tid, rows] of rowsByTable.entries()) {
        rowsObj[tid] = rows;
      }
      const namesObj: Record<string, string[]> = {};
      for (const [dbId, set] of tableNames.entries()) {
        namesObj[dbId] = [...set];
      }
      const fksObj: Record<string, ForeignKeyMeta[]> = {};
      for (const [dbId, list] of foreignKeysByDb.entries()) fksObj[dbId] = list;
      const idxObj: Record<string, IndexMeta[]> = {};
      for (const [dbId, list] of indexesByDb.entries()) idxObj[dbId] = list;
      const chkObj: Record<string, CheckConstraintMeta[]> = {};
      for (const [dbId, list] of checksByDb.entries()) chkObj[dbId] = list;
      const file = path.join(dir, "target-db.json");
      const tmp = file + ".tmp";
      fs.writeFileSync(
        tmp,
        JSON.stringify({
          version: 2,
          tables: tablesObj,
          rows: rowsObj,
          names: namesObj,
          foreignKeys: fksObj,
          indexes: idxObj,
          checks: chkObj,
        })
      );
      fs.renameSync(tmp, file);
    } catch (e) {
      console.error("[target-db] persist failed", e);
    }
  }, 25);
}

function loadTargetDb() {
  const file = path.join(targetDataDir(), "target-db.json");
  if (!fs.existsSync(file)) return;
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    tables.clear();
    rowsByTable.clear();
    tableNames.clear();
    for (const [dbId, list] of Object.entries(payload.tables || {}) as [string, TableMeta[]][]) {
      const m = new Map<string, TableMeta>();
      for (const tb of list) m.set(tb.id, tb);
      tables.set(dbId, m);
    }
    for (const [tid, rows] of Object.entries(payload.rows || {}) as [string, RowRecord[]][]) {
      rowsByTable.set(tid, rows);
    }
    for (const [dbId, names] of Object.entries(payload.names || {}) as [string, string[]][]) {
      tableNames.set(dbId, new Set(names));
    }
    foreignKeysByDb.clear();
    indexesByDb.clear();
    checksByDb.clear();
    for (const [dbId, list] of Object.entries(payload.foreignKeys || {}) as [string, ForeignKeyMeta[]][]) {
      foreignKeysByDb.set(dbId, list);
    }
    for (const [dbId, list] of Object.entries(payload.indexes || {}) as [string, IndexMeta[]][]) {
      indexesByDb.set(dbId, list);
    }
    for (const [dbId, list] of Object.entries(payload.checks || {}) as [string, CheckConstraintMeta[]][]) {
      checksByDb.set(dbId, list);
    }
    console.log(`[target-db] restored from ${file}`);
  } catch (e) {
    console.error("[target-db] load failed", e);
  }
}


import {
  isTargetPgEnabled,
  pgCreateTable,
  pgDropTable,
  pgRenameTable,
  pgAddColumn,
  pgDropColumn,
  pgInsertRow,
  pgUpdateCell,
  pgDeleteRow,
  pgListRows,
  pgAttachChangeNotify,
  pgReconcileDatabase,
} from "@dragtable/target-pg";

/** databaseId (control uuid) -> dbCode for real Postgres target */
const pgCodeByDbId = new Map<string, string>();

export function bindPgDatabase(databaseId: string, dbCode: string): void {
  pgCodeByDbId.set(databaseId, dbCode.toLowerCase());
}

export function unbindPgDatabase(databaseId: string): void {
  pgCodeByDbId.delete(databaseId);
}

function pgCode(databaseId: string): string | null {
  if (!isTargetPgEnabled()) return null;
  return pgCodeByDbId.get(databaseId) ?? null;
}

/**
 * Run a dual-write against real Postgres when enabled + bound.
 * - Not enabled / not bound → no-op (memory is source of truth)
 * - Connectivity / missing-DB errors → log + memory-only (do not fail the user)
 * - Real SQL/constraint errors → rethrow
 */
async function withPg(
  databaseId: string,
  fn: (code: string) => Promise<void>
): Promise<boolean> {
  const code = pgCode(databaseId);
  if (!code) return false;
  try {
    await fn(code);
    return true;
  } catch (e) {
    if (isPgUnavailable(e)) {
      console.error(
        "[target-db] Postgres unavailable for",
        code,
        "— continuing memory-only:",
        e instanceof Error ? e.message : e
      );
      return false;
    }
    throw e;
  }
}

function isPgUnavailable(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
  // node-pg / libpq connection-style failures
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "57P01" || // admin_shutdown
    code === "57P03" || // cannot_connect_now
    code === "3D000" || // invalid_catalog_name (database does not exist)
    code === "28P01" || // invalid_password
    code === "28000" // invalid_authorization
  ) {
    return true;
  }
  if (
    msg.includes("econnrefused") ||
    msg.includes("connect enotfound") ||
    msg.includes("connection terminated") ||
    msg.includes("timeout expired") ||
    msg.includes("does not exist") ||
    msg.includes("password authentication failed") ||
    msg.includes("the database system is starting up") ||
    msg.includes("target_admin_url") ||
    msg.includes("not configured")
  ) {
    return true;
  }
  return false;
}

function pgErr(e: unknown, fallback: string): never {
  if (isPgUnavailable(e)) {
    // Should have been swallowed by withPg; keep as soft path if callers use pgErr directly
    throw Object.assign(new Error(fallback + " (Postgres unavailable)"), {
      code: "PROVISION_FAILED",
      cause: e,
    });
  }
  const msg =
    e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string"
      ? (e as { message: string }).message
      : fallback;
  const code =
    e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string"
      ? (e as { code: string }).code
      : "PROVISION_FAILED";
  throw Object.assign(new Error(msg), { code, cause: e });
}

export interface ColumnMeta {
  id: string;
  name: string;
  dataType: DataType;
  nullable: boolean;
  unique: boolean;
  isPrimaryKey: boolean;
  position: number;
}

export interface TableMeta {
  id: string;
  databaseId: string;
  name: string;
  schemaVersion: number;
  columns: ColumnMeta[];
  createdAt: string;
  updatedAt: string;
}

export interface RowRecord {
  id: string;
  version: number;
  values: Record<string, unknown>; // keyed by column id
  createdAt: string;
  updatedAt: string;
}

export interface TableSnapshot {
  table: TableMeta;
  rows: RowRecord[];
  totalRows: number;
}

export type FkOnDelete = "restrict" | "cascade" | "set_null";

export interface ForeignKeyMeta {
  id: string;
  name: string;
  databaseId: string;
  tableId: string;
  columnId: string;
  refTableId: string;
  refColumnId: string;
  onDelete: FkOnDelete;
  createdAt: string;
}

export interface IndexMeta {
  id: string;
  name: string;
  databaseId: string;
  tableId: string;
  columnIds: string[];
  unique: boolean;
  createdAt: string;
}

export type CheckOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "not_null";

export interface CheckConstraintMeta {
  id: string;
  name: string;
  databaseId: string;
  tableId: string;
  columnId: string;
  op: CheckOp;
  value?: unknown;
  createdAt: string;
}

export interface SchemaExtras {
  foreignKeys: ForeignKeyMeta[];
  indexes: IndexMeta[];
  checks: CheckConstraintMeta[];
}

function uuid(): string {
  return crypto.randomUUID();
}

function err(code: string, message?: string, extra?: Record<string, unknown>) {
  return Object.assign(new Error(message ?? code), { code, ...extra });
}

/** System-managed identity: column named `id` OR uuid primary key — never user-supplied. */
function isSystemManagedIdColumn(col: {
  name: string;
  dataType: string;
  isPrimaryKey: boolean;
}): boolean {
  const n = (col.name || "").toLowerCase();
  if (n === "id") return true;
  const dt = (col.dataType || "").toLowerCase();
  if (col.isPrimaryKey && dt === "uuid") return true;
  return false;
}

const VALID_TYPES: DataType[] = [
  "text",
  "integer",
  "numeric",
  "boolean",
  "date",
  "timestamp",
  "uuid",
  "jsonb",
];

// databaseId -> tableId -> TableMeta
const tables = new Map<string, Map<string, TableMeta>>();
// tableId -> rows
const rowsByTable = new Map<string, RowRecord[]>();
// tableId -> name index for uniqueness within db
const tableNames = new Map<string, Set<string>>(); // databaseId -> lower names

const foreignKeysByDb = new Map<string, ForeignKeyMeta[]>();
const indexesByDb = new Map<string, IndexMeta[]>();
const checksByDb = new Map<string, CheckConstraintMeta[]>();

function dbTables(databaseId: string): Map<string, TableMeta> {
  let m = tables.get(databaseId);
  if (!m) {
    m = new Map();
    tables.set(databaseId, m);
  }
  return m;
}

function nameSet(databaseId: string): Set<string> {
  let s = tableNames.get(databaseId);
  if (!s) {
    s = new Set();
    tableNames.set(databaseId, s);
  }
  return s;
}

loadTargetDb();

function coerceValue(dataType: DataType, value: unknown, nullable: boolean): unknown {
  if (value === null || value === undefined || value === "") {
    if (nullable) return null;
    throw err("VALIDATION_FAILED", "Value required (column is not nullable)");
  }
  switch (dataType) {
    case "text":
      return String(value);
    case "integer": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isInteger(n)) throw err("VALIDATION_FAILED", "Expected integer");
      return n;
    }
    case "numeric": {
      const n = typeof value === "number" ? value : Number(value);
      if (Number.isNaN(n)) throw err("VALIDATION_FAILED", "Expected number");
      return n;
    }
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === "1") return true;
      if (value === "false" || value === "0") return false;
      throw err("VALIDATION_FAILED", "Expected boolean");
    case "date":
    case "timestamp":
      return String(value);
    case "uuid":
      return String(value);
    case "jsonb":
      if (typeof value === "object") return value;
      try {
        return JSON.parse(String(value));
      } catch {
        throw err("VALIDATION_FAILED", "Expected JSON");
      }
    default:
      return value;
  }
}


function fksOf(databaseId: string): ForeignKeyMeta[] {
  let list = foreignKeysByDb.get(databaseId);
  if (!list) {
    list = [];
    foreignKeysByDb.set(databaseId, list);
  }
  return list;
}
function idxsOf(databaseId: string): IndexMeta[] {
  let list = indexesByDb.get(databaseId);
  if (!list) {
    list = [];
    indexesByDb.set(databaseId, list);
  }
  return list;
}
function checksOf(databaseId: string): CheckConstraintMeta[] {
  let list = checksByDb.get(databaseId);
  if (!list) {
    list = [];
    checksByDb.set(databaseId, list);
  }
  return list;
}

function enforceChecks(
  databaseId: string,
  tableId: string,
  values: Record<string, unknown>
): void {
  for (const ck of checksOf(databaseId)) {
    if (ck.tableId !== tableId) continue;
    const v = values[ck.columnId];
    switch (ck.op) {
      case "not_null":
        if (v === null || v === undefined) {
          throw err("CONSTRAINT_VIOLATION", `Check ${ck.name}: column must not be null`);
        }
        break;
      case "eq":
        if (v !== ck.value) throw err("CONSTRAINT_VIOLATION", `Check ${ck.name}: must equal ${ck.value}`);
        break;
      case "neq":
        if (v === ck.value) throw err("CONSTRAINT_VIOLATION", `Check ${ck.name}: must not equal ${ck.value}`);
        break;
      case "gt":
        if (!(typeof v === "number" && v > Number(ck.value)))
          throw err("CONSTRAINT_VIOLATION", `Check ${ck.name}: must be > ${ck.value}`);
        break;
      case "gte":
        if (!(typeof v === "number" && v >= Number(ck.value)))
          throw err("CONSTRAINT_VIOLATION", `Check ${ck.name}: must be >= ${ck.value}`);
        break;
      case "lt":
        if (!(typeof v === "number" && v < Number(ck.value)))
          throw err("CONSTRAINT_VIOLATION", `Check ${ck.name}: must be < ${ck.value}`);
        break;
      case "lte":
        if (!(typeof v === "number" && v <= Number(ck.value)))
          throw err("CONSTRAINT_VIOLATION", `Check ${ck.name}: must be <= ${ck.value}`);
        break;
    }
  }
}

function enforceForeignKeys(
  databaseId: string,
  tableId: string,
  values: Record<string, unknown>
): void {
  for (const fk of fksOf(databaseId)) {
    if (fk.tableId !== tableId) continue;
    const v = values[fk.columnId];
    if (v === null || v === undefined) continue; // nullable FK allowed if column nullable
    const refRows = rowsByTable.get(fk.refTableId) ?? [];
    const ok = refRows.some((r) => r.values[fk.refColumnId] === v);
    if (!ok) {
      throw err("CONSTRAINT_VIOLATION", `Foreign key ${fk.name}: value not found in referenced table`);
    }
  }
}

function enforceUniqueIndexes(
  databaseId: string,
  tableId: string,
  values: Record<string, unknown>,
  excludeRowId?: string
): void {
  for (const ix of idxsOf(databaseId)) {
    if (ix.tableId !== tableId || !ix.unique) continue;
    const key = ix.columnIds.map((id) => values[id]).join("\0");
    if (ix.columnIds.some((id) => values[id] === null || values[id] === undefined)) continue;
    const rows = rowsByTable.get(tableId) ?? [];
    for (const r of rows) {
      if (excludeRowId && r.id === excludeRowId) continue;
      const other = ix.columnIds.map((id) => r.values[id]).join("\0");
      if (other === key) {
        throw err("CONSTRAINT_VIOLATION", `Unique index ${ix.name} violated`);
      }
    }
  }
}

function enforceDeleteRestrict(databaseId: string, tableId: string, row: RowRecord): void {
  for (const fk of fksOf(databaseId)) {
    if (fk.refTableId !== tableId) continue;
    const refVal = row.values[fk.refColumnId];
    if (refVal === null || refVal === undefined) continue;
    const childRows = rowsByTable.get(fk.tableId) ?? [];
    const referencing = childRows.filter((r) => r.values[fk.columnId] === refVal);
    if (!referencing.length) continue;
    if (fk.onDelete === "restrict") {
      throw err(
        "CONSTRAINT_VIOLATION",
        `Cannot delete: ${referencing.length} row(s) reference this via ${fk.name}`
      );
    }
    if (fk.onDelete === "cascade") {
      const remaining = childRows.filter((r) => r.values[fk.columnId] !== refVal);
      rowsByTable.set(fk.tableId, remaining);
    } else if (fk.onDelete === "set_null") {
      for (const r of referencing) {
        r.values[fk.columnId] = null;
        r.version += 1;
        r.updatedAt = new Date().toISOString();
      }
    }
  }
}



/** Serialize + light-debounce syncDatabaseFromPg per databaseId (prevents API lockup). */
const syncInflight = new Map<string, Promise<number>>();
const syncLastDone = new Map<string, number>();
const SYNC_MIN_INTERVAL_MS = 400;

export const targetDb = {
  listTables(databaseId: string): TableMeta[] {
    const m = dbTables(databaseId);
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  },

  getTable(databaseId: string, tableId: string): TableMeta | null {
    return dbTables(databaseId).get(tableId) ?? null;
  },

  async createTable(input: {
    databaseId: string;
    name: string;
    columns: Array<{
      name: string;
      dataType: DataType;
      nullable?: boolean;
      unique?: boolean;
      isPrimaryKey?: boolean;
    }>;
    planId: PlanId;
  }): Promise<TableMeta> {
    const name = input.name.trim();
    if (!isValidTableName(name)) {
      throw err("VALIDATION_FAILED", "Invalid table name (use letters, numbers, underscore; start with letter)");
    }
    const names = nameSet(input.databaseId);
    if (names.has(name.toLowerCase())) {
      throw err("VALIDATION_FAILED", "Table name already exists");
    }
    const existingCount = dbTables(input.databaseId).size;
    if (!planAllowsNewTable(input.planId, existingCount)) {
      throw err("TABLE_LIMIT_REACHED", "Plan table limit reached for this database");
    }
    if (!input.columns.length) {
      throw err("VALIDATION_FAILED", "At least one column is required");
    }

    // System owns the primary key: always a non-null unique uuid column named "id".
    // Client-provided "id" columns or uuid PK definitions are ignored completely.
    const colNames = new Set<string>();
    const columns: ColumnMeta[] = [];
    for (const c of input.columns) {
      const cn = c.name.trim();
      if (!isValidColumnName(cn)) {
        throw err("VALIDATION_FAILED", `Invalid column name: ${c.name}`);
      }
      const lower = cn.toLowerCase();
      // Ignore any client attempt to define the system id / uuid primary key
      if (lower === "id") continue;
      if (c.isPrimaryKey && c.dataType === "uuid") continue;
      if (colNames.has(lower)) {
        throw err("VALIDATION_FAILED", `Duplicate column: ${cn}`);
      }
      colNames.add(lower);
      if (!VALID_TYPES.includes(c.dataType)) {
        throw err("VALIDATION_FAILED", `Invalid data type: ${c.dataType}`);
      }
      columns.push({
        id: uuid(),
        name: cn,
        dataType: c.dataType,
        // Never allow client columns to be primary key — system id is the only PK
        nullable: c.nullable !== false,
        unique: !!c.unique,
        isPrimaryKey: false,
        position: columns.length,
      });
    }

    if (!columns.length) {
      throw err("VALIDATION_FAILED", "At least one non-id column is required");
    }

    // Always inject system-managed uuid primary key
    columns.unshift({
      id: uuid(),
      name: "id",
      dataType: "uuid",
      nullable: false,
      unique: true,
      isPrimaryKey: true,
      position: 0,
    });
    columns.forEach((c, i) => {
      c.position = i;
    });

    const now = new Date().toISOString();
    const table: TableMeta = {
      id: uuid(),
      databaseId: input.databaseId,
      name,
      schemaVersion: 1,
      columns,
      createdAt: now,
      updatedAt: now,
    };

    // Dual-write: Postgres first when bound so we never leave orphan memory tables
    try {
      await withPg(input.databaseId, async (code) => {
        await pgCreateTable(code, {
          id: table.id,
          name: table.name,
          columns: table.columns.map((c) => ({
            id: c.id,
            name: c.name,
            dataType: c.dataType,
            nullable: c.nullable,
            unique: c.unique,
            isPrimaryKey: c.isPrimaryKey,
            position: c.position,
          })),
        });
      });
    } catch (e) {
      pgErr(e, "Could not create table in Postgres");
    }

    dbTables(input.databaseId).set(table.id, table);
    names.add(name.toLowerCase());
    rowsByTable.set(table.id, []);
    scheduleTargetPersist();
    return table;
  },

  async dropTable(databaseId: string, tableId: string): Promise<void> {
    const table = dbTables(databaseId).get(tableId);
    if (!table) throw err("VALIDATION_FAILED", "Table not found");
    for (const fk of fksOf(databaseId)) {
      if (fk.refTableId === tableId) {
        throw err("CONSTRAINT_VIOLATION", `Table is referenced by foreign key ${fk.name}`);
      }
    }
    try {
      await withPg(databaseId, async (code) => {
        await pgDropTable(code, table.name, tableId);
      });
    } catch (e) {
      // Table may already be gone externally — still remove ghost from workspace
      const msg = e instanceof Error ? e.message : String(e);
      if (!/does not exist|not found/i.test(msg)) {
        pgErr(e, "Could not drop table in Postgres");
      }
    }
    dbTables(databaseId).delete(tableId);
    nameSet(databaseId).delete(table.name.toLowerCase());
    rowsByTable.delete(tableId);
    foreignKeysByDb.set(
      databaseId,
      fksOf(databaseId).filter((f) => f.tableId !== tableId)
    );
    indexesByDb.set(
      databaseId,
      idxsOf(databaseId).filter((x) => x.tableId !== tableId)
    );
    checksByDb.set(
      databaseId,
      checksOf(databaseId).filter((c) => c.tableId !== tableId)
    );
    scheduleTargetPersist();
  },

  async renameTable(databaseId: string, tableId: string, newName: string): Promise<TableMeta> {
    const table = dbTables(databaseId).get(tableId);
    if (!table) throw err("VALIDATION_FAILED", "Table not found");
    const name = newName.trim();
    if (!isValidTableName(name)) throw err("VALIDATION_FAILED", "Invalid table name");
    const names = nameSet(databaseId);
    if (name.toLowerCase() !== table.name.toLowerCase() && names.has(name.toLowerCase())) {
      throw err("VALIDATION_FAILED", "Table name already exists");
    }
    const oldName = table.name;
    names.delete(table.name.toLowerCase());
    table.name = name;
    names.add(name.toLowerCase());
    try {
      await withPg(databaseId, async (code) => {
        await pgRenameTable(code, tableId, oldName, name);
      });
    } catch (e) {
      // roll back in-memory rename
      names.delete(name.toLowerCase());
      table.name = oldName;
      names.add(oldName.toLowerCase());
      pgErr(e, "Could not rename table in Postgres");
    }
    table.schemaVersion += 1;
    table.updatedAt = new Date().toISOString();
    scheduleTargetPersist();
    return table;
  },

  async addColumn(
    databaseId: string,
    tableId: string,
    column: {
      name: string;
      dataType: DataType;
      nullable?: boolean;
      unique?: boolean;
    }
  ): Promise<TableMeta> {
    const table = dbTables(databaseId).get(tableId);
    if (!table) throw err("VALIDATION_FAILED", "Table not found");
    const cn = column.name.trim();
    if (!isValidColumnName(cn)) throw err("VALIDATION_FAILED", "Invalid column name");
    if (table.columns.some((c) => c.name.toLowerCase() === cn.toLowerCase())) {
      throw err("VALIDATION_FAILED", "Column already exists");
    }
    if (!VALID_TYPES.includes(column.dataType)) {
      throw err("VALIDATION_FAILED", "Invalid data type");
    }
    const meta: ColumnMeta = {
      id: uuid(),
      name: cn,
      dataType: column.dataType,
      nullable: column.nullable !== false,
      unique: !!column.unique,
      isPrimaryKey: false,
      position: table.columns.length,
    };

    try {
      await withPg(databaseId, async (code) => {
        await pgAddColumn(code, table.name, {
          id: meta.id,
          name: meta.name,
          dataType: meta.dataType,
          nullable: meta.nullable,
          unique: meta.unique,
          isPrimaryKey: meta.isPrimaryKey,
          position: meta.position,
        });
      });
    } catch (e) {
      pgErr(e, "Could not add column in Postgres");
    }

    table.columns = [...table.columns, meta];
    table.schemaVersion += 1;
    table.updatedAt = new Date().toISOString();

    // backfill null for existing rows
    const rows = rowsByTable.get(tableId) ?? [];
    for (const r of rows) {
      r.values[meta.id] = null;
      r.version += 1;
    }
    scheduleTargetPersist();
    return table;
  },

  async dropColumn(databaseId: string, tableId: string, columnId: string): Promise<TableMeta> {
    const table = dbTables(databaseId).get(tableId);
    if (!table) throw err("VALIDATION_FAILED", "Table not found");
    const col = table.columns.find((c) => c.id === columnId);
    if (!col) throw err("VALIDATION_FAILED", "Column not found");
    if (col.isPrimaryKey) throw err("VALIDATION_FAILED", "Cannot drop primary key column");

    try {
      await withPg(databaseId, async (code) => {
        await pgDropColumn(code, table.name, col.name, columnId);
      });
    } catch (e) {
      pgErr(e, "Could not drop column in Postgres");
    }

    table.columns = table.columns.filter((c) => c.id !== columnId);
    table.schemaVersion += 1;
    table.updatedAt = new Date().toISOString();
    const rows = rowsByTable.get(tableId) ?? [];
    for (const r of rows) {
      delete r.values[columnId];
      r.version += 1;
    }
    scheduleTargetPersist();
    return table;
  },


  /**
   * Pull rows from real Postgres into memory so external IDE writes appear in workspace.
   * Returns true if PG was queried.
   */
  async syncTableFromPg(databaseId: string, tableId: string): Promise<boolean> {
    const code = pgCode(databaseId);
    if (!code) return false;
    const table = dbTables(databaseId).get(tableId);
    if (!table) return false;
    try {
      const { rows } = await pgListRows(
        code,
        table.name,
        table.columns.map((c) => ({
          id: c.id,
          name: c.name,
          dataType: c.dataType,
          nullable: c.nullable,
          unique: c.unique,
          isPrimaryKey: c.isPrimaryKey,
          position: c.position,
        })),
        10_000,
        0
      );
      // Only replace memory when Postgres answered successfully.
      // Keeps memory-only rows if the physical table is missing/empty after a soft dual-write.
      const mem = rowsByTable.get(tableId) ?? [];
      if (rows.length > 0 || mem.length === 0) {
        rowsByTable.set(tableId, rows);
      }
      return true;
    } catch (e) {
      // Table may exist only in memory — do not wipe local rows
      if (!isPgUnavailable(e)) {
        console.error("[target-db] syncTableFromPg", e);
      }
      return false;
    }
  },

  /**
   * Full reconcile against real Postgres:
   * - discover tables created externally (CREATE TABLE via connection string)
   * - drop memory tables that no longer exist in PG
   * - ensure _dt identity columns + change-notify triggers
   * - pull latest rows
   * Called on every tables list (incl. EXTERNAL_CHANGE soft-refresh).
   */
  async syncDatabaseFromPg(databaseId: string, opts?: { force?: boolean }): Promise<number> {
    const code = pgCode(databaseId);
    if (!code) return 0;

    const inflight = syncInflight.get(databaseId);
    if (inflight) return inflight;

    const last = syncLastDone.get(databaseId) ?? 0;
    if (!opts?.force && Date.now() - last < SYNC_MIN_INTERVAL_MS) {
      // Very recent sync — skip heavy reconcile; caller still gets listTables from memory
      return 0;
    }

    const job = (async (): Promise<number> => {
    try {
      const { tables: discovered } = await pgReconcileDatabase(code);
      const m = dbTables(databaseId);
      const names = nameSet(databaseId);
      const seenIds = new Set<string>();
      const now = new Date().toISOString();

      for (const d of discovered) {
        seenIds.add(d.tableId);
        // Force system id column to position 0 in workspace schema
        const rawCols: ColumnMeta[] = d.columns.map((c) => ({
          id: c.id,
          name: c.name,
          dataType: (c.dataType as DataType) || "text",
          nullable: c.nullable,
          unique: c.unique,
          isPrimaryKey: c.isPrimaryKey,
          position: c.position,
        }));
        const idCols = rawCols.filter((c) => c.name.toLowerCase() === "id");
        const rest = rawCols.filter((c) => c.name.toLowerCase() !== "id");
        const columns = [...idCols, ...rest].map((c, i) => ({ ...c, position: i }));

        // Prefer match by tableId; else dedupe by name (prevents ghost duplicate tables)
        let existing = m.get(d.tableId);
        if (!existing) {
          for (const t of m.values()) {
            if (t.name.toLowerCase() === d.name.toLowerCase()) {
              existing = t;
              // Re-key map to PG tableId so future syncs hit the same entry
              m.delete(t.id);
              const oldRows = rowsByTable.get(t.id);
              if (oldRows) {
                rowsByTable.delete(t.id);
                rowsByTable.set(d.tableId, oldRows);
              }
              t.id = d.tableId;
              m.set(d.tableId, t);
              break;
            }
          }
        }
        if (existing) {
          const oldName = existing.name.toLowerCase();
          existing.name = d.name;
          existing.columns = columns;
          existing.schemaVersion += 1;
          existing.updatedAt = now;
          if (oldName !== d.name.toLowerCase()) {
            names.delete(oldName);
            names.add(d.name.toLowerCase());
          }
        } else {
          const meta: TableMeta = {
            id: d.tableId,
            databaseId,
            name: d.name,
            schemaVersion: 1,
            columns,
            createdAt: now,
            updatedAt: now,
          };
          m.set(d.tableId, meta);
          names.add(d.name.toLowerCase());
          if (!rowsByTable.has(d.tableId)) rowsByTable.set(d.tableId, []);
        }
      }

      // Prune tables that no longer exist in Postgres (external DROP TABLE).
      // Dual-write creates PG first, so a successful reconcile is authoritative for schema.
      const discoveredNames = new Set(
        discovered.map((d) => d.name.toLowerCase())
      );
      for (const [tid, table] of [...m.entries()]) {
        if (seenIds.has(tid)) continue;
        if (discoveredNames.has(table.name.toLowerCase())) continue;
        // Gone from PG — remove ghost from workspace
        m.delete(tid);
        names.delete(table.name.toLowerCase());
        rowsByTable.delete(tid);
        foreignKeysByDb.set(
          databaseId,
          fksOf(databaseId).filter((f) => f.tableId !== tid && f.refTableId !== tid)
        );
        indexesByDb.set(
          databaseId,
          idxsOf(databaseId).filter((ix) => ix.tableId !== tid)
        );
        checksByDb.set(
          databaseId,
          checksOf(databaseId).filter((ck) => ck.tableId !== tid)
        );
      }

      scheduleTargetPersist();

      // Pull rows for every known table
      let n = 0;
      for (const table of m.values()) {
        const ok = await this.syncTableFromPg(databaseId, table.id);
        if (ok) n++;
      }
      return n;
    } catch (e) {
      console.error("[target-db] syncDatabaseFromPg", e);
      // Fallback: at least try row sync for already-known tables
      let n = 0;
      for (const table of dbTables(databaseId).values()) {
        const ok = await this.syncTableFromPg(databaseId, table.id);
        if (ok) n++;
      }
      return n;
    } finally {
      syncLastDone.set(databaseId, Date.now());
    }
    })();

    syncInflight.set(databaseId, job);
    try {
      return await job;
    } finally {
      syncInflight.delete(databaseId);
    }
  },
  async listRows(
    databaseId: string,
    tableId: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<TableSnapshot> {
    if (isTargetPgEnabled()) {
      await this.syncTableFromPg(databaseId, tableId);
    }
    const table = dbTables(databaseId).get(tableId);
    if (!table) throw err("VALIDATION_FAILED", "Table not found");
    const all = rowsByTable.get(tableId) ?? [];
    const offset = opts?.offset ?? 0;
    const limit = Math.min(opts?.limit ?? 100, 10_000);
    const rows = all.slice(offset, offset + limit);
    return { table, rows, totalRows: all.length };
  },

  /** All rows for export (bounded) */
  async listAllRows(databaseId: string, tableId: string, max = 50_000): Promise<TableSnapshot> {
    if (isTargetPgEnabled()) {
      await this.syncTableFromPg(databaseId, tableId);
    }
    const table = dbTables(databaseId).get(tableId);
    if (!table) throw err("VALIDATION_FAILED", "Table not found");
    const all = rowsByTable.get(tableId) ?? [];
    const rows = all.slice(0, max);
    return { table, rows, totalRows: all.length };
  },

  async insertRow(
    databaseId: string,
    tableId: string,
    values: Record<string, unknown> // by column name or id
  ): Promise<RowRecord> {
    const table = dbTables(databaseId).get(tableId);
    if (!table) throw err("VALIDATION_FAILED", "Table not found");
    const byName = new Map(table.columns.map((c) => [c.name.toLowerCase(), c]));
    const byId = new Map(table.columns.map((c) => [c.id, c]));

    const resolved: Record<string, unknown> = {};
    for (const col of table.columns) {
      // System-managed UUID primary keys: always auto-generate, ignore any client value
      if (isSystemManagedIdColumn(col)) {
        resolved[col.id] = uuid();
        continue;
      }
      let raw: unknown =
        values[col.id] !== undefined
          ? values[col.id]
          : values[col.name] !== undefined
            ? values[col.name]
            : undefined;
      // Also ignore values keyed by lowercase "id" for non-system columns (already handled above)
      if (raw === undefined || raw === null || raw === "") {
        if (col.nullable) {
          resolved[col.id] = null;
          continue;
        }
        throw err("VALIDATION_FAILED", `Missing value for ${col.name}`);
      }
      resolved[col.id] = coerceValue(col.dataType, raw, col.nullable);
    }

    // unique checks (simple)
    const existing = rowsByTable.get(tableId) ?? [];
    for (const col of table.columns) {
      if (!col.unique) continue;
      const v = resolved[col.id];
      if (v === null) continue;
      if (existing.some((r) => r.values[col.id] === v)) {
        throw err("CONSTRAINT_VIOLATION", `Unique constraint on ${col.name}`);
      }
    }
    enforceUniqueIndexes(databaseId, tableId, resolved);
    enforceForeignKeys(databaseId, tableId, resolved);
    enforceChecks(databaseId, tableId, resolved);

    const now = new Date().toISOString();
    let rowId = uuid();
    let finalValues = resolved;
    try {
      await withPg(databaseId, async (code) => {
        const pgRes = await pgInsertRow(
          code,
          table.name,
          table.columns.map((c) => ({
            id: c.id,
            name: c.name,
            dataType: c.dataType,
            nullable: c.nullable,
            unique: c.unique,
            isPrimaryKey: c.isPrimaryKey,
            position: c.position,
          })),
          resolved,
          rowId
        );
        // Trust Postgres (DEFAULT + system-id trigger) as source of truth for ids
        rowId = pgRes.rowId;
        finalValues = pgRes.valuesByColId;
      });
    } catch (e) {
      pgErr(e, "Could not insert row in Postgres");
    }
    const row: RowRecord = {
      id: rowId,
      version: 1,
      values: finalValues,
      createdAt: now,
      updatedAt: now,
    };
    existing.push(row);
    rowsByTable.set(tableId, existing);
    scheduleTargetPersist();
    return row;
  },

  async updateCell(
    databaseId: string,
    tableId: string,
    rowId: string,
    columnId: string,
    value: unknown,
    expectedVersion: number
  ): Promise<RowRecord> {
    const table = dbTables(databaseId).get(tableId);
    if (!table) throw err("VALIDATION_FAILED", "Table not found");
    const col = table.columns.find((c) => c.id === columnId);
    if (!col) throw err("VALIDATION_FAILED", "Column not found");
    if (isSystemManagedIdColumn(col)) {
      throw err("VALIDATION_FAILED", "Primary key id is system-managed and cannot be edited");
    }
    const rows = rowsByTable.get(tableId) ?? [];
    const row = rows.find((r) => r.id === rowId);
    if (!row) throw err("VALIDATION_FAILED", "Row not found");
    if (row.version !== expectedVersion) {
      throw err("ROW_CONFLICT", "Row was modified by someone else", {
        serverVersion: row.version,
        serverValue: row.values[columnId],
      });
    }
    const next = coerceValue(col.dataType, value, col.nullable);
    if (col.unique && next !== null) {
      if (rows.some((r) => r.id !== rowId && r.values[columnId] === next)) {
        throw err("CONSTRAINT_VIOLATION", `Unique constraint on ${col.name}`);
      }
    }
    const trialValues = { ...row.values, [columnId]: next };
    enforceUniqueIndexes(databaseId, tableId, trialValues, rowId);
    enforceForeignKeys(databaseId, tableId, trialValues);
    enforceChecks(databaseId, tableId, trialValues);

    const code = pgCode(databaseId);
    if (code) {
      try {
        const pgRes = await pgUpdateCell(
          code,
          table.name,
          col.name,
          rowId,
          next,
          expectedVersion
        );
        if (!pgRes) {
          throw err("ROW_CONFLICT", "Row was modified in Postgres by someone else", {
            serverVersion: row.version,
            serverValue: row.values[columnId],
          });
        }
        row.values[columnId] = next;
        row.version = pgRes.version;
        row.updatedAt = new Date().toISOString();
      } catch (e) {
        if (e && typeof e === "object" && (e as { code?: string }).code === "ROW_CONFLICT") throw e;
        if (isPgUnavailable(e)) {
          console.error("[target-db] updateCell PG unavailable — memory only", e instanceof Error ? e.message : e);
          row.values[columnId] = next;
          row.version += 1;
          row.updatedAt = new Date().toISOString();
        } else {
          pgErr(e, "Could not update cell in Postgres");
        }
      }
    } else {
      row.values[columnId] = next;
      row.version += 1;
      row.updatedAt = new Date().toISOString();
    }
    scheduleTargetPersist();
    return row;
  },

  async deleteRow(databaseId: string, tableId: string, rowId: string, expectedVersion: number): Promise<void> {
    // Refresh from PG so row ids stay aligned after rebuild / external writes
    if (isTargetPgEnabled()) {
      await this.syncTableFromPg(databaseId, tableId).catch(() => {});
    }
    const rows = rowsByTable.get(tableId) ?? [];
    // Match by row.id, or by system `id` column value (same uuid after stable list)
    let idx = rows.findIndex((r) => r.id === rowId);
    if (idx < 0) {
      const table = dbTables(databaseId).get(tableId);
      const idCol = table?.columns.find((c) => c.name.toLowerCase() === "id");
      if (idCol) {
        idx = rows.findIndex((r) => String(r.values[idCol.id] ?? "") === rowId);
      }
    }
    if (idx < 0) {
      // Row may already be gone in PG — treat as success (idempotent delete)
      const tableMeta = dbTables(databaseId).get(tableId);
      const code = pgCode(databaseId);
      if (tableMeta && code) {
        try {
          await pgDeleteRow(code, tableMeta.name, rowId, expectedVersion);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    // Version mismatch: still try delete against PG by id (workspace recovery)
    const doomed = rows[idx]!;
    enforceDeleteRestrict(databaseId, tableId, doomed);
    const tableMeta = dbTables(databaseId).get(tableId);
    if (tableMeta) {
      const code = pgCode(databaseId);
      if (code) {
        try {
          const ok = await pgDeleteRow(code, tableMeta.name, doomed.id, doomed.version);
          if (!ok) {
            // Try with the client-provided id in case memory id differs
            await pgDeleteRow(code, tableMeta.name, rowId, expectedVersion);
          }
        } catch (e) {
          if (e && typeof e === "object" && (e as { code?: string }).code === "ROW_CONFLICT") throw e;
          if (isPgUnavailable(e)) {
            console.error("[target-db] deleteRow PG unavailable — memory only", e instanceof Error ? e.message : e);
          } else {
            pgErr(e, "Could not delete row in Postgres");
          }
        }
      }
    }
    rows.splice(idx, 1);
    scheduleTargetPersist();
  },

  /** Wipe all tables for a database (on delete) */
  wipeDatabase(databaseId: string): void {
    const m = tables.get(databaseId);
    if (m) {
      for (const id of m.keys()) rowsByTable.delete(id);
      tables.delete(databaseId);
    }
    tableNames.delete(databaseId);
    foreignKeysByDb.delete(databaseId);
    indexesByDb.delete(databaseId);
    checksByDb.delete(databaseId);
    scheduleTargetPersist();
  },

  /** Schema extras for ER / constraints UI */
  listSchemaExtras(databaseId: string): SchemaExtras {
    return {
      foreignKeys: [...fksOf(databaseId)],
      indexes: [...idxsOf(databaseId)],
      checks: [...checksOf(databaseId)],
    };
  },

  addForeignKey(input: {
    databaseId: string;
    name: string;
    tableId: string;
    columnId: string;
    refTableId: string;
    refColumnId: string;
    onDelete?: FkOnDelete;
  }): ForeignKeyMeta {
    const table = dbTables(input.databaseId).get(input.tableId);
    const ref = dbTables(input.databaseId).get(input.refTableId);
    if (!table || !ref) throw err("VALIDATION_FAILED", "Table not found");
    const col = table.columns.find((c) => c.id === input.columnId);
    const refCol = ref.columns.find((c) => c.id === input.refColumnId);
    if (!col || !refCol) throw err("VALIDATION_FAILED", "Column not found");
    if (col.dataType !== refCol.dataType) {
      throw err("VALIDATION_FAILED", "FK column types must match");
    }
    const name = input.name.trim() || `fk_${table.name}_${col.name}`;
    if (fksOf(input.databaseId).some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      throw err("VALIDATION_FAILED", "FK name already exists");
    }
    // Validate existing rows
    const rows = rowsByTable.get(input.tableId) ?? [];
    const refRows = rowsByTable.get(input.refTableId) ?? [];
    for (const r of rows) {
      const v = r.values[input.columnId];
      if (v === null || v === undefined) continue;
      if (!refRows.some((rr) => rr.values[input.refColumnId] === v)) {
        throw err("CONSTRAINT_VIOLATION", "Existing data violates this foreign key");
      }
    }
    const fk: ForeignKeyMeta = {
      id: uuid(),
      name,
      databaseId: input.databaseId,
      tableId: input.tableId,
      columnId: input.columnId,
      refTableId: input.refTableId,
      refColumnId: input.refColumnId,
      onDelete: input.onDelete ?? "restrict",
      createdAt: new Date().toISOString(),
    };
    fksOf(input.databaseId).push(fk);
    scheduleTargetPersist();
    return fk;
  },

  dropForeignKey(databaseId: string, fkId: string): void {
    const list = fksOf(databaseId);
    const i = list.findIndex((f) => f.id === fkId);
    if (i < 0) throw err("VALIDATION_FAILED", "Foreign key not found");
    list.splice(i, 1);
    scheduleTargetPersist();
  },

  addIndex(input: {
    databaseId: string;
    name: string;
    tableId: string;
    columnIds: string[];
    unique?: boolean;
  }): IndexMeta {
    const table = dbTables(input.databaseId).get(input.tableId);
    if (!table) throw err("VALIDATION_FAILED", "Table not found");
    if (!input.columnIds.length) throw err("VALIDATION_FAILED", "Select at least one column");
    for (const cid of input.columnIds) {
      if (!table.columns.some((c) => c.id === cid)) {
        throw err("VALIDATION_FAILED", "Column not found");
      }
    }
    const name = input.name.trim() || `idx_${table.name}_${input.columnIds.length}`;
    if (idxsOf(input.databaseId).some((x) => x.name.toLowerCase() === name.toLowerCase())) {
      throw err("VALIDATION_FAILED", "Index name already exists");
    }
    if (input.unique) {
      const rows = rowsByTable.get(input.tableId) ?? [];
      const seen = new Set<string>();
      for (const r of rows) {
        const key = input.columnIds.map((id) => r.values[id]).join("");
        if (input.columnIds.some((id) => r.values[id] === null || r.values[id] === undefined)) continue;
        if (seen.has(key)) throw err("CONSTRAINT_VIOLATION", "Existing data violates unique index");
        seen.add(key);
      }
    }
    const ix: IndexMeta = {
      id: uuid(),
      name,
      databaseId: input.databaseId,
      tableId: input.tableId,
      columnIds: [...input.columnIds],
      unique: !!input.unique,
      createdAt: new Date().toISOString(),
    };
    idxsOf(input.databaseId).push(ix);
    scheduleTargetPersist();
    return ix;
  },

  dropIndex(databaseId: string, indexId: string): void {
    const list = idxsOf(databaseId);
    const i = list.findIndex((x) => x.id === indexId);
    if (i < 0) throw err("VALIDATION_FAILED", "Index not found");
    list.splice(i, 1);
    scheduleTargetPersist();
  },

  addCheck(input: {
    databaseId: string;
    name: string;
    tableId: string;
    columnId: string;
    op: CheckOp;
    value?: unknown;
  }): CheckConstraintMeta {
    const table = dbTables(input.databaseId).get(input.tableId);
    if (!table) throw err("VALIDATION_FAILED", "Table not found");
    if (!table.columns.some((c) => c.id === input.columnId)) {
      throw err("VALIDATION_FAILED", "Column not found");
    }
    const name = input.name.trim() || `chk_${table.name}`;
    if (checksOf(input.databaseId).some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      throw err("VALIDATION_FAILED", "Check name already exists");
    }
    const ck: CheckConstraintMeta = {
      id: uuid(),
      name,
      databaseId: input.databaseId,
      tableId: input.tableId,
      columnId: input.columnId,
      op: input.op,
      value: input.value,
      createdAt: new Date().toISOString(),
    };
    // Validate existing
    const rows = rowsByTable.get(input.tableId) ?? [];
    for (const r of rows) {
      try {
        enforceChecks(input.databaseId, input.tableId, r.values);
      } catch {
        // re-run only this check by temporarily adding then rolling back is complex —
        // validate only the new check
        const v = r.values[input.columnId];
        if (input.op === "not_null" && (v === null || v === undefined)) {
          throw err("CONSTRAINT_VIOLATION", "Existing data violates this check");
        }
        if (input.op === "eq" && v !== input.value) {
          throw err("CONSTRAINT_VIOLATION", "Existing data violates this check");
        }
        if (input.op === "neq" && v === input.value) {
          throw err("CONSTRAINT_VIOLATION", "Existing data violates this check");
        }
        if (input.op === "gt" && !(typeof v === "number" && v > Number(input.value))) {
          throw err("CONSTRAINT_VIOLATION", "Existing data violates this check");
        }
        if (input.op === "gte" && !(typeof v === "number" && v >= Number(input.value))) {
          throw err("CONSTRAINT_VIOLATION", "Existing data violates this check");
        }
        if (input.op === "lt" && !(typeof v === "number" && v < Number(input.value))) {
          throw err("CONSTRAINT_VIOLATION", "Existing data violates this check");
        }
        if (input.op === "lte" && !(typeof v === "number" && v <= Number(input.value))) {
          throw err("CONSTRAINT_VIOLATION", "Existing data violates this check");
        }
      }
    }
    checksOf(input.databaseId).push(ck);
    // Reflect NOT NULL checks on the live column schema shown in workspace UI
    if (input.op === "not_null") {
      const col = table.columns.find((c) => c.id === input.columnId);
      if (col) {
        col.nullable = false;
        table.schemaVersion += 1;
        table.updatedAt = new Date().toISOString();
      }
    }
    scheduleTargetPersist();
    return ck;
  },

  dropCheck(databaseId: string, checkId: string): void {
    const list = checksOf(databaseId);
    const i = list.findIndex((c) => c.id === checkId);
    if (i < 0) throw err("VALIDATION_FAILED", "Check not found");
    const removed = list[i]!;
    list.splice(i, 1);
    // If dropping a NOT NULL check, restore nullable on the column (unless still constrained)
    if (removed.op === "not_null") {
      const table = dbTables(databaseId).get(removed.tableId);
      if (table) {
        const still = list.some(
          (c) => c.tableId === removed.tableId && c.columnId === removed.columnId && c.op === "not_null"
        );
        if (!still) {
          const col = table.columns.find((c) => c.id === removed.columnId);
          if (col && !col.isPrimaryKey) {
            col.nullable = true;
            table.schemaVersion += 1;
            table.updatedAt = new Date().toISOString();
          }
        }
      }
    }
    scheduleTargetPersist();
  },
};
