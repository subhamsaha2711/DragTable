/**
 * Prefer explicit env; otherwise same host as the page on port 3001.
 * Fixes LAN access (http://192.168.x.x:3000 → API on :3001 of same host).
 */
export function getApiBase(): string {
  if (typeof window !== "undefined") {
    const env = process.env.NEXT_PUBLIC_API_URL?.trim();

    if (env) {
      return env.replace(/\/$/, "");
    }

    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }

  return (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001")
    .replace(/\/$/, "");
}

export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export type PublicDatabase = {
  id: string;
  dbCode: string;
  teamId: string;
  name: string;
  status: string;
  schemaVersion: number;
  createdAt: string;
  authKeyHint?: string;
};

export type DataType =
  | "text"
  | "integer"
  | "numeric"
  | "boolean"
  | "date"
  | "timestamp"
  | "uuid"
  | "jsonb";

export type ColumnMeta = {
  id: string;
  name: string;
  dataType: DataType;
  nullable: boolean;
  unique: boolean;
  isPrimaryKey: boolean;
  position: number;
};

export type TableMeta = {
  id: string;
  databaseId: string;
  name: string;
  schemaVersion: number;
  columns: ColumnMeta[];
  createdAt: string;
  updatedAt: string;
};

export type AuditEntry = {
  changeId: string;
  teamId: string;
  databaseId: string;
  tableId: string | null;
  tableName: string | null;
  actorUserId: string;
  actorUsername: string;
  action: string;
  summary: string;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  createdAt: string;
};

export type RowRecord = {
  id: string;
  version: number;
  values: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ data?: T; error?: ApiError; status: number }> {
  const base = getApiBase();
  try {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) ?? {}),
    };
    // Fastify rejects empty body + application/json (DELETE/GET without body)
    if (options.body != null && options.body !== "") {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    }
    const res = await fetch(`${base}${path}`, {
      ...options,
      credentials: "include",
      headers,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        status: res.status,
        error: {
          code: body.code ?? "INTERNAL_ERROR",
          message: body.message ?? res.statusText,
          details: body.details,
        },
      };
    }
    return { status: res.status, data: body as T };
  } catch {
    return {
      status: 0,
      error: {
        code: "NETWORK_ERROR",
        message: `Cannot reach API at ${base} — start it with: npm run dev -w @dragtable/api`,
      },
    };
  }
}

