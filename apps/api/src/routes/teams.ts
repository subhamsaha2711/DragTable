import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getControlStore } from "@dragtable/db-control";
import { requireUser } from "../lib/session.js";
import {
  applyMemberPgGrants,
  dropMemberPgRole,
  isTargetPgEnabled,
} from "@dragtable/target-pg";

const permsBody = z.object({
  permissions: z.array(z.string()),
});

const teamsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/teams/:teamId/members", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { teamId } = req.params as { teamId: string };
    try {
      const members = await getControlStore().listMembers({
        userId: session.user.id,
        teamId,
      });
      return { members };
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === "FORBIDDEN") {
        return reply.status(403).send({ code: "FORBIDDEN", message: err.message });
      }
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not list members" });
    }
  });

  app.post("/api/v1/teams/:teamId/members/:memberUserId/remove", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { teamId, memberUserId } = req.params as { teamId: string; memberUserId: string };
    try {
      await getControlStore().removeMember({
        actorUserId: session.user.id,
        teamId,
        memberUserId,
      });
      // Revoke external IDE access immediately (no session — PG role is identity)
      if (isTargetPgEnabled()) {
        try {
          const dbs = await getControlStore().listDatabases({
            userId: session.user.id,
            teamId,
          });
          for (const db of dbs) {
            await dropMemberPgRole(db.dbCode, memberUserId).catch((e: unknown) =>
              req.log.error(e)
            );
          }
        } catch (e: unknown) {
          req.log.error(e);
        }
      }
      return { ok: true };
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === "FORBIDDEN") {
        return reply.status(403).send({ code: "FORBIDDEN", message: err.message });
      }
      if (err.code === "VALIDATION_FAILED") {
        return reply.status(400).send({ code: "VALIDATION_FAILED", message: err.message });
      }
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not remove member" });
    }
  });

  app.put("/api/v1/teams/:teamId/members/:memberUserId/permissions", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { teamId, memberUserId } = req.params as { teamId: string; memberUserId: string };
    const parsed = permsBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "VALIDATION_FAILED", message: "Invalid permissions" });
    }
    try {
      const result = await getControlStore().setMemberPermissions({
        actorUserId: session.user.id,
        teamId,
        memberUserId,
        permissions: parsed.data.permissions,
      });
      // Enforce new RBAC on existing personal Postgres roles (checked on every SQL statement)
      if (isTargetPgEnabled()) {
        try {
          const dbs = await getControlStore().listDatabases({
            userId: session.user.id,
            teamId,
          });
          for (const db of dbs) {
            await applyMemberPgGrants({
              dbCode: db.dbCode,
              userId: memberUserId,
              permissions: result.permissions ?? parsed.data.permissions,
              fullAccess: false,
            }).catch((e) => req.log.error(e));
          }
        } catch (e) {
          req.log.error(e);
        }
      }
      return result;
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === "FORBIDDEN") {
        return reply.status(403).send({ code: "FORBIDDEN", message: err.message });
      }
      if (err.code === "VALIDATION_FAILED") {
        return reply.status(400).send({ code: "VALIDATION_FAILED", message: err.message });
      }
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not update permissions" });
    }
  });

  app.get("/api/v1/teams/:teamId/notifications", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { teamId } = req.params as { teamId: string };
    try {
      const notifications = await getControlStore().listNotifications({
        userId: session.user.id,
        teamId,
      });
      return { notifications };
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === "FORBIDDEN") {
        return reply.status(403).send({ code: "FORBIDDEN", message: err.message });
      }
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not load notifications" });
    }
  });
};

export default teamsRoutes;
