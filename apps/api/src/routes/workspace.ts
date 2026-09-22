import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getControlStore } from "@dragtable/db-control";
// notifyTeam used for governance alerts
import { targetDb, bindPgDatabase } from "@dragtable/target-db";
import { registerPgListenTarget } from "../lib/pg-listen.js";
import { applyMemberPgGrants, isTargetPgEnabled, pgSetTableLimit } from "@dragtable/target-pg";
import { planTableLimit } from "@dragtable/domain";

/** After schema change, refresh every member's Postgres GRANTs on this DB */
async function refreshAllMemberGrants(
  databaseId: string,
  dbCode: string,
  teamId: string,
  actorUserId: string
) {
  if (!isTargetPgEnabled()) return;
  try {
    const store = getControlStore();
    const members = await store.listMembers({ userId: actorUserId, teamId });
    for (const m of members) {
      const fullAccess = m.role === "admin";
      const permissions: string[] = Array.isArray(m.permissions) ? m.permissions : [];
      await applyMemberPgGrants({
        dbCode,
        userId: m.userId,
        permissions,
        fullAccess,
      }).catch(() => {});
    }
  } catch {
    /* non-fatal */
  }
}

import { auditLog } from "@dragtable/audit";
import { realtimeHub } from "@dragtable/realtime";
import { requireUser } from "../lib/session.js";
import { tableToCsv, buildDatabaseCsvZip } from "@dragtable/import-export";
import { recordMetricSync } from "@dragtable/analytics";
import { assertCan, type Permission } from "@dragtable/rbac";

const dataType = z.enum([
  "text",
  "integer",
  "numeric",
  "boolean",
  "date",
  "timestamp",
  "uuid",
  "jsonb",
]);

const createTableBody = z.object({
  name: z.string().min(1).max(63),
  columns: z
    .array(
      z.object({
        name: z.string().min(1).max(63),
        dataType: dataType,
        nullable: z.boolean().optional(),
        unique: z.boolean().optional(),
        isPrimaryKey: z.boolean().optional(),
      })
    )
    .min(1)
    .max(50),
});

const addColumnBody = z.object({
  name: z.string().min(1).max(63),
  dataType: dataType,
  nullable: z.boolean().optional(),
  unique: z.boolean().optional(),
});

const insertRowBody = z.object({
  values: z.record(z.unknown()),
});

const updateCellBody = z.object({
  value: z.unknown(),
  expectedVersion: z.number().int().positive(),
});

const deleteRowBody = z.object({
  expectedVersion: z.number().int().positive(),
});

const csvImportBody = z.object({
  tableName: z.string().min(1).max(63),
  csv: z.string().min(1).max(2_000_000),
});

async function authorizeDb(userId: string, databaseId: string) {
  const store = getControlStore();
  const database = await store.getDatabase({ userId, databaseId });
  if (!database) return null;
  const membership = await store.getMembership(userId, database.teamId);
  if (!membership) return null;
  // Ensure dual-write to real Postgres target is bound for this control DB id
  if (database.dbCode) {
    bindPgDatabase(database.id, database.dbCode);
    registerPgListenTarget(database.id, database.dbCode, { teamId: database.teamId, name: database.name });
    // External CREATE TABLE must obey the same plan table limit as workspace
    if (isTargetPgEnabled() && membership.planId) {
      const maxTables = planTableLimit(membership.planId as "personal" | "startup" | "enterprise");
      void pgSetTableLimit(database.dbCode, maxTables).catch((e) =>
        console.error("[workspace] pgSetTableLimit", database.dbCode, e)
      );
    }
  }
  return { database, membership };
}

/** Deny-by-default for members: only explicitly granted permissions pass. */
function requirePerm(
  membership: { role: "admin" | "member"; permissions?: string[] },
  permission: Permission
): void {
  assertCan(membership.role, membership.permissions ?? [], permission);
}

