/**
 * Control-plane data access.
 * When DATABASE_URL is set → PostgreSQL.
 * Otherwise → in-memory store for local bootstrap / tests (NOT for production).
 */

import pg from "pg";
import {
  generateSessionToken,
  hashToken,
  hashPassword,
  verifyPassword,
  sessionExpiry,
  isValidEmail,
  isValidPassword,
  isValidName,
} from "@dragtable/auth";
import {
  generateShortId,
  planAllowsNewMember,
  planAllowsNewDatabase,
  planTableLimit,
} from "@dragtable/domain";
import type { PlanId } from "@dragtable/contracts";
import {
  isTargetPgEnabled,
  provisionTargetDatabase,
  rotateTargetPassword,
  dropTargetDatabase,
  closeTargetPool,
  pgSetTableLimit,
} from "@dragtable/target-pg";
import fs from "node:fs";
import path from "node:path";

const { Pool } = pg;

/** Connection strings for apps that need Postgres URL + auth key */
export function buildDatabaseCredentials(dbCode: string, authKey: string) {
  const host = process.env.TARGET_DB_HOST || process.env.PGHOST || "127.0.0.1";
  const port = String(process.env.TARGET_DB_PORT || process.env.PGPORT || "5432");
  const database = `dt_${dbCode.toLowerCase()}`;
  const user = `u_${dbCode.toLowerCase()}`;
  const connectionUrl = `postgresql://${user}:${encodeURIComponent(authKey)}@${host}:${port}/${database}`;
  const apiBase = (
    process.env.PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:3001"
  ).replace(/\/$/, "");
  return {
    connectionUrl,
    host,
    port,
    database,
    user,
    authKey,
    apiBase,
    /** HTTP API for structured mutations (preferred when not using raw SQL drivers) */
    apiUrl: `${apiBase}/api/v1/databases`,
  };
}

function dataDir(): string {
  return process.env.DATA_DIR || path.resolve(process.cwd(), ".data");
}


// ── Types ──────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  username: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: Date;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface TeamRow {
  id: string;
  team_code: string;
  name: string;
  plan_id: PlanId;
  created_by: string;
  created_at: Date;
}

export interface TeamMemberRow {
  id: string;
  team_id: string;
  user_id: string;
  role: "admin" | "member";
  status: "active" | "suspended" | "removed";
  joined_at: Date;
  removed_at?: Date | null;
}

export type DatabaseStatus = "provisioning" | "active" | "deleting" | "deleted" | "failed";

export interface DatabaseRow {
  id: string;
  db_code: string;
  team_id: string;
  name: string;
  status: DatabaseStatus;
  pg_database_name: string | null;
  schema_version: number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface CredentialRow {
  id: string;
  database_id: string;
  auth_key_hash: string;
  auth_key_hint: string;
  revoked_at: Date | null;
  created_at: Date;
}

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  name: string;
}

export interface PublicDatabase {
  id: string;
  dbCode: string;
  teamId: string;
  name: string;
  status: DatabaseStatus;
  schemaVersion: number;
  createdAt: string;
  authKeyHint?: string;
}

export interface CreateTeamResult {
  user: PublicUser;
  team: { id: string; teamCode: string; name: string; planId: PlanId };
  sessionToken: string;
}

export interface SignInResult {
  user: PublicUser;
  sessionToken: string;
  teams: Array<{ id: string; teamCode: string; name: string; planId: PlanId; role: string }>;
}

export interface JoinTeamResult {
  team: { id: string; teamCode: string; name: string; planId: PlanId };
  role: "member";
}

export interface CreateDatabaseResult {
  database: PublicDatabase;
  /** Raw auth key — shown once at creation / rotation only */
  authKey: string;
  /** Full Postgres connection URL (password = auth key) */
  connectionUrl: string;
  host: string;
  port: string;
  pgDatabase: string;
  pgUser: string;
  apiBase: string;
}

export interface MembershipContext {
  teamId: string;
  teamCode: string;
  teamName: string;
  planId: PlanId;
  role: "admin" | "member";
  memberId: string;
  /** Explicit grants for members. Admins ignore this (all allowed). Empty = nothing. */
  permissions: string[];
}

// ── In-memory store ────────────────────────────────────────────────────

const mem = {
  users: new Map<string, UserRow>(),
  usersByEmail: new Map<string, string>(),
  usersByUsername: new Map<string, string>(),
  sessions: new Map<string, SessionRow>(),
  sessionsByHash: new Map<string, string>(),
  teams: new Map<string, TeamRow>(),
  teamsByCode: new Map<string, string>(),
  members: new Map<string, TeamMemberRow>(),
  databases: new Map<string, DatabaseRow>(),
  databasesByCode: new Map<string, string>(),
  credentials: new Map<string, CredentialRow>(),
  /** `${databaseId}:${userId}` → last-4 of personal PG password */
  personalKeyHints: new Map<string, string>(),
  /**
   * Lowercase PG role name → { userId, username }.
   * Written when a personal connection is issued so external SQL is attributed
   * to the real member even when DATABASE_URL mode has no in-memory users.
   */
  pgActorMap: new Map<string, { userId: string; username: string }>(),
  /** memberId -> Set of permission strings */
  permissions: new Map<string, Set<string>>(),
  notifications: [] as Array<{
    id: string;
    teamId: string;
    type: string;
    actorUserId: string | null;
    targetUserId: string | null;
    payload: Record<string, unknown>;
    createdAt: Date;
    readAt: Date | null;
  }>,
  userApiTokens: new Map<string, {
    id: string;
    user_id: string;
    name: string;
    token_hash: string;
    token_hint: string;
    created_at: Date;
    revoked_at: Date | null;
  }>(),
};


// ── File persistence (survives process restart; DATA_DIR or ./.data) ────
let controlPersistTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleControlPersist() {
  if (process.env.DATABASE_URL) return;
  if (controlPersistTimer) clearTimeout(controlPersistTimer);
  controlPersistTimer = setTimeout(() => {
    try {
      persistControlStore();
    } catch (e) {
      console.error("[db-control] persist failed", e);
    }
  }, 25);
}

function persistControlStore() {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    version: 1,
    users: [...mem.users.values()].map((u) => ({
      ...u,
      created_at: u.created_at.toISOString(),
    })),
    sessions: [...mem.sessions.values()].map((s) => ({
      ...s,
      expires_at: s.expires_at.toISOString(),
      revoked_at: s.revoked_at ? s.revoked_at.toISOString() : null,
    })),
    teams: [...mem.teams.values()].map((x) => ({
      ...x,
      created_at: x.created_at.toISOString(),
    })),
    members: [...mem.members.values()].map((m) => ({
      ...m,
      joined_at: m.joined_at.toISOString(),
      removed_at: m.removed_at ? m.removed_at.toISOString() : null,
    })),
    databases: [...mem.databases.values()].map((d) => ({
      ...d,
      created_at: d.created_at.toISOString(),
      updated_at: d.updated_at.toISOString(),
      deleted_at: d.deleted_at ? d.deleted_at.toISOString() : null,
    })),
    userApiTokens: [...mem.userApiTokens.values()].map((x) => ({
      ...x,
      created_at: x.created_at.toISOString(),
      revoked_at: x.revoked_at ? x.revoked_at.toISOString() : null,
    })),
    credentials: [...mem.credentials.values()].map((c) => ({
      ...c,
      created_at: c.created_at.toISOString(),
      revoked_at: c.revoked_at ? c.revoked_at.toISOString() : null,
    })),
    personalKeyHints: [...(mem.personalKeyHints?.entries() ?? [])],
    pgActorMap: [...(mem.pgActorMap?.entries() ?? [])],
    permissions: [...mem.permissions.entries()].map(([k, v]) => [k, [...v]]),
    notifications: mem.notifications.map((n) => ({
      ...n,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt ? n.readAt.toISOString() : null,
    })),
  };
  const file = path.join(dir, "control-store.json");
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, file);
}

