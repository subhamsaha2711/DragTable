export type AuditAction =
  | "TABLE_CREATED"
  | "TABLE_DROPPED"
  | "COLUMN_ADDED"
  | "COLUMN_DROPPED"
  | "ROW_INSERTED"
  | "CELL_UPDATED"
  | "ROW_DELETED"
  | "CSV_IMPORTED"
  | "TABLE_RENAMED"
  | "FK_ADDED"
  | "FK_DROPPED"
  | "INDEX_ADDED"
  | "INDEX_DROPPED"
  | "CHECK_ADDED"
  | "CHECK_DROPPED";

export interface AuditEntry {
  changeId: string;
  teamId: string;
  databaseId: string;
  tableId: string | null;
  tableName: string | null;
  actorUserId: string;
  actorUsername: string;
  action: AuditAction;
  summary: string;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  createdAt: string;
}

const MAX_PER_TABLE = 100;

const buckets = new Map<string, AuditEntry[]>();

function key(databaseId: string, tableId: string | null): string {
  return `${databaseId}:${tableId ?? "_db"}`;
}

function ulidLike(): string {
  const t = Date.now().toString(36).toUpperCase();
  const r = crypto.getRandomValues(new Uint8Array(8));
  let s = "";
  for (let i = 0; i < r.length; i++) s += r[i]!.toString(16).padStart(2, "0");
  return `${t}${s}`.slice(0, 26).toUpperCase();
}

export const auditLog = {
  append(input: {
    teamId: string;
    databaseId: string;
    tableId?: string | null;
    tableName?: string | null;
    actorUserId: string;
    actorUsername: string;
    action: AuditAction;
    summary: string;
    previousState?: Record<string, unknown> | null;
    newState?: Record<string, unknown> | null;
  }): AuditEntry {
    const entry: AuditEntry = {
      changeId: ulidLike(),
      teamId: input.teamId,
      databaseId: input.databaseId,
      tableId: input.tableId ?? null,
      tableName: input.tableName ?? null,
      actorUserId: input.actorUserId,
      actorUsername: input.actorUsername,
      action: input.action,
      summary: input.summary,
      previousState: input.previousState ?? null,
      newState: input.newState ?? null,
      createdAt: new Date().toISOString(),
    };
    const k = key(input.databaseId, input.tableId ?? null);
    const list = buckets.get(k) ?? [];
    list.unshift(entry);
    if (list.length > MAX_PER_TABLE) list.length = MAX_PER_TABLE;
    buckets.set(k, list);

    if (input.tableId) {
      const dk = key(input.databaseId, null);
      const dlist = buckets.get(dk) ?? [];
      dlist.unshift(entry);
      if (dlist.length > MAX_PER_TABLE) dlist.length = MAX_PER_TABLE;
      buckets.set(dk, dlist);
    }
    return entry;
  },

  list(databaseId: string, tableId?: string | null, limit = 100): AuditEntry[] {
    const list = buckets.get(key(databaseId, tableId ?? null)) ?? [];
    return list.slice(0, Math.min(limit, MAX_PER_TABLE));
  },

  wipeDatabase(databaseId: string): void {
    for (const k of [...buckets.keys()]) {
      if (k.startsWith(`${databaseId}:`)) buckets.delete(k);
    }
  },
};