function mapErr(reply: import("fastify").FastifyReply, e: unknown) {
  const err = e as {
    code?: string;
    message?: string;
    serverVersion?: number;
    serverValue?: unknown;
  };
  if (err.code === "FORBIDDEN") {
    return reply.status(403).send({ code: "FORBIDDEN", message: err.message });
  }
  if (err.code === "TABLE_LIMIT_REACHED") {
    return reply.status(403).send({ code: "TABLE_LIMIT_REACHED", message: err.message });
  }
  if (err.code === "ROW_CONFLICT") {
    return reply.status(409).send({
      code: "ROW_CONFLICT",
      message: err.message ?? "Conflict",
      details: { serverVersion: err.serverVersion, serverValue: err.serverValue },
    });
  }
  if (err.code === "CONSTRAINT_VIOLATION") {
    return reply.status(400).send({ code: "CONSTRAINT_VIOLATION", message: err.message });
  }
  if (err.code === "VALIDATION_FAILED" || err.code === "IMPORT_INVALID") {
    return reply.status(400).send({
      code: err.code === "IMPORT_INVALID" ? "IMPORT_INVALID" : "VALIDATION_FAILED",
      message: err.message,
    });
  }
  if (err.code === "PROVISION_FAILED" || err.code === "PG_NOT_CONFIGURED") {
    return reply.status(503).send({
      code: "PROVISION_FAILED",
      message: err.message ?? "Postgres target unavailable",
    });
  }
  return null;
}

function track(
  ctx: { database: { teamId: string; id: string }; membership: { teamId: string } },
  user: { id: string; username: string },
  action: Parameters<typeof auditLog.append>[0]["action"],
  summary: string,
  extra?: {
    tableId?: string | null;
    tableName?: string | null;
    previousState?: Record<string, unknown> | null;
    newState?: Record<string, unknown> | null;
    eventType?: string;
    payload?: Record<string, unknown>;
  }
) {
  const entry = auditLog.append({
    teamId: ctx.membership.teamId,
    databaseId: ctx.database.id,
    tableId: extra?.tableId,
    tableName: extra?.tableName,
    actorUserId: user.id,
    actorUsername: user.username,
    action,
    summary,
    previousState: extra?.previousState,
    newState: extra?.newState,
  });
  realtimeHub.publish(ctx.database.id, {
    type: extra?.eventType ?? action,
    tableId: extra?.tableId ?? undefined,
    actorUserId: user.id,
    actorUsername: user.username,
    payload: {
      changeId: entry.changeId,
      summary,
      ...(extra?.payload ?? {}),
    },
  });
  return entry;
}

/** Minimal CSV parse: header row + values, comma-separated, no quoted multiline */
function parseCsv(csv: string): { headers: string[]; rows: string[][] } {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 1) throw Object.assign(new Error("CSV is empty"), { code: "IMPORT_INVALID" });
  const split = (line: string) => {
    const cells: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        cells.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  };
  const headers = split(lines[0]!).map((h) => h.replace(/^\uFEFF/, ""));
  if (headers.length === 0 || headers.some((h) => !h)) {
    throw Object.assign(new Error("Invalid or empty headers"), { code: "IMPORT_INVALID" });
  }
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

function inferType(values: string[]): "boolean" | "integer" | "numeric" | "text" {
  const nonEmpty = values.filter((v) => v !== "");
  if (nonEmpty.length === 0) return "text";
  if (nonEmpty.every((v) => /^(true|false)$/i.test(v))) return "boolean";
  if (nonEmpty.every((v) => /^-?\d+$/.test(v))) return "integer";
  if (nonEmpty.every((v) => /^-?\d+(\.\d+)?$/.test(v))) return "numeric";
  return "text";
}

const workspaceRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/databases/:databaseId/tables", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId } = req.params as { databaseId: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    // Opening the workspace shell is allowed for any team member (membership only).
    // Mutations / data reads still require explicit grants via requirePerm on those routes.
    const q = req.query as { poll?: string };
    const isPoll = q.poll === "1" || q.poll === "true";
    const t0 = Date.now();
    await targetDb.syncDatabaseFromPg(databaseId, { force: true });
    const tables = targetDb.listTables(databaseId);
    if (!isPoll) recordMetricSync(databaseId, "read", t0);
    return {
      tables,
      database: ctx.database,
      role: ctx.membership.role,
      permissions: ctx.membership.permissions ?? [],
      liveViewers: realtimeHub.subscriberCount(databaseId),
    };
  });

  app.post("/api/v1/databases/:databaseId/tables", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId } = req.params as { databaseId: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    try { requirePerm(ctx.membership, "table.create"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
    const parsed = createTableBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "VALIDATION_FAILED", message: "Invalid table definition" });
    }
    try {
      const started = Date.now();
      const table = await targetDb.createTable({
        databaseId,
        name: parsed.data.name,
        columns: parsed.data.columns,
        planId: ctx.membership.planId,
      });
      track(ctx, session.user, "TABLE_CREATED", `Created table ${table.name}`, {
        tableId: table.id,
        tableName: table.name,
        newState: { name: table.name, columns: table.columns.map((c) => c.name) },
        eventType: "TABLE_CREATED",
        payload: { table },
      });
      recordMetricSync(databaseId, "write", started);
      return { table };
    } catch (e) {
      const mapped = mapErr(reply, e);
      if (mapped) return mapped;
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not create table" });
    }
  });


  app.patch("/api/v1/databases/:databaseId/tables/:tableId", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId, tableId } = req.params as { databaseId: string; tableId: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    try { requirePerm(ctx.membership, "table.rename"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
    const body = z.object({ name: z.string().min(1).max(63) }).safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ code: "VALIDATION_FAILED", message: "Invalid name" });
    }
    try {
      const t0 = Date.now();
      const before = targetDb.getTable(databaseId, tableId);
      const table = await targetDb.renameTable(databaseId, tableId, body.data.name);
      track(ctx, session.user, "TABLE_RENAMED", `Renamed table ${before?.name} → ${table.name}`, {
        tableId,
        tableName: table.name,
        previousState: { name: before?.name },
        newState: { name: table.name },
        eventType: "TABLE_RENAMED",
        payload: { table },
      });
      return { table };
    } catch (e) {
      const mapped = mapErr(reply, e);
      if (mapped) return mapped;
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not rename table" });
    }
  });

  app.delete("/api/v1/databases/:databaseId/tables/:tableId", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId, tableId } = req.params as { databaseId: string; tableId: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    try { requirePerm(ctx.membership, "table.delete"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
    try {
      const existing = targetDb.getTable(databaseId, tableId);
      await targetDb.dropTable(databaseId, tableId);
      track(ctx, session.user, "TABLE_DROPPED", `Dropped table ${existing?.name ?? tableId}`, {
        tableId,
        tableName: existing?.name,
        previousState: existing ? { name: existing.name } : null,
        eventType: "TABLE_DROPPED",
        payload: { tableId },
      });
      await getControlStore().notifyTeam({
        teamId: ctx.membership.teamId,
        type: "TABLE_DELETED",
        actorUserId: session.user.id,
        payload: {
          databaseId,
          tableId,
          tableName: existing?.name ?? null,
          summary: `@${session.user.username} deleted table ${existing?.name ?? tableId}`,
        },
      });
      return { ok: true };
    } catch (e) {
      const mapped = mapErr(reply, e);
      if (mapped) return mapped;
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not drop table" });
    }
  });

  app.post("/api/v1/databases/:databaseId/tables/:tableId/columns", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId, tableId } = req.params as { databaseId: string; tableId: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    try { requirePerm(ctx.membership, "table.edit_schema"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
    const parsed = addColumnBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "VALIDATION_FAILED", message: "Invalid column" });
    }
    try {
      const table = await targetDb.addColumn(databaseId, tableId, parsed.data);
      track(ctx, session.user, "COLUMN_ADDED", `Added column ${parsed.data.name}`, {
        tableId,
        tableName: table.name,
        newState: { column: parsed.data.name, dataType: parsed.data.dataType },
        eventType: "COLUMN_ADDED",
        payload: { table },
      });
      return { table };
    } catch (e) {
      const mapped = mapErr(reply, e);
      if (mapped) return mapped;
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not add column" });
    }
  });

  app.delete(
    "/api/v1/databases/:databaseId/tables/:tableId/columns/:columnId",
    async (req, reply) => {
      const session = await requireUser(req, reply);
      if (!session || "statusCode" in session) return;
      const { databaseId, tableId, columnId } = req.params as {
        databaseId: string;
        tableId: string;
        columnId: string;
      };
      const ctx = await authorizeDb(session.user.id, databaseId);
      if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
      try { requirePerm(ctx.membership, "table.edit_schema"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
      try {
        const before = targetDb.getTable(databaseId, tableId);
        const colName = before?.columns.find((c) => c.id === columnId)?.name;
        const table = await targetDb.dropColumn(databaseId, tableId, columnId);
        track(ctx, session.user, "COLUMN_DROPPED", `Dropped column ${colName ?? columnId}`, {
          tableId,
          tableName: table.name,
          previousState: { columnId, name: colName },
          eventType: "COLUMN_DROPPED",
          payload: { table },
        });
        return { table };
      } catch (e) {
        const mapped = mapErr(reply, e);
        if (mapped) return mapped;
        return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not drop column" });
      }
    }
  );

  app.get("/api/v1/databases/:databaseId/tables/:tableId/rows", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId, tableId } = req.params as { databaseId: string; tableId: string };
    const q = req.query as { limit?: string; offset?: string; poll?: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    try { requirePerm(ctx.membership, "data.read"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
    try {
      const isPoll = q.poll === "1" || q.poll === "true";
      const t0 = Date.now();
      // Prefer real Postgres as source of truth so external IDE writes appear live
      const snap = await targetDb.listRows(databaseId, tableId, {
        limit: q.limit ? Number(q.limit) : 100,
        offset: q.offset ? Number(q.offset) : 0,
      });
      if (!isPoll) recordMetricSync(databaseId, "read", t0);
      return snap;
    } catch (e) {
      const mapped = mapErr(reply, e);
      if (mapped) return mapped;
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not load rows" });
    }
  });

  app.post("/api/v1/databases/:databaseId/tables/:tableId/rows", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId, tableId } = req.params as { databaseId: string; tableId: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    try { requirePerm(ctx.membership, "data.insert"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
    const parsed = insertRowBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "VALIDATION_FAILED", message: "Invalid row" });
    }
    try {
      const t0 = Date.now();
      const table = targetDb.getTable(databaseId, tableId);
      const row = await targetDb.insertRow(databaseId, tableId, parsed.data.values);
      track(ctx, session.user, "ROW_INSERTED", `Inserted row in ${table?.name ?? "table"}`, {
        tableId,
        tableName: table?.name,
        newState: { rowId: row.id },
        eventType: "ROW_INSERTED",
        payload: { row, tableId },
      });
      recordMetricSync(databaseId, "write", t0);
      return { row };
    } catch (e) {
      const mapped = mapErr(reply, e);
      if (mapped) return mapped;
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not insert row" });
    }
  });

  app.patch(
    "/api/v1/databases/:databaseId/tables/:tableId/rows/:rowId/cells/:columnId",
    async (req, reply) => {
      const session = await requireUser(req, reply);
      if (!session || "statusCode" in session) return;
      const { databaseId, tableId, rowId, columnId } = req.params as {
        databaseId: string;
        tableId: string;
        rowId: string;
        columnId: string;
      };
      const ctx = await authorizeDb(session.user.id, databaseId);
      if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
      try { requirePerm(ctx.membership, "data.update"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
      const parsed = updateCellBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ code: "VALIDATION_FAILED", message: "Invalid cell update" });
      }
      try {
        const t0 = Date.now();
        const table = targetDb.getTable(databaseId, tableId);
        const col = table?.columns.find((c) => c.id === columnId);
        const snap = await targetDb.listRows(databaseId, tableId, { limit: 500 });
        const before = snap.rows.find((r) => r.id === rowId);
        const oldVal = before?.values[columnId];
        const row = await targetDb.updateCell(
          databaseId,
          tableId,
          rowId,
          columnId,
          parsed.data.value,
          parsed.data.expectedVersion
        );
        track(ctx, session.user, "CELL_UPDATED", `Updated ${col?.name ?? "cell"} in ${table?.name}`, {
          tableId,
          tableName: table?.name,
          previousState: { value: oldVal },
          newState: { value: row.values[columnId], rowId, columnId },
          eventType: "CELL_UPDATED",
          payload: { row, tableId, columnId },
        });
        recordMetricSync(databaseId, "write", t0);
        return { row };
      } catch (e) {
        const mapped = mapErr(reply, e);
        if (mapped) return mapped;
        return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not update cell" });
      }
    }
  );

  app.post(
    "/api/v1/databases/:databaseId/tables/:tableId/rows/:rowId/delete",
    async (req, reply) => {
      const session = await requireUser(req, reply);
      if (!session || "statusCode" in session) return;
      const { databaseId, tableId, rowId } = req.params as {
        databaseId: string;
        tableId: string;
        rowId: string;
      };
      const ctx = await authorizeDb(session.user.id, databaseId);
      if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
      try { requirePerm(ctx.membership, "data.delete"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
      const parsed = deleteRowBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ code: "VALIDATION_FAILED", message: "expectedVersion required" });
      }
      try {
        const t0 = Date.now();
        const table = targetDb.getTable(databaseId, tableId);
        await targetDb.deleteRow(databaseId, tableId, rowId, parsed.data.expectedVersion);
        track(ctx, session.user, "ROW_DELETED", `Deleted row in ${table?.name ?? "table"}`, {
          tableId,
          tableName: table?.name,
          previousState: { rowId },
          eventType: "ROW_DELETED",
          payload: { rowId, tableId },
        });
        recordMetricSync(databaseId, "write", t0);
        return { ok: true };
      } catch (e) {
        const mapped = mapErr(reply, e);
        if (mapped) return mapped;
        return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not delete row" });
      }
    }
  );

  /** Audit history — last 100 (table or database-wide) */
  app.get("/api/v1/databases/:databaseId/audit", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId } = req.params as { databaseId: string };
    const q = req.query as { tableId?: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    try { requirePerm(ctx.membership, "audit.read"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
    const isPoll =
      (req.query as { poll?: string }).poll === "1" ||
      (req.query as { poll?: string }).poll === "true";
    const t0 = Date.now();
    const entries = auditLog.list(databaseId, q.tableId ?? null);
    if (!isPoll) recordMetricSync(databaseId, "read", t0);
    return { entries };
  });

  /** CSV import into a new empty table (auto types) */
  app.post("/api/v1/databases/:databaseId/import-csv", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId } = req.params as { databaseId: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    try { requirePerm(ctx.membership, "csv.import"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
    const parsed = csvImportBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "IMPORT_INVALID", message: "Invalid import payload" });
    }
    try {
      const t0 = Date.now();
      const { headers, rows } = parseCsv(parsed.data.csv);
      if (rows.length > 5000) {
        return reply.status(400).send({
          code: "IMPORT_TOO_LARGE",
          message: "Max 5000 data rows per import in hackathon build",
        });
      }
      // Sanitize headers; never force a second "id" if CSV already has one
      const usedNames = new Set<string>();
      const sanitizedHeaders: string[] = [];
      for (let i = 0; i < headers.length; i++) {
        let name =
          headers[i]!.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^(\d)/, "_$1") || `col_${i}`;
        const base = name;
        let n = 2;
        while (usedNames.has(name.toLowerCase())) {
          name = `${base}_${n++}`;
        }
        usedNames.add(name.toLowerCase());
        sanitizedHeaders.push(name);
      }

      const hasIdCol = sanitizedHeaders.some((h) => h.toLowerCase() === "id");
      const columns = sanitizedHeaders.map((name, i) => {
        const colValues = rows.map((r) => r[i] ?? "");
        const isId = name.toLowerCase() === "id";
        if (isId) {
          // CSV already provides id — use as single PK (uuid when values look like UUIDs)
          const uuidish = colValues.every(
            (v) =>
              !v ||
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                String(v).trim()
              )
          );
          return {
            name: "id",
            dataType: (uuidish ? "uuid" : "text") as "uuid" | "text",
            nullable: false,
            unique: true,
            isPrimaryKey: true,
          };
        }
        return {
          name,
          dataType: inferType(colValues) as "text" | "integer" | "numeric" | "boolean",
          nullable: true,
          unique: false,
          isPrimaryKey: false,
        };
      });

      // If CSV has no id/PK, createTable auto-adds uuid id — do NOT prepend another id here
      const table = await targetDb.createTable({
        databaseId,
        name: parsed.data.tableName,
        columns,
        planId: ctx.membership.planId,
      });

      // Map sanitized header index → table column (by name)
      const colByHeaderIdx: Array<{ colId: string; name: string } | null> = sanitizedHeaders.map(
        (h) => {
          const col = table.columns.find((c) => c.name.toLowerCase() === h.toLowerCase());
          return col ? { colId: col.id, name: col.name } : null;
        }
      );

      let imported = 0;
      let skipped = 0;
      const rowErrors: Array<{ row: number; message: string }> = [];
      for (let ri = 0; ri < rows.length; ri++) {
        const r = rows[ri]!;
        try {
          const values: Record<string, unknown> = {};
          colByHeaderIdx.forEach((map, di) => {
            if (!map) return;
            values[map.colId] = r[di] ?? "";
          });
          // Synthetic PK (auto id) is filled inside insertRow when missing
          await targetDb.insertRow(databaseId, table.id, values);
          imported++;
        } catch (rowErr: unknown) {
          skipped++;
          const msg = (rowErr as { message?: string }).message ?? "Invalid row";
          if (rowErrors.length < 20) rowErrors.push({ row: ri + 2, message: msg });
        }
      }
      if (imported === 0) {
        // roll back empty table
        try {
          await targetDb.dropTable(databaseId, table.id);
        } catch { /* ignore */ }
        return reply.status(400).send({
          code: "IMPORT_ALL_INVALID",
          message: "All rows failed validation — nothing was imported",
          details: { skipped, errors: rowErrors },
        });
      }
      track(ctx, session.user, "CSV_IMPORTED", `Imported ${imported} rows into ${table.name} (${skipped} skipped)`, {
        tableId: table.id,
        tableName: table.name,
        newState: { rows: imported, skipped, columns: columns.map((c) => c.name) },
        eventType: "CSV_IMPORTED",
        payload: { table, imported, skipped },
      });
      recordMetricSync(databaseId, "write", t0);
      return { table, imported, skipped, errors: rowErrors };
    } catch (e) {
      const mapped = mapErr(reply, e);
      if (mapped) return mapped;
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Import failed" });
    }
  });

  /** Export one table as pure CSV */
  app.get("/api/v1/databases/:databaseId/tables/:tableId/export.csv", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId, tableId } = req.params as { databaseId: string; tableId: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    try { requirePerm(ctx.membership, "csv.export"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
    try {
      if (isTargetPgEnabled()) {
        await targetDb.syncDatabaseFromPg(databaseId, { force: true }).catch(() => {});
      }
      const snap = await targetDb.listAllRows(databaseId, tableId);
      const csv = tableToCsv(snap.table, snap.rows);
      const safeName = snap.table.name.replace(/[^a-zA-Z0-9._-]+/g, "_") || "table";
      const filename = `${safeName}.csv`;
      // Buffer so Fastify does not JSON-encode the string
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(Buffer.from(csv, "utf8"));
    } catch (e) {
      const mapped = mapErr(reply, e);
      if (mapped) return mapped;
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Export failed" });
    }
  });

  /** Full database export = ZIP of pure CSV files (one per table) */
  app.get("/api/v1/databases/:databaseId/export", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId } = req.params as { databaseId: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    try { requirePerm(ctx.membership, "csv.export"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
    try {
      if (isTargetPgEnabled()) {
        await targetDb.syncDatabaseFromPg(databaseId, { force: true }).catch(() => {});
      }
      const tables = targetDb.listTables(databaseId);
      const rowsByTableId = new Map();
      for (const table of tables) {
        const snap = await targetDb.listAllRows(databaseId, table.id);
        rowsByTableId.set(table.id, snap.rows);
      }
      const zip = buildDatabaseCsvZip({ tables, rowsByTableId });
      const filename = `dragtable-${ctx.database.dbCode}-export.zip`;
      return reply
        .header("Content-Type", "application/zip")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(zip);
    } catch (e) {
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Export failed" });
    }
  });

  /** Schema extras: FKs, indexes, checks (for ER + integrity) */
  app.get("/api/v1/databases/:databaseId/schema-extras", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId } = req.params as { databaseId: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    // Schema diagram shell: membership only; edits still gated on mutation routes
    return {
      ...targetDb.listSchemaExtras(databaseId),
      tables: targetDb.listTables(databaseId).map((tb) => ({
        id: tb.id,
        name: tb.name,
        columns: tb.columns.map((c) => ({
          id: c.id,
          name: c.name,
          dataType: c.dataType,
          isPrimaryKey: c.isPrimaryKey,
        })),
      })),
    };
  });

  app.post("/api/v1/databases/:databaseId/foreign-keys", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId } = req.params as { databaseId: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    try { requirePerm(ctx.membership, "relation.manage"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
    const body = z
      .object({
        name: z.string().min(1).max(63).optional(),
        tableId: z.string().uuid(),
        columnId: z.string().uuid(),
        refTableId: z.string().uuid(),
        refColumnId: z.string().uuid(),
        onDelete: z.enum(["restrict", "cascade", "set_null"]).optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ code: "VALIDATION_FAILED", message: "Invalid FK payload" });
    }
    try {
      const t0 = Date.now();
      const fk = targetDb.addForeignKey({ databaseId, ...body.data, name: body.data.name ?? "" });
      track(ctx, session.user, "FK_ADDED", `Added FK ${fk.name}`, {
        tableId: fk.tableId,
        eventType: "FK_ADDED",
        payload: { fk },
      });
      recordMetricSync(databaseId, "write", t0);
      return { foreignKey: fk };
    } catch (e) {
      const mapped = mapErr(reply, e);
      if (mapped) return mapped;
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not add foreign key" });
    }
  });

  app.delete("/api/v1/databases/:databaseId/foreign-keys/:fkId", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId, fkId } = req.params as { databaseId: string; fkId: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    try { requirePerm(ctx.membership, "relation.manage"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
    try {
      targetDb.dropForeignKey(databaseId, fkId);
      track(ctx, session.user, "FK_DROPPED", `Dropped FK`, {
        eventType: "FK_DROPPED",
        payload: { fkId },
      });
      return { ok: true };
    } catch (e) {
      const mapped = mapErr(reply, e);
      if (mapped) return mapped;
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not drop FK" });
    }
  });

  app.post("/api/v1/databases/:databaseId/indexes", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId } = req.params as { databaseId: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    try { requirePerm(ctx.membership, "constraint.manage"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
    const body = z
      .object({
        name: z.string().min(1).max(63).optional(),
        tableId: z.string().uuid(),
        columnIds: z.array(z.string().uuid()).min(1),
        unique: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ code: "VALIDATION_FAILED", message: "Invalid index payload" });
    }
    try {
      const index = targetDb.addIndex({
        databaseId,
        name: body.data.name ?? "",
        tableId: body.data.tableId,
        columnIds: body.data.columnIds,
        unique: body.data.unique,
      });
      track(ctx, session.user, "INDEX_ADDED", `Added index ${index.name}`, {
        tableId: index.tableId,
        eventType: "INDEX_ADDED",
        payload: { index },
      });
      return { index };
    } catch (e) {
      const mapped = mapErr(reply, e);
      if (mapped) return mapped;
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not add index" });
    }
  });

  app.delete("/api/v1/databases/:databaseId/indexes/:indexId", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId, indexId } = req.params as { databaseId: string; indexId: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    try { requirePerm(ctx.membership, "constraint.manage"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
    try {
      const before = targetDb.listSchemaExtras(databaseId).indexes.find((x) => x.id === indexId);
      targetDb.dropIndex(databaseId, indexId);
      track(ctx, session.user, "INDEX_DROPPED", `Dropped index ${before?.name ?? indexId}`, {
        tableId: before?.tableId,
        tableName: before
          ? targetDb.listTables(databaseId).find((t) => t.id === before.tableId)?.name
          : null,
        previousState: before ? { indexId, name: before.name } : { indexId },
        eventType: "INDEX_DROPPED",
        payload: { indexId },
      });
      return { ok: true };
    } catch (e) {
      const mapped = mapErr(reply, e);
      if (mapped) return mapped;
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not drop index" });
    }
  });

  app.post("/api/v1/databases/:databaseId/checks", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId } = req.params as { databaseId: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    try { requirePerm(ctx.membership, "constraint.manage"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
    const body = z
      .object({
        name: z.string().min(1).max(63).optional(),
        tableId: z.string().uuid(),
        columnId: z.string().uuid(),
        op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "not_null"]),
        value: z.unknown().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ code: "VALIDATION_FAILED", message: "Invalid check payload" });
    }
    try {
      const check = targetDb.addCheck({
        databaseId,
        name: body.data.name ?? "",
        tableId: body.data.tableId,
        columnId: body.data.columnId,
        op: body.data.op,
        value: body.data.value,
      });
      track(ctx, session.user, "CHECK_ADDED", `Added check ${check.name}`, {
        tableId: check.tableId,
        eventType: "CHECK_ADDED",
        payload: { check },
      });
      return { check };
    } catch (e) {
      const mapped = mapErr(reply, e);
      if (mapped) return mapped;
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not add check" });
    }
  });

  app.delete("/api/v1/databases/:databaseId/checks/:checkId", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId, checkId } = req.params as { databaseId: string; checkId: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    try { requirePerm(ctx.membership, "constraint.manage"); } catch (e) { return mapErr(reply, e) ?? reply.status(403).send({ code: "FORBIDDEN", message: "Permission denied" }); }
    try {
      const before = targetDb.listSchemaExtras(databaseId).checks.find((x) => x.id === checkId);
      targetDb.dropCheck(databaseId, checkId);
      track(ctx, session.user, "CHECK_DROPPED", `Dropped check ${before?.name ?? checkId}`, {
        tableId: before?.tableId,
        tableName: before
          ? targetDb.listTables(databaseId).find((t) => t.id === before.tableId)?.name
          : null,
        previousState: before ? { checkId, name: before.name } : { checkId },
        eventType: "CHECK_DROPPED",
        payload: { checkId },
      });
      return { ok: true };
    } catch (e) {
      const mapped = mapErr(reply, e);
      if (mapped) return mapped;
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not drop check" });
    }
  });

};

export default workspaceRoutes;