export const api = {
  createTeam(body: {
    name: string;
    email: string;
    password: string;
    teamName: string;
    planId: "personal" | "startup" | "enterprise";
  }) {
    return request<{
      user: { id: string; username: string; email: string; name: string };
      team: { id: string; teamCode: string; name: string; planId: string };
    }>("/api/v1/auth/create-team", { method: "POST", body: JSON.stringify(body) });
  },

  signIn(body: { email: string; password: string }) {
    return request<{
      user: { id: string; username: string; email: string; name: string };
      teams: Array<{ id: string; teamCode: string; name: string; planId: string; role: string }>;
    }>("/api/v1/auth/signin", { method: "POST", body: JSON.stringify(body) });
  },

  signOut() {
    return request<{ ok: boolean }>("/api/v1/auth/signout", { method: "POST" });
  },

  me() {
    return request<{
      user: { id: string; username: string; email: string; name: string };
      teams: Array<{ id: string; teamCode: string; name: string; planId: string; role: string }>;
      store: string;
    }>("/api/v1/auth/me");
  },

  joinTeam(teamCode: string) {
    return request<{
      team: { id: string; teamCode: string; name: string; planId: string };
      role: string;
    }>("/api/v1/teams/join", { method: "POST", body: JSON.stringify({ teamCode }) });
  },

  createApiToken(name?: string) {
    return request<{ token: string; id: string; hint: string; name: string }>(
      "/api/v1/auth/api-tokens",
      { method: "POST", body: JSON.stringify({ name: name || "default" }) }
    );
  },

  listApiTokens() {
    return request<{ tokens: Array<{ id: string; name: string; hint: string; createdAt: string }> }>(
      "/api/v1/auth/api-tokens"
    );
  },

  revokeApiToken(tokenId: string) {
    return request<{ ok: boolean }>(`/api/v1/auth/api-tokens/${tokenId}`, { method: "DELETE" });
  },

  updateProfile(name: string) {
    return request<{ user: { id: string; username: string; email: string; name: string } }>(
      "/api/v1/auth/profile",
      { method: "PUT", body: JSON.stringify({ name }) }
    );
  },

  changePassword(currentPassword: string, newPassword: string) {
    return request<{ ok: boolean }>("/api/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  registerAndJoin(body: {
    name: string;
    email: string;
    password: string;
    teamCode: string;
  }) {
    return request<{
      user: { id: string; username: string; email: string; name: string };
      team: { id: string; teamCode: string; name: string; planId: string };
      role: string;
    }>("/api/v1/auth/register-and-join", { method: "POST", body: JSON.stringify(body) });
  },

  listDatabases(teamId: string) {
    return request<{ databases: PublicDatabase[] }>(`/api/v1/teams/${teamId}/databases`);
  },

  createDatabase(teamId: string, name: string) {
    return request<{
      database: PublicDatabase;
      authKey: string;
      connectionUrl: string;
      host: string;
      port: string;
      pgDatabase: string;
      pgUser: string;
      apiBase: string;
    }>(
      `/api/v1/teams/${teamId}/databases`,
      { method: "POST", body: JSON.stringify({ name }) }
    );
  },

  getDatabase(databaseId: string) {
    return request<{ database: PublicDatabase }>(`/api/v1/databases/${databaseId}`);
  },

  rotateKey(databaseId: string) {
    return request<{
      authKey: string;
      authKeyHint: string;
      connectionUrl: string;
      host: string;
      port: string;
      pgDatabase: string;
      pgUser: string;
      apiBase: string;
    }>(
      `/api/v1/databases/${databaseId}/rotate-key`,
      { method: "POST", body: "{}" }
    );
  },

  /**
   * Issue / rotate this user's personal Postgres role for external IDE access.
   * Password is shown once — username is m_<dbCode>_<userIdPrefix>, NOT the shared u_* admin role.
   */
  personalConnection(databaseId: string) {
    return request<{
      connectionUrl: string;
      pgUser: string;
      password: string;
      authKey: string;
      userId: string;
      username: string;
      fullAccess: boolean;
      permissions: string[];
      note: string;
    }>(`/api/v1/databases/${databaseId}/personal-connection`, {
      method: "POST",
      body: "{}",
    });
  },

  deleteDatabase(databaseId: string, confirmName: string) {
    return request<{ ok: boolean }>(`/api/v1/databases/${databaseId}/delete`, {
      method: "POST",
      body: JSON.stringify({ confirmName }),
    });
  },

  listTables(databaseId: string, opts?: { poll?: boolean }) {
    const q = opts?.poll ? "?poll=1" : "";
    return request<{
      tables: TableMeta[];
      database: PublicDatabase;
      role: string;
    }>(`/api/v1/databases/${databaseId}/tables${q}`);
  },

  createTable(
    databaseId: string,
    body: {
      name: string;
      columns: Array<{
        name: string;
        dataType: DataType;
        nullable?: boolean;
        unique?: boolean;
        isPrimaryKey?: boolean;
      }>;
    }
  ) {
    return request<{ table: TableMeta }>(`/api/v1/databases/${databaseId}/tables`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  dropTable(databaseId: string, tableId: string) {
    return request<{ ok: boolean }>(`/api/v1/databases/${databaseId}/tables/${tableId}`, {
      method: "DELETE",
    });
  },

  addColumn(
    databaseId: string,
    tableId: string,
    body: { name: string; dataType: DataType; nullable?: boolean; unique?: boolean }
  ) {
    return request<{ table: TableMeta }>(
      `/api/v1/databases/${databaseId}/tables/${tableId}/columns`,
      { method: "POST", body: JSON.stringify(body) }
    );
  },

  dropColumn(databaseId: string, tableId: string, columnId: string) {
    return request<{ table: TableMeta }>(
      `/api/v1/databases/${databaseId}/tables/${tableId}/columns/${columnId}`,
      { method: "DELETE" }
    );
  },

  listRows(databaseId: string, tableId: string, opts?: { poll?: boolean }) {
    const q = opts?.poll ? "?poll=1" : "";
    return request<{ table: TableMeta; rows: RowRecord[]; totalRows: number }>(
      `/api/v1/databases/${databaseId}/tables/${tableId}/rows${q}`
    );
  },

  insertRow(databaseId: string, tableId: string, values: Record<string, unknown>) {
    return request<{ row: RowRecord }>(
      `/api/v1/databases/${databaseId}/tables/${tableId}/rows`,
      { method: "POST", body: JSON.stringify({ values }) }
    );
  },

  updateCell(
    databaseId: string,
    tableId: string,
    rowId: string,
    columnId: string,
    value: unknown,
    expectedVersion: number
  ) {
    return request<{ row: RowRecord }>(
      `/api/v1/databases/${databaseId}/tables/${tableId}/rows/${rowId}/cells/${columnId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ value, expectedVersion }),
      }
    );
  },



  async downloadTableCsv(databaseId: string, tableId: string, filename: string) {
    const res = await fetch(`${getApiBase()}/api/v1/databases/${databaseId}/tables/${tableId}/export.csv`, {
      credentials: "include",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: { code: body.code ?? "INTERNAL_ERROR", message: body.message ?? res.statusText } };
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    return { ok: true };
  },

  async downloadDatabaseExport(databaseId: string, dbCode: string) {
    const res = await fetch(`${getApiBase()}/api/v1/databases/${databaseId}/export`, {
      credentials: "include",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: { code: body.code ?? "INTERNAL_ERROR", message: body.message ?? res.statusText } };
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // ZIP of pure CSV files — one CSV per table
    a.download = `dragtable-${dbCode}-export.zip`;
    a.click();
    URL.revokeObjectURL(url);
    return { ok: true };
  },


  listMembers(teamId: string) {
    return request<{
      members: Array<{
        memberId: string;
        userId: string;
        username: string;
        name: string;
        email: string;
        role: string;
        permissions: string[];
        joinedAt: string;
      }>;
    }>(`/api/v1/teams/${teamId}/members`);
  },

  removeMember(teamId: string, memberUserId: string) {
    return request<{ ok: boolean }>(
      `/api/v1/teams/${teamId}/members/${memberUserId}/remove`,
      { method: "POST", body: "{}" }
    );
  },

  setMemberPermissions(teamId: string, memberUserId: string, permissions: string[]) {
    return request<{ permissions: string[] }>(
      `/api/v1/teams/${teamId}/members/${memberUserId}/permissions`,
      { method: "PUT", body: JSON.stringify({ permissions }) }
    );
  },

  listNotifications(teamId: string) {
    return request<{
      notifications: Array<{
        id: string;
        type: string;
        actorUserId?: string | null;
        targetUserId?: string | null;
        payload: Record<string, unknown>;
        createdAt: string;
        readAt: string | null;
      }>;
    }>(`/api/v1/teams/${teamId}/notifications`);
  },

  renameTable(databaseId: string, tableId: string, name: string) {
    return request<{ table: TableMeta }>(
      `/api/v1/databases/${databaseId}/tables/${tableId}`,
      { method: "PATCH", body: JSON.stringify({ name }) }
    );
  },

  getAnalytics(databaseId: string, window: "1h" | "1d" | "7d" = "1d") {
    return request<{
      analytics: {
        databaseId: string;
        window: string;
        generatedAt: string;
        totalReads: number;
        totalWrites: number;
        totalCalls: number;
        avgLatencyMs: number;
        maxLatencyMs: number;
        readsPerSec: number;
        writesPerSec: number;
        callsPerMin: number;
        points: Array<{
          t: string;
          ts: number;
          reads: number;
          writes: number;
          calls: number;
          latencyAvg: number;
          latencyMax: number;
          readsPerSec: number;
          writesPerSec: number;
          callsPerMin: number;
        }>;
        usage?: {
          tables: number;
          tableLimit: number | null;
          tablePct: number | null;
          warningLevel: string;
        };
      };
      database: { id: string; name: string; dbCode: string };
      planId: string;
      semantics: Record<string, string>;
    }>(`/api/v1/databases/${databaseId}/analytics?window=${window}`);
  },

  listSchemaExtras(databaseId: string) {
    return request<{
      foreignKeys: Array<{
        id: string;
        name: string;
        tableId: string;
        columnId: string;
        refTableId: string;
        refColumnId: string;
        onDelete: string;
      }>;
      indexes: Array<{
        id: string;
        name: string;
        tableId: string;
        columnIds: string[];
        unique: boolean;
      }>;
      checks: Array<{
        id: string;
        name: string;
        tableId: string;
        columnId: string;
        op: string;
        value?: unknown;
      }>;
      tables: Array<{
        id: string;
        name: string;
        columns: Array<{ id: string; name: string; dataType: string; isPrimaryKey: boolean }>;
      }>;
    }>(`/api/v1/databases/${databaseId}/schema-extras`);
  },

  addForeignKey(
    databaseId: string,
    body: {
      name?: string;
      tableId: string;
      columnId: string;
      refTableId: string;
      refColumnId: string;
      onDelete?: "restrict" | "cascade" | "set_null";
    }
  ) {
    return request<{ foreignKey: unknown }>(`/api/v1/databases/${databaseId}/foreign-keys`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  dropForeignKey(databaseId: string, fkId: string) {
    return request<{ ok: boolean }>(`/api/v1/databases/${databaseId}/foreign-keys/${fkId}`, {
      method: "DELETE",
    });
  },

  addIndex(
    databaseId: string,
    body: { name?: string; tableId: string; columnIds: string[]; unique?: boolean }
  ) {
    return request<{ index: unknown }>(`/api/v1/databases/${databaseId}/indexes`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  dropIndex(databaseId: string, indexId: string) {
    return request<{ ok: boolean }>(`/api/v1/databases/${databaseId}/indexes/${indexId}`, {
      method: "DELETE",
    });
  },

  addCheck(
    databaseId: string,
    body: {
      name?: string;
      tableId: string;
      columnId: string;
      op: string;
      value?: unknown;
    }
  ) {
    return request<{ check: unknown }>(`/api/v1/databases/${databaseId}/checks`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  dropCheck(databaseId: string, checkId: string) {
    return request<{ ok: boolean }>(`/api/v1/databases/${databaseId}/checks/${checkId}`, {
      method: "DELETE",
    });
  },

  listAudit(databaseId: string, tableId?: string, opts?: { poll?: boolean }) {
    const params = new URLSearchParams();
    if (tableId) params.set("tableId", tableId);
    if (opts?.poll) params.set("poll", "1");
    const q = params.toString() ? `?${params.toString()}` : "";
    return request<{ entries: AuditEntry[] }>(`/api/v1/databases/${databaseId}/audit${q}`);
  },

  importCsv(databaseId: string, tableName: string, csv: string) {
    return request<{ table: TableMeta; imported: number }>(
      `/api/v1/databases/${databaseId}/import-csv`,
      { method: "POST", body: JSON.stringify({ tableName, csv }) }
    );
  },

  deleteRow(databaseId: string, tableId: string, rowId: string, expectedVersion: number) {
    return request<{ ok: boolean }>(
      `/api/v1/databases/${databaseId}/tables/${tableId}/rows/${rowId}/delete`,
      { method: "POST", body: JSON.stringify({ expectedVersion }) }
    );
  },
};
