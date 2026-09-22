import pg from "pg";
import { realtimeHub } from "@dragtable/realtime";
import { getControlStore } from "@dragtable/db-control";
import { auditLog, type AuditAction } from "@dragtable/audit";
import { targetDb } from "@dragtable/target-db";
import { isTargetPgEnabled, adminUrl, rewriteDatabase, buildTargetNames } from "@dragtable/target-pg";

const { Client } = pg;

const codeToDbId = new Map<string, string>();
const dbMeta = new Map<string, { teamId: string; name: string; dbCode: string }>();
const listening = new Set<string>();

const publishTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<
  string,
  { tableName: string | null; op: string | null; command: string | null; actorRole: string | null }
>();

const DEBOUNCE_MS = 150;

function isInternalPgRole(role: string | null | undefined): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  if (r.startsWith("m_") || r.startsWith("u_")) return false;
  return true;
}

function mapExternalToAudit(
  op: string | null,
  command: string | null,
  tableLabel: string
): { action: AuditAction; summary: string; notifType: string } | null {
  const o = (op || "").toUpperCase();
  const cmd = (command || "").toUpperCase();

  if (o === "INSERT") {
    return {
      action: "ROW_INSERTED",
      summary: `Inserted row in ${tableLabel}`,
      notifType: "ROW_INSERTED",
    };
  }
  if (o === "UPDATE") {
    return {
      action: "CELL_UPDATED",
      summary: `Updated row in ${tableLabel}`,
      notifType: "CELL_UPDATED",
    };
  }
  if (o === "DELETE") {
    return {
      action: "ROW_DELETED",
      summary: `Deleted row in ${tableLabel}`,
      notifType: "ROW_DELETED",
    };
  }
  if (o === "DDL" || cmd.includes("TABLE")) {
    if (cmd.includes("DROP") && !cmd.includes("ALTER")) {
      return {
        action: "TABLE_DROPPED",
        summary: `Dropped table ${tableLabel}`,
        notifType: "TABLE_DELETED",
      };
    }
    if (cmd.includes("ALTER")) {
      return {
        action: "COLUMN_ADDED",
        summary: `Altered table ${tableLabel}`,
        notifType: "COLUMN_ADDED",
      };
    }
    return {
      action: "TABLE_CREATED",
      summary: `Created table ${tableLabel}`,
      notifType: "TABLE_CREATED",
    };
  }
  return null;
}

function resolveTable(
  databaseId: string,
  tableName: string | null
): { tableId: string | null; tableName: string | null } {
  if (!tableName) return { tableId: null, tableName: null };
  try {
    const tables = targetDb.listTables(databaseId);
    const t = tables.find((x) => x.name.toLowerCase() === tableName.toLowerCase());
    if (t) return { tableId: t.id, tableName: t.name };
  } catch {
  }
  return { tableId: null, tableName };
}