function loadControlStore() {
  if (process.env.DATABASE_URL) return;
  const file = path.join(dataDir(), "control-store.json");
  if (!fs.existsSync(file)) return;
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    mem.users.clear();
    mem.usersByEmail.clear();
    mem.usersByUsername.clear();
    mem.sessions.clear();
    mem.sessionsByHash.clear();
    mem.teams.clear();
    mem.teamsByCode.clear();
    mem.members.clear();
    mem.databases.clear();
    mem.databasesByCode.clear();
    mem.credentials.clear();
    mem.userApiTokens.clear();
    mem.permissions.clear();
    mem.notifications.length = 0;

    for (const u of payload.users || []) {
      const row = { ...u, created_at: new Date(u.created_at) };
      mem.users.set(row.id, row);
      mem.usersByEmail.set(row.email, row.id);
      mem.usersByUsername.set(row.username, row.id);
    }
    for (const s of payload.sessions || []) {
      const row = {
        ...s,
        expires_at: new Date(s.expires_at),
        revoked_at: s.revoked_at ? new Date(s.revoked_at) : null,
      };
      mem.sessions.set(row.id, row);
      mem.sessionsByHash.set(row.token_hash, row.id);
    }
    for (const x of payload.teams || []) {
      const row = { ...x, created_at: new Date(x.created_at) };
      mem.teams.set(row.id, row);
      mem.teamsByCode.set(row.team_code, row.id);
    }
    for (const m of payload.members || []) {
      const row = {
        ...m,
        joined_at: new Date(m.joined_at),
        removed_at: m.removed_at ? new Date(m.removed_at) : null,
      };
      mem.members.set(row.id, row);
    }
    for (const d of payload.databases || []) {
      const row = {
        ...d,
        created_at: new Date(d.created_at),
        updated_at: new Date(d.updated_at),
        deleted_at: d.deleted_at ? new Date(d.deleted_at) : null,
      };
      mem.databases.set(row.id, row);
      mem.databasesByCode.set(row.db_code, row.id);
    }
    for (const c of payload.credentials || []) {
      const row = {
        ...c,
        created_at: new Date(c.created_at),
        revoked_at: c.revoked_at ? new Date(c.revoked_at) : null,
      };
      mem.credentials.set(row.id, row);
    }
    if (!mem.personalKeyHints) {
      (mem as { personalKeyHints: Map<string, string> }).personalKeyHints = new Map();
    }
    mem.personalKeyHints.clear();
    for (const entry of payload.personalKeyHints || []) {
      if (Array.isArray(entry) && entry.length >= 2) {
        mem.personalKeyHints.set(String(entry[0]), String(entry[1]));
      }
    }
    if (!mem.pgActorMap) {
      (mem as { pgActorMap: Map<string, { userId: string; username: string }> }).pgActorMap =
        new Map();
    }
    mem.pgActorMap.clear();
    for (const entry of payload.pgActorMap || []) {
      if (Array.isArray(entry) && entry.length >= 2 && entry[1] && typeof entry[1] === "object") {
        const v = entry[1] as { userId?: string; username?: string };
        if (v.userId && v.username) {
          mem.pgActorMap.set(String(entry[0]).toLowerCase(), {
            userId: String(v.userId),
            username: String(v.username),
          });
        }
      }
    }
    for (const x of payload.userApiTokens || []) {
      mem.userApiTokens.set(x.id, {
        ...x,
        created_at: new Date(x.created_at),
        revoked_at: x.revoked_at ? new Date(x.revoked_at) : null,
      });
    }
    for (const [k, arr] of payload.permissions || []) {
      mem.permissions.set(k, new Set(arr));
    }
    for (const n of payload.notifications || []) {
      pushTeamNotification({
        ...n,
        createdAt: new Date(n.createdAt),
        readAt: n.readAt ? new Date(n.readAt) : null,
      });
    }
    // Enforce cap after bulk restore
    const teamIds = new Set(mem.notifications.map((x) => x.teamId));
    for (const tid of teamIds) {
      const forTeam = mem.notifications
        .filter((x) => x.teamId === tid)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      if (forTeam.length > MAX_NOTIFICATIONS_PER_TEAM) {
        const dropIds = new Set(
          forTeam.slice(0, forTeam.length - MAX_NOTIFICATIONS_PER_TEAM).map((x) => x.id)
        );
        mem.notifications = mem.notifications.filter((x) => !dropIds.has(x.id));
      }
    }
    console.log(`[db-control] restored from ${file}`);
  } catch (e) {
    console.error("[db-control] load failed", e);
  }
}


function uuid(): string {
  return crypto.randomUUID();
}

/** Keep at most 100 notifications per team (oldest dropped). */
const MAX_NOTIFICATIONS_PER_TEAM = 100;

function pushTeamNotification(n: {
  id: string;
  teamId: string;
  type: string;
  actorUserId: string | null;
  targetUserId: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
  readAt: Date | null;
}): void {
  mem.notifications.push(n);
  const forTeam = mem.notifications
    .filter((x) => x.teamId === n.teamId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (forTeam.length <= MAX_NOTIFICATIONS_PER_TEAM) return;
  const drop = forTeam.length - MAX_NOTIFICATIONS_PER_TEAM;
  const dropIds = new Set(forTeam.slice(0, drop).map((x) => x.id));
  mem.notifications = mem.notifications.filter((x) => !dropIds.has(x.id));
}


loadControlStore();

async function uniqueShortId(
  exists: (id: string) => boolean,
  maxAttempts = 12
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const id = generateShortId(5);
    if (!exists(id)) return id;
  }
  throw new Error("SHORT_ID_COLLISION");
}

function generateAuthKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toPublicDb(d: DatabaseRow, hint?: string): PublicDatabase {
  return {
    id: d.id,
    dbCode: d.db_code,
    teamId: d.team_id,
    name: d.name,
    status: d.status,
    schemaVersion: d.schema_version,
    createdAt: d.created_at.toISOString(),
    authKeyHint: hint,
  };
}

function toPublic(u: UserRow): PublicUser {
  return { id: u.id, username: u.username, email: u.email, name: u.name };
}

function err(code: string, message?: string, extra?: Record<string, unknown>) {
  return Object.assign(new Error(message ?? code), { code, ...extra });
}

// ── Store interface ────────────────────────────────────────────────────

export interface ControlStore {
  createTeamAndAdmin(input: {
    name: string;
    email: string;
    password: string;
    teamName: string;
    planId: PlanId;
  }): Promise<CreateTeamResult>;

  signIn(input: { email: string; password: string }): Promise<SignInResult | null>;
  resolveSession(token: string): Promise<{ user: PublicUser; sessionId: string } | null>;
  revokeSession(token: string): Promise<void>;
  joinTeam(input: { userId: string; teamCode: string }): Promise<JoinTeamResult>;

  /** New user signup that joins an existing team (member role). */
  registerAndJoin(input: {
    name: string;
    email: string;
    password: string;
    teamCode: string;
  }): Promise<{
    user: PublicUser;
    team: { id: string; teamCode: string; name: string; planId: PlanId };
    role: "member";
    sessionToken: string;
  }>;

  listUserTeams(userId: string): Promise<
    Array<{ id: string; teamCode: string; name: string; planId: PlanId; role: string }>
  >;

  getMembership(userId: string, teamIdOrCode: string): Promise<MembershipContext | null>;

  createDatabase(input: {
    userId: string;
    teamId: string;
    name: string;
  }): Promise<CreateDatabaseResult>;

  listDatabases(input: { userId: string; teamId: string }): Promise<PublicDatabase[]>;

  getDatabase(input: {
    userId: string;
    databaseId: string;
  }): Promise<PublicDatabase | null>;

