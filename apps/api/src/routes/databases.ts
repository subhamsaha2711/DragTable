import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { bindPgDatabase, unbindPgDatabase } from "@dragtable/target-db";
import { registerPgListenTarget } from "../lib/pg-listen.js";
import { ensureMemberPgRole, isTargetPgEnabled, pgSetTableLimit } from "@dragtable/target-pg";
import { planTableLimit } from "@dragtable/domain";
import { getControlStore } from "@dragtable/db-control";
import { requireUser } from "../lib/session.js";

const createBody = z.object({
  name: z.string().min(1).max(64),
});

const deleteBody = z.object({
  confirmName: z.string().min(1).max(64),
});

const databaseRoutes: FastifyPluginAsync = async (app) => {
  /** List databases for a team */
  app.get("/api/v1/teams/:teamId/databases", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { teamId } = req.params as { teamId: string };
    try {
      const list = await getControlStore().listDatabases({
        userId: session.user.id,
        teamId,
      });
      // Seed LISTEN + plan table-limit guard so external SQL cannot exceed plan
      const membership = await getControlStore().getMembership(session.user.id, teamId);
      const maxTables = membership?.planId
        ? planTableLimit(membership.planId as "personal" | "startup" | "enterprise")
        : 5;
      for (const db of list) {
        if (db.dbCode) {
          registerPgListenTarget(db.id, db.dbCode, { teamId: db.teamId, name: db.name });
          if (isTargetPgEnabled()) {
            void pgSetTableLimit(db.dbCode, maxTables).catch(() => {});
          }
        }
      }
      return { databases: list };
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === "FORBIDDEN") {
        return reply.status(403).send({ code: "FORBIDDEN", message: err.message ?? "Forbidden" });
      }
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not list databases" });
    }
  });

  /** Create database (admin only) */
  app.post("/api/v1/teams/:teamId/databases", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { teamId } = req.params as { teamId: string };
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        details: parsed.error.flatten(),
      });
    }
    try {
      const result = await getControlStore().createDatabase({
        userId: session.user.id,
        teamId,
        name: parsed.data.name,
      });
      if (result?.database?.id && result.database.dbCode) {
        bindPgDatabase(result.database.id, result.database.dbCode);
        registerPgListenTarget(result.database.id, result.database.dbCode, { teamId: result.database.teamId, name: result.database.name });
      }
      return result;
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === "FORBIDDEN") {
        return reply.status(403).send({ code: "FORBIDDEN", message: err.message ?? "Forbidden" });
      }
      if (err.code === "DB_LIMIT_REACHED") {
        return reply.status(403).send({
          code: "DB_LIMIT_REACHED",
          message: err.message ?? "Plan database limit reached",
        });
      }
      if (err.code === "VALIDATION_FAILED") {
        return reply.status(400).send({
          code: "VALIDATION_FAILED",
          message: err.message ?? "Validation failed",
        });
      }
      if (err.code === "PROVISION_FAILED") {
        return reply.status(503).send({
          code: "PROVISION_FAILED",
          message: err.message ?? "Could not provision Postgres database. Is TARGET_ADMIN_URL set and Postgres running?",
        });
      }
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not create database" });
    }
  });

  /** Get one database */
  app.get("/api/v1/databases/:databaseId", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId } = req.params as { databaseId: string };
    try {
      const database = await getControlStore().getDatabase({
        userId: session.user.id,
        databaseId,
      });
      if (!database) {
        return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
      }
      return { database };
    } catch (e) {
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not load database" });
    }
  });

  /** Rotate auth key (admin) */
  app.post("/api/v1/databases/:databaseId/rotate-key", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId } = req.params as { databaseId: string };
    try {
      const store = getControlStore();
      const db = await store.getDatabase({ userId: session.user.id, databaseId });
      const result = await store.rotateAuthKey({
        userId: session.user.id,
        databaseId,
      });
      if (db) {
        await store.notifyTeam({
          teamId: db.teamId,
          type: "AUTH_KEY_REVOKED",
          actorUserId: session.user.id,
          payload: {
            databaseId,
            databaseName: db.name,
            dbCode: db.dbCode,
            summary: `@${session.user.username} rotated auth key for ${db.name}`,
          },
        });
      }
      return result;
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === "FORBIDDEN") {
        return reply.status(403).send({ code: "FORBIDDEN", message: err.message ?? "Forbidden" });
      }
      if (err.code === "DB_NOT_FOUND") {
        return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
      }
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not rotate key" });
    }
  });

  /** Delete database (admin, confirm name) */
  app.post("/api/v1/databases/:databaseId/delete", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId } = req.params as { databaseId: string };
    const parsed = deleteBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "VALIDATION_FAILED", message: "confirmName required" });
    }
    try {
      const store = getControlStore();
      const before = await store.getDatabase({ userId: session.user.id, databaseId });
      await store.deleteDatabase({
        userId: session.user.id,
        databaseId,
        confirmName: parsed.data.confirmName,
      });
      if (before) {
        await store.notifyTeam({
          teamId: before.teamId,
          type: "DATABASE_DELETED",
          actorUserId: session.user.id,
          payload: {
            databaseId,
            databaseName: before.name,
            dbCode: before.dbCode,
            summary: `@${session.user.username} deleted database ${before.name}`,
          },
        });
      }
      return { ok: true };
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === "FORBIDDEN") {
        return reply.status(403).send({ code: "FORBIDDEN", message: err.message ?? "Forbidden" });
      }
      if (err.code === "DB_NOT_FOUND") {
        return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
      }
      if (err.code === "VALIDATION_FAILED") {
        return reply.status(400).send({
          code: "VALIDATION_FAILED",
          message: err.message ?? "Validation failed",
        });
      }
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not delete database" });
    }
  });

  /**
   * Personal Postgres connection for this user (RBAC via GRANTs).
   * Team shared auth key remains admin-level full access.
   * Members must use this personal URL for external IDE access.
   */
  app.post("/api/v1/databases/:databaseId/personal-connection", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId } = req.params as { databaseId: string };
    if (!isTargetPgEnabled()) {
      return reply.status(503).send({
        code: "PG_NOT_CONFIGURED",
        message: "TARGET_ADMIN_URL not set — real Postgres targets disabled",
      });
    }
    try {
      const store = getControlStore();
      const database = await store.getDatabase({ userId: session.user.id, databaseId });
      if (!database) {
        return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
      }
      const membership = await store.getMembership(session.user.id, database.teamId);
      if (!membership) {
        return reply.status(403).send({ code: "FORBIDDEN", message: "Not a team member" });
      }
      const password = `dtu_${crypto.randomUUID().replace(/-/g, "")}`;
      const fullAccess = membership.role === "admin";
      let permissions: string[] = [];
      const members = await store.listMembers({
        userId: session.user.id,
        teamId: database.teamId,
      });
      const self = members.find((m) => m.userId === session.user.id);
      if (self && Array.isArray(self.permissions)) {
        permissions = self.permissions;
      }
      // Identity for every external statement: Postgres role embeds userId (m_<db>_<userId>)
      const role = await ensureMemberPgRole({
        dbCode: database.dbCode,
        userId: session.user.id,
        password,
        permissions,
        fullAccess,
      });
      const hint = password.slice(-4);
      await store.setPersonalKeyHint({
        userId: session.user.id,
        databaseId: database.id,
        hint,
      });
      // Bind this PG role to the real user so external SQL history shows their username
      await store.registerPgActor({
        roleName: role.user,
        userId: session.user.id,
        username: session.user.username,
      });
      return {
        connectionUrl: role.connectionUrl,
        pgUser: role.user,
        password,
        authKey: password,
        authKeyHint: hint,
        userId: session.user.id,
        username: session.user.username,
        fullAccess,
        permissions: fullAccess ? ["*"] : permissions,
        note:
          "External access is sessionless. Your Postgres username embeds your userId; " +
          "every SQL statement is authorized by GRANTs matching your DragTable RBAC. " +
          "Do not use the shared team u_* auth key — that is admin-only full access.",
      };
    } catch (e: unknown) {
      req.log.error(e);
      const err = e as { message?: string; code?: string };
      return reply.status(500).send({
        code: err.code ?? "INTERNAL_ERROR",
        message: err.message ?? "Could not issue personal connection",
      });
    }
  });
};

export default databaseRoutes;