function schedulePublish(
  databaseId: string,
  tableName: string | null,
  op: string | null,
  command: string | null,
  actorRole: string | null
): void {
  pending.set(databaseId, { tableName, op, command, actorRole });
  if (publishTimers.has(databaseId)) return;
  const t = setTimeout(() => {
    publishTimers.delete(databaseId);
    const p = pending.get(databaseId) ?? {
      tableName: null,
      op: null,
      command: null,
      actorRole: null,
    };
    pending.delete(databaseId);

    const meta = dbMeta.get(databaseId);
    const tableLabel = p.tableName || "table";
    const mapped = mapExternalToAudit(p.op, p.command, tableLabel);

    const internal = isInternalPgRole(p.actorRole);

    void (async () => {
      let actorUserId = "external";
      let actorUsername = "external";
      if (!internal && p.actorRole) {
        try {
          const resolved = await getControlStore().resolvePgActor(p.actorRole);
          if (resolved) {
            actorUserId = resolved.userId;
            actorUsername = resolved.username;
          } else {
            actorUsername = p.actorRole;
          }
        } catch {
          actorUsername = p.actorRole || "external";
        }
      } else if (!internal && !p.actorRole) {
        actorUsername = "external";
      }

      if (internal) return;

      realtimeHub.publish(databaseId, {
        type: "EXTERNAL_CHANGE",
        actorUserId,
        actorUsername,
        payload: {
          source: "connection_url",
          tableName: p.tableName,
          op: p.op,
          command: p.command,
          actor: p.actorRole,
          raw: null,
        },
      });

      if (!meta || !mapped) return;

      const finish = (resolvedIn?: { tableId: string | null; tableName: string | null }) => {
        const resolved = resolvedIn ?? resolveTable(databaseId, p.tableName);
        const label = resolved.tableName || tableLabel;
        const final = mapExternalToAudit(p.op, p.command, label);
        if (!final) return;

        const entry = auditLog.append({
          teamId: meta.teamId,
          databaseId,
          tableId: resolved.tableId,
          tableName: resolved.tableName ?? label,
          actorUserId,
          actorUsername,
          action: final.action,
          summary: final.summary,
          previousState: null,
          newState: {
            source: "connection_url",
            op: p.op,
            command: p.command,
            actor: p.actorRole,
          },
        });

        realtimeHub.publish(databaseId, {
          type: final.action,
          tableId: resolved.tableId ?? undefined,
          actorUserId,
          actorUsername,
          payload: {
            changeId: entry.changeId,
            summary: final.summary,
            source: "connection_url",
          },
        });

        void getControlStore()
          .notifyTeam({
            teamId: meta.teamId,
            type: final.notifType,
            actorUserId,
            payload: {
              databaseId,
              databaseName: meta.name,
              dbCode: meta.dbCode,
              tableId: resolved.tableId,
              tableName: resolved.tableName ?? label,
              summary: `@${actorUsername} ${final.summary.charAt(0).toLowerCase()}${final.summary.slice(1)}`,
            },
          })
          .catch((e) => console.error("[pg-listen] notifyTeam", e));
      };

      const needsSync =
        (p.op || "").toUpperCase() === "DDL" ||
        (p.tableName && !resolveTable(databaseId, p.tableName).tableId);
      if (needsSync) {
        void targetDb
          .syncDatabaseFromPg(databaseId, { force: true })
          .catch(() => {})
          .finally(() => finish(resolveTable(databaseId, p.tableName)));
      } else {
        finish();
      }
    })();
    return;
  }, DEBOUNCE_MS);

  publishTimers.set(databaseId, t);
}

export function registerPgListenTarget(
  databaseId: string,
  dbCode: string,
  meta?: { teamId: string; name: string }
): void {
  const code = dbCode.toLowerCase();
  codeToDbId.set(code, databaseId);
  if (meta) {
    dbMeta.set(databaseId, {
      teamId: meta.teamId,
      name: meta.name,
      dbCode: code,
    });
  }
  void ensureListen(code);
}

async function ensureListen(dbCode: string): Promise<void> {
  if (!isTargetPgEnabled() || listening.has(dbCode)) return;
  const base = adminUrl();
  if (!base) return;
  listening.add(dbCode);
  try {
    const { database } = buildTargetNames(dbCode);
    const client = new Client({ connectionString: rewriteDatabase(base, database) });
    client.on("error", (err) => {
      console.error("[pg-listen] error", dbCode, err.message);
      listening.delete(dbCode);
    });
    client.on("end", () => {
      listening.delete(dbCode);
    });
    await client.connect();
    await client.query("LISTEN dt_change");
    client.on("notification", (msg) => {
      if (msg.channel !== "dt_change") return;
      const databaseId = codeToDbId.get(dbCode);
      if (!databaseId) return;
      let tableName: string | null = null;
      let op: string | null = null;
      let command: string | null = null;
      let actorRole: string | null = null;
      try {
        const payload = JSON.parse(msg.payload || "{}") as {
          table?: string;
          op?: string;
          command?: string;
          actor?: string;
        };
        tableName = payload.table ?? null;
        op = payload.op ?? null;
        command = payload.command ?? null;
        actorRole = payload.actor ?? null;
      } catch {
      }
      schedulePublish(databaseId, tableName, op, command, actorRole);
    });
    console.log(`[pg-listen] LISTEN dt_change on ${database}`);
  } catch (e) {
    listening.delete(dbCode);
    console.error("[pg-listen] failed", dbCode, e);
  }
}