  rotateAuthKey(input: {
    userId: string;
    databaseId: string;
  }): Promise<{
    authKey: string;
    authKeyHint: string;
    connectionUrl: string;
    host: string;
    port: string;
    pgDatabase: string;
    pgUser: string;
    apiBase: string;
  }>;

  updateProfile(input: { userId: string; name: string }): Promise<PublicUser>;

  changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<{ ok: true }>;

  deleteDatabase(input: {
    userId: string;
    databaseId: string;
    confirmName: string;
  }): Promise<{ ok: true }>;

  listMembers(input: { userId: string; teamId: string }): Promise<
    Array<{
      memberId: string;
      userId: string;
      username: string;
      name: string;
      email: string;
      role: "admin" | "member";
      permissions: string[];
      joinedAt: string;
    }>
  >;

  removeMember(input: {
    actorUserId: string;
    teamId: string;
    memberUserId: string;
  }): Promise<{ ok: true }>;

  setMemberPermissions(input: {
    actorUserId: string;
    teamId: string;
    memberUserId: string;
    permissions: string[];
  }): Promise<{ permissions: string[]; targetUserId?: string }>;

  notifyTeam(input: {
    teamId: string;
    type: string;
    actorUserId: string;
    targetUserId?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<{ id: string }>;

  /** Map Postgres session role (m_<db>_<userIdPrefix>) → DragTable user */
  resolvePgActor(roleName: string): Promise<{ userId: string; username: string } | null>;
  /** Register explicit PG role → user mapping (called when personal connection is issued) */
  registerPgActor(input: {
    roleName: string;
    userId: string;
    username: string;
  }): Promise<void>;
  /** Persist personal connection key hint for dashboard display */
  setPersonalKeyHint(input: { userId: string; databaseId: string; hint: string }): Promise<void>;
  getPersonalKeyHint(input: { userId: string; databaseId: string }): Promise<string | undefined>;
    listNotifications(input: { userId: string; teamId: string }): Promise<
    Array<{
      id: string;
      type: string;
      actorUserId?: string | null;
      actorUsername?: string | null;
      actorName?: string | null;
      targetUserId?: string | null;
      targetUsername?: string | null;
      targetName?: string | null;
      payload: Record<string, unknown>;
      createdAt: string;
      readAt: string | null;
    }>
  >;

  createUserApiToken(input: { userId: string; name?: string }): Promise<{
    token: string;
    id: string;
    hint: string;
    name: string;
  }>;
  listUserApiTokens(userId: string): Promise<Array<{ id: string; name: string; hint: string; createdAt: string }>>;
  revokeUserApiToken(input: { userId: string; tokenId: string }): Promise<{ ok: true }>;
  resolveApiToken(rawToken: string): Promise<{ user: PublicUser; tokenId: string } | null>;
}

// ── Memory implementation ──────────────────────────────────────────────

const memoryStore: ControlStore = {
  async createTeamAndAdmin(input) {
    if (!isValidName(input.name)) throw err("VALIDATION_FAILED", "Invalid name", { field: "name" });
    if (!isValidEmail(input.email)) throw err("VALIDATION_FAILED", "Invalid email", { field: "email" });
    if (!isValidPassword(input.password))
      throw err("VALIDATION_FAILED", "Password must be 8–128 characters", { field: "password" });
    if (!isValidName(input.teamName))
      throw err("VALIDATION_FAILED", "Invalid team name", { field: "teamName" });
    if (!["personal", "startup", "enterprise"].includes(input.planId)) {
      throw err("VALIDATION_FAILED", "Invalid plan", { field: "planId" });
    }
    if (mem.usersByEmail.has(input.email.toLowerCase())) {
      throw err("VALIDATION_FAILED", "Email already registered", { field: "email" });
    }

    const username = await uniqueShortId((id) => mem.usersByUsername.has(id));
    const teamCode = await uniqueShortId((id) => mem.teamsByCode.has(id));
    const userId = uuid();
    const teamId = uuid();
    const memberId = uuid();
    const sessionId = uuid();
    const password_hash = await hashPassword(input.password);
    const token = generateSessionToken();
    const token_hash = await hashToken(token);
    const now = new Date();

    const user: UserRow = {
      id: userId,
      username,
      email: input.email.toLowerCase(),
      name: input.name.trim(),
      password_hash,
      created_at: now,
    };
    mem.users.set(userId, user);
    mem.usersByEmail.set(user.email, userId);
    mem.usersByUsername.set(username, userId);

    const team: TeamRow = {
      id: teamId,
      team_code: teamCode,
      name: input.teamName.trim(),
      plan_id: input.planId,
      created_by: userId,
      created_at: now,
    };
    mem.teams.set(teamId, team);
    mem.teamsByCode.set(teamCode, teamId);

    mem.members.set(memberId, {
      id: memberId,
      team_id: teamId,
      user_id: userId,
      role: "admin",
      status: "active",
      joined_at: now,
    });

    mem.sessions.set(sessionId, {
      id: sessionId,
      user_id: userId,
      token_hash,
      expires_at: sessionExpiry(),
      revoked_at: null,
    });
    mem.sessionsByHash.set(token_hash, sessionId);

    scheduleControlPersist();
    return {
      user: toPublic(user),
      team: { id: teamId, teamCode, name: team.name, planId: team.plan_id },
      sessionToken: token,
    };
  },

  async signIn(input) {
    const userId = mem.usersByEmail.get(input.email.toLowerCase());
    if (!userId) return null;
    const user = mem.users.get(userId)!;
    const ok = await verifyPassword(input.password, user.password_hash);
    if (!ok) return null;

    const token = generateSessionToken();
    const token_hash = await hashToken(token);
    const sessionId = uuid();
    mem.sessions.set(sessionId, {
      id: sessionId,
      user_id: userId,
      token_hash,
      expires_at: sessionExpiry(),
      revoked_at: null,
    });
    mem.sessionsByHash.set(token_hash, sessionId);

    const teams = await this.listUserTeams(userId);
    scheduleControlPersist();
    return { user: toPublic(user), sessionToken: token, teams };
  },

  async resolveSession(token) {
    const token_hash = await hashToken(token);
    const sessionId = mem.sessionsByHash.get(token_hash);
    if (!sessionId) return null;
    const session = mem.sessions.get(sessionId);
    if (!session || session.revoked_at || session.expires_at < new Date()) return null;
    const user = mem.users.get(session.user_id);
    if (!user) return null;
    return { user: toPublic(user), sessionId };
  },

  async revokeSession(token) {
    const token_hash = await hashToken(token);
    const sessionId = mem.sessionsByHash.get(token_hash);
    if (!sessionId) return;
    const session = mem.sessions.get(sessionId);
    if (session) session.revoked_at = new Date();
    scheduleControlPersist();
  },

  async joinTeam(input) {
    const teamId = mem.teamsByCode.get(input.teamCode.toUpperCase());
    if (!teamId) throw err("TEAM_NOT_FOUND", "Team not found");
    const team = mem.teams.get(teamId)!;

    for (const m of mem.members.values()) {
      if (m.team_id === teamId && m.user_id === input.userId && m.status === "active") {
        return {
          team: { id: team.id, teamCode: team.team_code, name: team.name, planId: team.plan_id },
          role: "member" as const,
        };
      }
    }

    let count = 0;
    for (const m of mem.members.values()) {
      if (m.team_id === teamId && m.status === "active") count++;
    }
    if (!planAllowsNewMember(team.plan_id, count)) {
      throw err("TEAM_CAPACITY_REACHED", "Team has reached its member limit");
    }

    const memberId = uuid();
    mem.members.set(memberId, {
      id: memberId,
      team_id: teamId,
      user_id: input.userId,
      role: "member",
      status: "active",
      joined_at: new Date(),
    });
    // Deny-by-default: no grants until admin checks permission boxes
    mem.permissions.set(memberId, new Set());
    const joiner = mem.users.get(input.userId);
    pushTeamNotification({
      id: uuid(),
      teamId,
      type: "MEMBER_JOINED",
      actorUserId: input.userId,
      targetUserId: null,
      payload: {
        summary: `@${joiner?.username ?? "user"} joined the team`,
        byUsername: joiner?.username ?? null,
        toUsername: null,
      },
      createdAt: new Date(),
      readAt: null,
    });

    scheduleControlPersist();
    return {
      team: { id: team.id, teamCode: team.team_code, name: team.name, planId: team.plan_id },
      role: "member",
    };
  },

  async registerAndJoin(input) {
    if (!isValidName(input.name)) throw err("VALIDATION_FAILED", "Invalid name", { field: "name" });
    if (!isValidEmail(input.email)) throw err("VALIDATION_FAILED", "Invalid email", { field: "email" });
    if (!isValidPassword(input.password))
      throw err("VALIDATION_FAILED", "Password must be 8–128 characters", { field: "password" });
    const code = input.teamCode.toUpperCase();
    const teamId = mem.teamsByCode.get(code);
    if (!teamId) throw err("TEAM_NOT_FOUND", "Team not found");
    const team = mem.teams.get(teamId)!;
    if (mem.usersByEmail.has(input.email.toLowerCase())) {
      throw err("VALIDATION_FAILED", "Email already registered — sign in, then join", { field: "email" });
    }
    let count = 0;
    for (const m of mem.members.values()) {
      if (m.team_id === teamId && m.status === "active") count++;
    }
    if (!planAllowsNewMember(team.plan_id, count)) {
      throw err("TEAM_CAPACITY_REACHED", "Team has reached its member limit");
    }
    const username = await uniqueShortId((id) => mem.usersByUsername.has(id));
    const userId = uuid();
    const memberId = uuid();
    const sessionId = uuid();
    const password_hash = await hashPassword(input.password);
    const token = generateSessionToken();
    const token_hash = await hashToken(token);
    const now = new Date();
    const user: UserRow = {
      id: userId,
      username,
      email: input.email.toLowerCase(),
      name: input.name.trim(),
      password_hash,
      created_at: now,
    };
    mem.users.set(userId, user);
    mem.usersByEmail.set(user.email, userId);
    mem.usersByUsername.set(username, userId);
    mem.members.set(memberId, {
      id: memberId,
      team_id: teamId,
      user_id: userId,
      role: "member",
      status: "active",
      joined_at: now,
    });
    mem.sessions.set(sessionId, {
      id: sessionId,
      user_id: userId,
      token_hash,
      expires_at: sessionExpiry(),
      revoked_at: null,
    });
    mem.sessionsByHash.set(token_hash, sessionId);
    pushTeamNotification({
      id: uuid(),
      teamId,
      type: "MEMBER_JOINED",
      actorUserId: userId,
      targetUserId: null,
      payload: {
        username,
        name: user.name,
        summary: `@${username} joined the team`,
        byUsername: username,
        toUsername: null,
      },
      createdAt: now,
      readAt: null,
    });
    scheduleControlPersist();
    return {
      user: toPublic(user),
      team: { id: team.id, teamCode: team.team_code, name: team.name, planId: team.plan_id },
      role: "member" as const,
      sessionToken: token,
    };
  },

  async listUserTeams(userId) {
    const out: Array<{ id: string; teamCode: string; name: string; planId: PlanId; role: string }> =
      [];
    for (const m of mem.members.values()) {
      if (m.user_id !== userId || m.status !== "active") continue;
      const team = mem.teams.get(m.team_id);
      if (!team) continue;
      out.push({
        id: team.id,
        teamCode: team.team_code,
        name: team.name,
        planId: team.plan_id,
        role: m.role,
      });
    }
    return out;
  },

  async getMembership(userId, teamIdOrCode) {
    let team: TeamRow | undefined = mem.teams.get(teamIdOrCode);
    if (!team) {
      const id = mem.teamsByCode.get(teamIdOrCode.toUpperCase());
      if (id) team = mem.teams.get(id);
    }
    if (!team) return null;
    for (const m of mem.members.values()) {
      if (m.team_id === team.id && m.user_id === userId && m.status === "active") {
        const perms = mem.permissions.get(m.id);
        return {
          teamId: team.id,
          teamCode: team.team_code,
          teamName: team.name,
          planId: team.plan_id,
          role: m.role,
          memberId: m.id,
          permissions: perms ? [...perms] : [],
        };
      }
    }
    return null;
  },

  async createDatabase(input) {
    // Dual-mode: real PG when TARGET_ADMIN_URL is set; otherwise in-memory target-db (hackathon).
    const membership = await this.getMembership(input.userId, input.teamId);
    if (!membership) throw err("FORBIDDEN", "Not a team member");
    if (membership.role !== "admin") throw err("FORBIDDEN", "Only admins can create databases");

    const name = input.name.trim();
    if (!name || name.length > 64) throw err("VALIDATION_FAILED", "Invalid database name", { field: "name" });

    let activeCount = 0;
    for (const d of mem.databases.values()) {
      if (d.team_id === membership.teamId && d.status !== "deleted") {
        activeCount++;
        if (d.name.toLowerCase() === name.toLowerCase()) {
          throw err("VALIDATION_FAILED", "A database with this name already exists", { field: "name" });
        }
      }
    }
    if (!planAllowsNewDatabase(membership.planId, activeCount)) {
      throw err("DB_LIMIT_REACHED", "Plan database limit reached");
    }

    const dbCode = await uniqueShortId((id) => mem.databasesByCode.has(id));
    const dbId = uuid();
    const now = new Date();
    const row: DatabaseRow = {
      id: dbId,
      db_code: dbCode,
      team_id: membership.teamId,
      name,
      status: "active", // memory: instant provision
      pg_database_name: `dt_${dbCode.toLowerCase()}`,
      schema_version: 0,
      created_by: input.userId,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    mem.databases.set(dbId, row);
    mem.databasesByCode.set(dbCode, dbId);

    const authKey = generateAuthKey();
    const auth_key_hash = await hashToken(authKey);
    const hint = authKey.slice(-4);
    const credId = uuid();
    mem.credentials.set(credId, {
      id: credId,
      database_id: dbId,
      auth_key_hash,
      auth_key_hint: hint,
      revoked_at: null,
      created_at: now,
    });

    const creds = buildDatabaseCredentials(dbCode, authKey);
    if (isTargetPgEnabled()) {
      try {
        await provisionTargetDatabase(dbCode, authKey);
        row.status = "active";
        // Install plan table-limit guard so external SQL cannot exceed max tables
        await pgSetTableLimit(dbCode, planTableLimit(membership.planId)).catch((e) =>
          console.error("[db-control] pgSetTableLimit after provision", e)
        );
      } catch (e) {
        // roll back memory registry if real PG provision fails
        mem.databases.delete(dbId);
        mem.databasesByCode.delete(dbCode);
        mem.credentials.delete(credId);
        const msg = e instanceof Error ? e.message : "Postgres provision failed";
        throw err("PROVISION_FAILED", msg);
      }
    }
    // Creator always has a key tip from first create (shared admin key last-4)
    if (!mem.personalKeyHints) {
      (mem as { personalKeyHints: Map<string, string> }).personalKeyHints = new Map();
    }
    mem.personalKeyHints.set(`${dbId}:${input.userId}`, hint);
    scheduleControlPersist();
    return {
      database: toPublicDb(row, hint),
      authKey,
      connectionUrl: creds.connectionUrl,
      host: creds.host,
      port: creds.port,
      pgDatabase: creds.database,
      pgUser: creds.user,
      apiBase: creds.apiBase,
    };
  },

  async listDatabases(input) {
    const membership = await this.getMembership(input.userId, input.teamId);
    if (!membership) throw err("FORBIDDEN", "Not a team member");

    const out: PublicDatabase[] = [];
    for (const d of mem.databases.values()) {
      if (d.team_id !== membership.teamId || d.status === "deleted") continue;
      let hint = mem.personalKeyHints?.get(`${d.id}:${input.userId}`);
      // Admins always see a key tip: seed from active shared credential if missing
      if (!hint && membership.role === "admin") {
        let shared: string | undefined;
        let newest = -1;
        for (const c of mem.credentials.values()) {
          if (c.database_id === d.id && !c.revoked_at) {
            const t = c.created_at?.getTime?.() ?? 0;
            if (t >= newest) {
              newest = t;
              shared = c.auth_key_hint;
            }
          }
        }
        if (shared) {
          hint = shared;
          if (!mem.personalKeyHints) {
            (mem as { personalKeyHints: Map<string, string> }).personalKeyHints = new Map();
          }
          mem.personalKeyHints.set(`${d.id}:${input.userId}`, shared);
        }
      }
      out.push(toPublicDb(d, hint));
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  },

  async getDatabase(input) {
    const d = mem.databases.get(input.databaseId);
    if (!d || d.status === "deleted") return null;
    const membership = await this.getMembership(input.userId, d.team_id);
    if (!membership) return null;
    let hint = mem.personalKeyHints?.get(`${d.id}:${input.userId}`);
    if (!hint && membership.role === "admin") {
      for (const c of mem.credentials.values()) {
        if (c.database_id === d.id && !c.revoked_at) {
          hint = c.auth_key_hint;
          if (hint) {
            if (!mem.personalKeyHints) {
              (mem as { personalKeyHints: Map<string, string> }).personalKeyHints = new Map();
            }
            mem.personalKeyHints.set(`${d.id}:${input.userId}`, hint);
          }
          break;
        }
      }
    }
    return toPublicDb(d, hint);
  },

  async rotateAuthKey(input) {
    const d = mem.databases.get(input.databaseId);
    if (!d || d.status === "deleted") throw err("DB_NOT_FOUND", "Database not found");
    const membership = await this.getMembership(input.userId, d.team_id);
    if (!membership) throw err("FORBIDDEN", "Not a team member");
    if (membership.role !== "admin") throw err("FORBIDDEN", "Only admins can rotate credentials");

    for (const c of mem.credentials.values()) {
      if (c.database_id === d.id && !c.revoked_at) c.revoked_at = new Date();
    }
    const authKey = generateAuthKey();
    const auth_key_hash = await hashToken(authKey);
    const hint = authKey.slice(-4);
    mem.credentials.set(uuid(), {
      id: uuid(),
      database_id: d.id,
      auth_key_hash,
      auth_key_hint: hint,
      revoked_at: null,
      created_at: new Date(),
    });
    d.updated_at = new Date();
    if (isTargetPgEnabled()) {
      try {
        await rotateTargetPassword(d.db_code, authKey);
        await closeTargetPool(d.db_code);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Password rotate failed";
        throw err("PROVISION_FAILED", msg);
      }
    }
    const creds = buildDatabaseCredentials(d.db_code, authKey);
    scheduleControlPersist();
    return {
      authKey,
      authKeyHint: hint,
      connectionUrl: creds.connectionUrl,
      host: creds.host,
      port: creds.port,
      pgDatabase: creds.database,
      pgUser: creds.user,
      apiBase: creds.apiBase,
    };
  },

  async deleteDatabase(input) {
    const d = mem.databases.get(input.databaseId);
    if (!d || d.status === "deleted") throw err("DB_NOT_FOUND", "Database not found");
    const membership = await this.getMembership(input.userId, d.team_id);
    if (!membership) throw err("FORBIDDEN", "Not a team member");
    if (membership.role !== "admin") throw err("FORBIDDEN", "Only admins can delete databases");
    if (input.confirmName.trim() !== d.name) {
      throw err("VALIDATION_FAILED", "Confirmation name does not match");
    }
    d.status = "deleted";
    d.deleted_at = new Date();
    d.updated_at = new Date();
    for (const c of mem.credentials.values()) {
      if (c.database_id === d.id && !c.revoked_at) c.revoked_at = new Date();
    }
    if (isTargetPgEnabled()) {
      try {
        await closeTargetPool(d.db_code);
        await dropTargetDatabase(d.db_code);
      } catch (e) {
        console.error("[db-control] drop target pg failed", e);
      }
    }
    scheduleControlPersist();
    return { ok: true as const };
  },

  async resolvePgActor(roleName: string) {
    const role = (roleName || "").toLowerCase().trim();
    if (!role) return null;

    // 1) Explicit map written when personal connection was issued (most reliable)
    if (!mem.pgActorMap) {
      (mem as { pgActorMap: Map<string, { userId: string; username: string }> }).pgActorMap =
        new Map();
    }
    const mapped = mem.pgActorMap.get(role);
    if (mapped) return { userId: mapped.userId, username: mapped.username };

    // Shared team owner role — not a specific person
    if (role.startsWith("u_")) {
      return { userId: "shared_admin_key", username: "team-admin" };
    }

    // 2) m_<dbcode>_<userIdAlnumPrefix> — exact prefix match only
    if (!role.startsWith("m_")) return null;
    const parts = role.split("_");
    if (parts.length < 3) return null;
    // dbCode is always 5 alnum chars; remainder is user id prefix
    const prefix = parts.slice(2).join("_");
    if (!prefix) return null;

    // Prefer in-memory users
    for (const u of mem.users.values()) {
      const alnum = u.id.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const idPrefix = alnum.slice(0, 12);
      if (idPrefix === prefix) {
        // Cache for next time
        mem.pgActorMap.set(role, { userId: u.id, username: u.username });
        return { userId: u.id, username: u.username };
      }
    }

    // 3) DATABASE_URL mode: look up user by id prefix from PG
    if (process.env.DATABASE_URL) {
      try {
        const db = getPool();
        const res = await db.query(
          `SELECT id, username FROM users
           WHERE lower(regexp_replace(id::text, '[^a-zA-Z0-9]', '', 'g')) LIKE $1
           LIMIT 5`,
          [prefix + "%"]
        );
        // Exact 12-char prefix match only
        for (const row of res.rows) {
          const alnum = String(row.id).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
          if (alnum.slice(0, 12) === prefix) {
            const hit = { userId: String(row.id), username: String(row.username) };
            mem.pgActorMap.set(role, hit);
            return hit;
          }
        }
      } catch (e) {
        console.error("[db-control] resolvePgActor PG lookup", e);
      }
    }
    return null;
  },

  async registerPgActor(input) {
    if (!mem.pgActorMap) {
      (mem as { pgActorMap: Map<string, { userId: string; username: string }> }).pgActorMap =
        new Map();
    }
    const role = (input.roleName || "").toLowerCase().trim();
    if (!role) return;
    mem.pgActorMap.set(role, { userId: input.userId, username: input.username });
    scheduleControlPersist();
  },

  async setPersonalKeyHint(input) {
    if (!mem.personalKeyHints) {
      (mem as { personalKeyHints: Map<string, string> }).personalKeyHints = new Map();
    }
    mem.personalKeyHints.set(`${input.databaseId}:${input.userId}`, input.hint);
    scheduleControlPersist();
  },

  async getPersonalKeyHint(input) {
    return mem.personalKeyHints.get(`${input.databaseId}:${input.userId}`);
  },

  async listMembers(input) {
    const membership = await this.getMembership(input.userId, input.teamId);
    if (!membership) throw err("FORBIDDEN", "Not a team member");
    const out = [];
    for (const m of mem.members.values()) {
      if (m.team_id !== membership.teamId || m.status !== "active") continue;
      const u = mem.users.get(m.user_id);
      if (!u) continue;
      const perms = mem.permissions.get(m.id);
      out.push({
        memberId: m.id,
        userId: u.id,
        username: u.username,
        name: u.name,
        email: u.email,
        role: m.role,
        permissions: perms ? [...perms] : [],
        joinedAt: m.joined_at.toISOString(),
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  },

  async removeMember(input) {
    const actor = await this.getMembership(input.actorUserId, input.teamId);
    if (!actor || actor.role !== "admin") throw err("FORBIDDEN", "Only admins can remove members");
    if (input.memberUserId === input.actorUserId) {
      throw err("VALIDATION_FAILED", "Cannot remove yourself");
    }
    let target = null;
    for (const m of mem.members.values()) {
      if (m.team_id === actor.teamId && m.user_id === input.memberUserId && m.status === "active") {
        target = m;
        break;
      }
    }
    if (!target) throw err("VALIDATION_FAILED", "Member not found");
    if (target.role === "admin") {
      // prevent removing last admin
      let adminCount = 0;
      for (const m of mem.members.values()) {
        if (m.team_id === actor.teamId && m.status === "active" && m.role === "admin") adminCount++;
      }
      if (adminCount <= 1) throw err("VALIDATION_FAILED", "Cannot remove the last admin");
    }
    target.status = "removed";
    target.removed_at = new Date();
    // revoke sessions for that user (all sessions — simple hackathon approach)
    for (const s of mem.sessions.values()) {
      if (s.user_id === input.memberUserId && !s.revoked_at) s.revoked_at = new Date();
    }
    const actorUser = mem.users.get(input.actorUserId);
    const targetUser = mem.users.get(input.memberUserId);
    pushTeamNotification({
      id: uuid(),
      teamId: actor.teamId,
      type: "MEMBER_REMOVED",
      actorUserId: input.actorUserId,
      targetUserId: input.memberUserId,
      payload: {
        teamId: actor.teamId,
        summary: `@${actorUser?.username ?? "admin"} removed @${targetUser?.username ?? "member"}`,
        byUsername: actorUser?.username ?? null,
        toUsername: targetUser?.username ?? null,
      },
      createdAt: new Date(),
      readAt: null,
    });
    scheduleControlPersist();
    return { ok: true, targetUserId: input.memberUserId };
  },

  async setMemberPermissions(input) {
    const actor = await this.getMembership(input.actorUserId, input.teamId);
    if (!actor || actor.role !== "admin") throw err("FORBIDDEN", "Only admins can manage permissions");
    let target = null;
    for (const m of mem.members.values()) {
      if (m.team_id === actor.teamId && m.user_id === input.memberUserId && m.status === "active") {
        target = m;
        break;
      }
    }
    if (!target) throw err("VALIDATION_FAILED", "Member not found");
    if (target.role === "admin") {
      throw err("VALIDATION_FAILED", "Admin already has all permissions");
    }
    const allowed = new Set([
      "database.read", "table.create", "table.rename", "table.delete", "table.edit_schema",
      "relation.manage", "constraint.manage",
      "data.read", "data.insert", "data.update", "data.delete", "csv.import", "csv.export",
      "analytics.read", "audit.read",
    ]);
    const next = new Set<string>();
    for (const p of input.permissions) {
      if (allowed.has(p)) next.add(p);
    }
    mem.permissions.set(target.id, next);
    const actorUser = mem.users.get(input.actorUserId);
    const targetUser = mem.users.get(input.memberUserId);
    pushTeamNotification({
      id: uuid(),
      teamId: actor.teamId,
      type: "PERMISSIONS_UPDATED",
      actorUserId: input.actorUserId,
      targetUserId: input.memberUserId,
      payload: {
        permissions: [...next],
        summary: `@${actorUser?.username ?? "admin"} updated permissions for @${targetUser?.username ?? "member"}`,
        byUsername: actorUser?.username ?? null,
        toUsername: targetUser?.username ?? null,
      },
      createdAt: new Date(),
      readAt: null,
    });
    scheduleControlPersist();
    return { permissions: [...next], targetUserId: input.memberUserId };
  },


  async updateProfile(input) {
    const user = mem.users.get(input.userId);
    if (!user) throw err("VALIDATION_FAILED", "User not found");
    if (!isValidName(input.name)) throw err("VALIDATION_FAILED", "Invalid name", { field: "name" });
    user.name = input.name.trim();
    scheduleControlPersist();
    return toPublic(user);
  },

  async changePassword(input) {
    const user = mem.users.get(input.userId);
    if (!user) throw err("VALIDATION_FAILED", "User not found");
    const ok = await verifyPassword(input.currentPassword, user.password_hash);
    if (!ok) throw err("AUTH_INVALID", "Current password is incorrect");
    if (!isValidPassword(input.newPassword)) {
      throw err("VALIDATION_FAILED", "Password must be 8–128 characters", { field: "newPassword" });
    }
    user.password_hash = await hashPassword(input.newPassword);
    // revoke other sessions optionally — keep current for UX
    scheduleControlPersist();
    return { ok: true as const };
  },

  async notifyTeam(input) {
    const actor = mem.users.get(input.actorUserId);
    const target = input.targetUserId ? mem.users.get(input.targetUserId) : null;
    const id = uuid();
    pushTeamNotification({
      id,
      teamId: input.teamId,
      type: input.type,
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId ?? null,
      payload: {
        ...(input.payload ?? {}),
        byUsername: actor?.username ?? null,
        toUsername: target?.username ?? null,
        summary:
          (input.payload?.summary as string) ||
          `${input.type} by @${actor?.username ?? "user"}`,
      },
      createdAt: new Date(),
      readAt: null,
    });
    scheduleControlPersist();
    return { id };
  },

  async listNotifications(input) {
    const membership = await this.getMembership(input.userId, input.teamId);
    if (!membership) throw err("FORBIDDEN", "Not a team member");
    // All team members see all team governance notifications
    return mem.notifications
      .filter((n) => n.teamId === membership.teamId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 100)
      .map((n) => {
        const actor = n.actorUserId ? mem.users.get(n.actorUserId) : null;
        const target = n.targetUserId ? mem.users.get(n.targetUserId) : null;
        return {
          id: n.id,
          type: n.type,
          actorUserId: n.actorUserId,
          actorUsername: actor?.username ?? null,
          actorName: actor?.name ?? null,
          targetUserId: n.targetUserId,
          targetUsername: target?.username ?? null,
          targetName: target?.name ?? null,
          payload: n.payload,
          createdAt: n.createdAt.toISOString(),
          readAt: n.readAt ? n.readAt.toISOString() : null,
        };
      });
  },

  async createUserApiToken(input: { userId: string; name?: string }) {
    const user = mem.users.get(input.userId);
    if (!user) throw err("VALIDATION_FAILED", "User not found");
    const raw = `dtu_${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    const token_hash = await hashToken(raw);
    const id = uuid();
    const row = {
      id,
      user_id: input.userId,
      name: (input.name || "default").slice(0, 64),
      token_hash,
      token_hint: raw.slice(-4),
      created_at: new Date(),
      revoked_at: null as Date | null,
    };
    mem.userApiTokens.set(id, row);
    scheduleControlPersist();
    return { token: raw, id, hint: row.token_hint, name: row.name };
  },

  async listUserApiTokens(userId: string) {
    const out = [];
    for (const t of mem.userApiTokens.values()) {
      if (t.user_id === userId && !t.revoked_at) {
        out.push({
          id: t.id,
          name: t.name,
          hint: t.token_hint,
          createdAt: t.created_at.toISOString(),
        });
      }
    }
    return out;
  },

  async revokeUserApiToken(input: { userId: string; tokenId: string }) {
    const t = mem.userApiTokens.get(input.tokenId);
    if (!t || t.user_id !== input.userId) throw err("VALIDATION_FAILED", "Token not found");
    t.revoked_at = new Date();
    scheduleControlPersist();
    return { ok: true as const };
  },

  async resolveApiToken(rawToken: string) {
    const token_hash = await hashToken(rawToken);
    for (const t of mem.userApiTokens.values()) {
      if (t.token_hash === token_hash && !t.revoked_at) {
        const user = mem.users.get(t.user_id);
        if (!user) return null;
        return { user: toPublic(user), tokenId: t.id };
      }
    }
    return null;
  },
};

// ── PostgreSQL (subset — same interface; full DDL already in schema) ───

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set");
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

/** PG store: start from memoryStore, override only methods that use DATABASE_URL */
const pgStore: ControlStore = {
  ...memoryStore,
  async createTeamAndAdmin(input) {
    // Prefer real PG path when DATABASE_URL is set
    if (!isValidName(input.name)) throw err("VALIDATION_FAILED", "Invalid name", { field: "name" });
    if (!isValidEmail(input.email)) throw err("VALIDATION_FAILED", "Invalid email", { field: "email" });
    if (!isValidPassword(input.password))
      throw err("VALIDATION_FAILED", "Invalid password", { field: "password" });
    if (!isValidName(input.teamName)) throw err("VALIDATION_FAILED", "Invalid team name", { field: "teamName" });

    const db = getPool();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const password_hash = await hashPassword(input.password);
      let username = "";
      for (let i = 0; i < 12; i++) {
        username = generateShortId(5);
        const r = await client.query("SELECT 1 FROM users WHERE username = $1", [username]);
        if (r.rowCount === 0) break;
        if (i === 11) throw new Error("SHORT_ID_COLLISION");
      }
      let teamCode = "";
      for (let i = 0; i < 12; i++) {
        teamCode = generateShortId(5);
        const r = await client.query("SELECT 1 FROM teams WHERE team_code = $1", [teamCode]);
        if (r.rowCount === 0) break;
        if (i === 11) throw new Error("SHORT_ID_COLLISION");
      }
      const userRes = await client.query(
        `INSERT INTO users (username, email, name, password_hash)
         VALUES ($1, $2, $3, $4) RETURNING id, username, email, name`,
        [username, input.email.toLowerCase(), input.name.trim(), password_hash]
      );
      const user = userRes.rows[0];
      const teamRes = await client.query(
        `INSERT INTO teams (team_code, name, plan_id, created_by)
         VALUES ($1, $2, $3, $4) RETURNING id, team_code, name, plan_id`,
        [teamCode, input.teamName.trim(), input.planId, user.id]
      );
      const team = teamRes.rows[0];
      await client.query(
        `INSERT INTO team_members (team_id, user_id, role, status) VALUES ($1, $2, 'admin', 'active')`,
        [team.id, user.id]
      );
      const token = generateSessionToken();
      const token_hash = await hashToken(token);
      await client.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [user.id, token_hash, sessionExpiry()]
      );
      await client.query("COMMIT");
      return {
        user: { id: user.id, username: user.username, email: user.email, name: user.name },
        team: { id: team.id, teamCode: team.team_code, name: team.name, planId: team.plan_id },
        sessionToken: token,
      };
    } catch (e: unknown) {
      await client.query("ROLLBACK");
      const pe = e as { code?: string };
      if (pe.code === "23505") throw err("VALIDATION_FAILED", "Email already registered", { field: "email" });
      throw e;
    } finally {
      client.release();
    }
  },

  async signIn(input) {
    const db = getPool();
    const userRes = await db.query(
      `SELECT id, username, email, name, password_hash FROM users WHERE lower(email) = lower($1)`,
      [input.email]
    );
    if (userRes.rowCount === 0) return null;
    const user = userRes.rows[0];
    if (!(await verifyPassword(input.password, user.password_hash))) return null;
    const token = generateSessionToken();
    const token_hash = await hashToken(token);
    await db.query(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
      user.id,
      token_hash,
      sessionExpiry(),
    ]);
    const teams = await this.listUserTeams(user.id);
    return {
      user: { id: user.id, username: user.username, email: user.email, name: user.name },
      sessionToken: token,
      teams,
    };
  },

  async resolveSession(token) {
    const db = getPool();
    const token_hash = await hashToken(token);
    const res = await db.query(
      `SELECT s.id AS session_id, u.id, u.username, u.email, u.name
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [token_hash]
    );
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    return {
      user: { id: r.id, username: r.username, email: r.email, name: r.name },
      sessionId: r.session_id,
    };
  },

  async revokeSession(token) {
    const db = getPool();
    await db.query(
      `UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [await hashToken(token)]
    );
  },

  async joinTeam(input) {
    const db = getPool();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const teamRes = await client.query(
        `SELECT id, team_code, name, plan_id FROM teams WHERE upper(team_code) = upper($1) FOR UPDATE`,
        [input.teamCode]
      );
      if (teamRes.rowCount === 0) throw err("TEAM_NOT_FOUND", "Team not found");
      const team = teamRes.rows[0];
      const existing = await client.query(
        `SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'active'`,
        [team.id, input.userId]
      );
      if ((existing.rowCount ?? 0) > 0) {
        await client.query("COMMIT");
        return {
          team: { id: team.id, teamCode: team.team_code, name: team.name, planId: team.plan_id },
          role: "member" as const,
        };
      }
      const countRes = await client.query(
        `SELECT count(*)::int AS c FROM team_members WHERE team_id = $1 AND status = 'active'`,
        [team.id]
      );
      if (!planAllowsNewMember(team.plan_id, countRes.rows[0].c)) {
        throw err("TEAM_CAPACITY_REACHED", "Team has reached its member limit");
      }
      await client.query(
        `INSERT INTO team_members (team_id, user_id, role, status)
         VALUES ($1, $2, 'member', 'active')
         ON CONFLICT (team_id, user_id) DO UPDATE SET status = 'active', role = 'member', removed_at = NULL`,
        [team.id, input.userId]
      );
      await client.query("COMMIT");
      return {
        team: { id: team.id, teamCode: team.team_code, name: team.name, planId: team.plan_id },
        role: "member",
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async listUserTeams(userId) {
    const db = getPool();
    const res = await db.query(
      `SELECT t.id, t.team_code, t.name, t.plan_id, m.role
       FROM team_members m JOIN teams t ON t.id = m.team_id
       WHERE m.user_id = $1 AND m.status = 'active'`,
      [userId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      teamCode: r.team_code,
      name: r.name,
      planId: r.plan_id,
      role: r.role,
    }));
  },

  async getMembership(userId, teamIdOrCode) {
    const db = getPool();
    const res = await db.query(
      `SELECT t.id, t.team_code, t.name, t.plan_id, m.role, m.id AS member_id
       FROM teams t
       JOIN team_members m ON m.team_id = t.id AND m.user_id = $1 AND m.status = 'active'
       WHERE t.id::text = $2 OR upper(t.team_code) = upper($2)`,
      [userId, teamIdOrCode]
    );
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    const perms = mem.permissions.get(String(r.member_id));
    return {
      teamId: r.id,
      teamCode: r.team_code,
      teamName: r.name,
      planId: r.plan_id,
      role: r.role,
      memberId: r.member_id,
      permissions: perms ? [...perms] : [],
    };
  },

  async createDatabase(input) {
    // For PG path: metadata only (physical CREATE DATABASE can be added later)
    const membership = await this.getMembership(input.userId, input.teamId);
    if (!membership) throw err("FORBIDDEN", "Not a team member");
    if (membership.role !== "admin") throw err("FORBIDDEN", "Only admins can create databases");
    const name = input.name.trim();
    if (!name || name.length > 64) throw err("VALIDATION_FAILED", "Invalid database name", { field: "name" });

    const db = getPool();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const countRes = await client.query(
        `SELECT count(*)::int AS c FROM databases WHERE team_id = $1 AND status <> 'deleted'`,
        [membership.teamId]
      );
      if (!planAllowsNewDatabase(membership.planId, countRes.rows[0].c)) {
        throw err("DB_LIMIT_REACHED", "Plan database limit reached");
      }
      let dbCode = "";
      for (let i = 0; i < 12; i++) {
        dbCode = generateShortId(5);
        const r = await client.query(`SELECT 1 FROM databases WHERE db_code = $1`, [dbCode]);
        if (r.rowCount === 0) break;
        if (i === 11) throw new Error("SHORT_ID_COLLISION");
      }
      const authKey = generateAuthKey();
      const auth_key_hash = await hashToken(authKey);
      const hint = authKey.slice(-4);
      const ins = await client.query(
        `INSERT INTO databases (db_code, team_id, name, status, pg_database_name, created_by)
         VALUES ($1, $2, $3, 'active', $4, $5)
         RETURNING id, db_code, team_id, name, status, schema_version, created_at`,
        [dbCode, membership.teamId, name, `dt_${dbCode.toLowerCase()}`, input.userId]
      );
      const row = ins.rows[0];
      await client.query(
        `INSERT INTO database_credentials (database_id, auth_key_hash, auth_key_hint)
         VALUES ($1, $2, $3)`,
        [row.id, auth_key_hash, hint]
      );
      await client.query("COMMIT");
      // Provision physical target DB when TARGET_ADMIN_URL is configured
      if (isTargetPgEnabled()) {
        try {
          await provisionTargetDatabase(dbCode, authKey);
        } catch (e) {
          // best-effort cleanup of control-plane rows
          await db.query(`UPDATE databases SET status = 'failed' WHERE id = $1`, [row.id]).catch(() => {});
          const msg = e instanceof Error ? e.message : "Postgres provision failed";
          throw err("PROVISION_FAILED", msg);
        }
      }
      const creds = buildDatabaseCredentials(row.db_code, authKey);
      // Creator admin gets key tip from first create
      if (!mem.personalKeyHints) {
        (mem as { personalKeyHints: Map<string, string> }).personalKeyHints = new Map();
      }
      mem.personalKeyHints.set(`${row.id}:${input.userId}`, hint);
      return {
        database: {
          id: row.id,
          dbCode: row.db_code,
          teamId: row.team_id,
          name: row.name,
          status: row.status,
          schemaVersion: row.schema_version,
          createdAt: new Date(row.created_at).toISOString(),
          authKeyHint: hint,
        },
        authKey,
        connectionUrl: creds.connectionUrl,
        host: creds.host,
        port: creds.port,
        pgDatabase: creds.database,
        pgUser: creds.user,
        apiBase: creds.apiBase,
      };
    } catch (e: unknown) {
      await client.query("ROLLBACK");
      const pe = e as { code?: string };
      if (pe.code === "23505") throw err("VALIDATION_FAILED", "Database name already exists", { field: "name" });
      throw e;
    } finally {
      client.release();
    }
  },

  async listDatabases(input) {
    const membership = await this.getMembership(input.userId, input.teamId);
    if (!membership) throw err("FORBIDDEN", "Not a team member");
    const db = getPool();
    const res = await db.query(
      `SELECT d.id, d.db_code, d.team_id, d.name, d.status, d.schema_version, d.created_at,
              c.auth_key_hint AS shared_hint
       FROM databases d
       LEFT JOIN LATERAL (
         SELECT auth_key_hint FROM database_credentials
         WHERE database_id = d.id AND revoked_at IS NULL
         ORDER BY created_at DESC LIMIT 1
       ) c ON true
       WHERE d.team_id = $1 AND d.status <> 'deleted'
       ORDER BY d.name`,
      [membership.teamId]
    );
    if (!mem.personalKeyHints) {
      (mem as { personalKeyHints: Map<string, string> }).personalKeyHints = new Map();
    }
    return res.rows.map((r) => {
      let hint = mem.personalKeyHints.get(`${r.id}:${input.userId}`);
      // Admin always has a key tip from create — seed from shared credential if missing
      if (!hint && membership.role === "admin" && r.shared_hint != null && r.shared_hint !== "") {
        const seeded = String(r.shared_hint);
        hint = seeded;
        mem.personalKeyHints.set(`${r.id}:${input.userId}`, seeded);
      }
      return {
        id: r.id,
        dbCode: r.db_code,
        teamId: r.team_id,
        name: r.name,
        status: r.status,
        schemaVersion: r.schema_version,
        createdAt: new Date(r.created_at).toISOString(),
        authKeyHint: hint,
      };
    });
  },

  async getDatabase(input) {
    const db = getPool();
    const res = await db.query(
      `SELECT d.id, d.db_code, d.team_id, d.name, d.status, d.schema_version, d.created_at
       FROM databases d
       WHERE d.id = $1 AND d.status <> 'deleted'`,
      [input.databaseId]
    );
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    const membership = await this.getMembership(input.userId, r.team_id);
    if (!membership) return null;
    let hint = mem.personalKeyHints?.get(`${r.id}:${input.userId}`);
    if (!hint && membership.role === "admin") {
      for (const c of mem.credentials.values()) {
        if (c.database_id === r.id && !c.revoked_at) {
          hint = c.auth_key_hint;
          if (hint) {
            if (!mem.personalKeyHints) {
              (mem as { personalKeyHints: Map<string, string> }).personalKeyHints = new Map();
            }
            mem.personalKeyHints.set(`${r.id}:${input.userId}`, hint);
          }
          break;
        }
      }
    }
    return {
      id: r.id,
      dbCode: r.db_code,
      teamId: r.team_id,
      name: r.name,
      status: r.status,
      schemaVersion: r.schema_version,
      createdAt: new Date(r.created_at).toISOString(),
      authKeyHint: hint,
    };
  },

  async rotateAuthKey(input) {
    const existing = await this.getDatabase(input);
    if (!existing) throw err("DB_NOT_FOUND", "Database not found");
    const membership = await this.getMembership(input.userId, existing.teamId);
    if (!membership || membership.role !== "admin") throw err("FORBIDDEN", "Only admins can rotate credentials");
    const db = getPool();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE database_credentials SET revoked_at = now()
         WHERE database_id = $1 AND revoked_at IS NULL`,
        [input.databaseId]
      );
      const authKey = generateAuthKey();
      const hint = authKey.slice(-4);
      await client.query(
        `INSERT INTO database_credentials (database_id, auth_key_hash, auth_key_hint)
         VALUES ($1, $2, $3)`,
        [input.databaseId, await hashToken(authKey), hint]
      );
      await client.query(`UPDATE databases SET updated_at = now() WHERE id = $1`, [input.databaseId]);
      await client.query("COMMIT");
      const drow = await client.query(`SELECT db_code FROM databases WHERE id = $1`, [input.databaseId]);
      const code = drow.rows[0]?.db_code ?? "XXXXX";
      const creds = buildDatabaseCredentials(code, authKey);
      return {
        authKey,
        authKeyHint: hint,
        connectionUrl: creds.connectionUrl,
        host: creds.host,
        port: creds.port,
        pgDatabase: creds.database,
        pgUser: creds.user,
        apiBase: creds.apiBase,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async deleteDatabase(input) {
    const existing = await this.getDatabase({ userId: input.userId, databaseId: input.databaseId });
    if (!existing) throw err("DB_NOT_FOUND", "Database not found");
    const membership = await this.getMembership(input.userId, existing.teamId);
    if (!membership || membership.role !== "admin") throw err("FORBIDDEN", "Only admins can delete databases");
    if (input.confirmName.trim() !== existing.name) {
      throw err("VALIDATION_FAILED", "Confirmation name does not match");
    }
    const db = getPool();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE databases SET status = 'deleted', deleted_at = now(), updated_at = now() WHERE id = $1`,
        [input.databaseId]
      );
      await client.query(
        `UPDATE database_credentials SET revoked_at = now() WHERE database_id = $1 AND revoked_at IS NULL`,
        [input.databaseId]
      );
      await client.query("COMMIT");
      return { ok: true as const };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },
};

export function getControlStore(): ControlStore {
  return process.env.DATABASE_URL ? pgStore : memoryStore;
}

export function usingMemoryStore(): boolean {
  return !process.env.DATABASE_URL;
}
