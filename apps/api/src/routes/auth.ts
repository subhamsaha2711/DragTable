import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getControlStore, usingMemoryStore } from "@dragtable/db-control";
import {
  SESSION_COOKIE,
  setSessionCookie,
  clearSessionCookie,
  requireUser,
} from "../lib/session.js";

const createTeamBody = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  teamName: z.string().min(1).max(100),
  planId: z.enum(["personal", "startup", "enterprise"]),
});

const signInBody = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

const joinTeamBody = z.object({
  teamCode: z.string().length(5),
});

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/v1/auth/create-team", async (req, reply) => {
    const parsed = createTeamBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        details: parsed.error.flatten(),
      });
    }
    try {
      const store = getControlStore();
      const result = await store.createTeamAndAdmin(parsed.data);
      setSessionCookie(reply, result.sessionToken);
      return {
        user: result.user,
        team: result.team,
        store: usingMemoryStore() ? "memory" : "postgres",
      };
    } catch (e: unknown) {
      const err = e as { code?: string; field?: string; message?: string };
      if (err.code === "VALIDATION_FAILED") {
        return reply.status(400).send({
          code: "VALIDATION_FAILED",
          message: err.message ?? "Validation failed",
          details: { field: err.field },
        });
      }
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not create team" });
    }
  });

  app.post("/api/v1/auth/signin", async (req, reply) => {
    const parsed = signInBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "VALIDATION_FAILED", message: "Invalid input" });
    }
    try {
      const store = getControlStore();
      const result = await store.signIn(parsed.data);
      if (!result) {
        // Generic failure — do not reveal which field is wrong
        return reply.status(401).send({ code: "AUTH_INVALID", message: "Invalid email or password" });
      }
      setSessionCookie(reply, result.sessionToken);
      return { user: result.user, teams: result.teams };
    } catch (e) {
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Sign-in failed" });
    }
  });


  app.put("/api/v1/auth/profile", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const parsed = z.object({ name: z.string().min(1).max(100) }).safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "VALIDATION_FAILED", message: "Invalid name" });
    }
    try {
      const user = await getControlStore().updateProfile({
        userId: session.user.id,
        name: parsed.data.name,
      });
      return { user };
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === "VALIDATION_FAILED") {
        return reply.status(400).send({ code: "VALIDATION_FAILED", message: err.message });
      }
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not update profile" });
    }
  });

  app.post("/api/v1/auth/change-password", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const parsed = z
      .object({
        currentPassword: z.string().min(1).max(128),
        newPassword: z.string().min(8).max(128),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "VALIDATION_FAILED", message: "Invalid password payload" });
    }
    try {
      await getControlStore().changePassword({
        userId: session.user.id,
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
      });
      return { ok: true };
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === "AUTH_INVALID") {
        return reply.status(401).send({ code: "AUTH_INVALID", message: err.message ?? "Current password is incorrect" });
      }
      if (err.code === "VALIDATION_FAILED") {
        return reply.status(400).send({ code: "VALIDATION_FAILED", message: err.message });
      }
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not change password" });
    }
  });


  app.get("/api/v1/auth/api-tokens", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const tokens = await getControlStore().listUserApiTokens(session.user.id);
    return { tokens };
  });

  app.post("/api/v1/auth/api-tokens", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const name = (req.body as { name?: string })?.name;
    try {
      const result = await getControlStore().createUserApiToken({
        userId: session.user.id,
        name,
      });
      return result;
    } catch (e) {
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not create token" });
    }
  });

  app.delete("/api/v1/auth/api-tokens/:tokenId", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { tokenId } = req.params as { tokenId: string };
    try {
      await getControlStore().revokeUserApiToken({ userId: session.user.id, tokenId });
      return { ok: true };
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === "VALIDATION_FAILED") {
        return reply.status(400).send({ code: "VALIDATION_FAILED", message: err.message });
      }
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not revoke token" });
    }
  });

  app.post("/api/v1/auth/signout", async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      try {
        await getControlStore().revokeSession(token);
      } catch {
        /* ignore */
      }
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/v1/auth/me", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const teams = await getControlStore().listUserTeams(session.user.id);
    return { user: session.user, teams, store: usingMemoryStore() ? "memory" : "postgres" };
  });


  const registerAndJoinBody = z.object({
    name: z.string().min(1).max(100),
    email: z.string().email().max(254),
    password: z.string().min(8).max(128),
    teamCode: z.string().length(5),
  });

  app.post("/api/v1/auth/register-and-join", async (req, reply) => {
    const parsed = registerAndJoinBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        details: parsed.error.flatten(),
      });
    }
    try {
      const store = getControlStore();
      const result = await store.registerAndJoin({
        ...parsed.data,
        teamCode: parsed.data.teamCode.toUpperCase(),
      });
      setSessionCookie(reply, result.sessionToken);
      return {
        user: result.user,
        team: result.team,
        role: result.role,
        store: usingMemoryStore() ? "memory" : "postgres",
      };
    } catch (e: unknown) {
      const err = e as { code?: string; field?: string; message?: string };
      if (err.code === "TEAM_NOT_FOUND") {
        return reply.status(404).send({ code: "TEAM_NOT_FOUND", message: "Team not found" });
      }
      if (err.code === "TEAM_CAPACITY_REACHED") {
        return reply.status(403).send({
          code: "TEAM_CAPACITY_REACHED",
          message: "Team has reached its member limit for the current plan",
        });
      }
      if (err.code === "VALIDATION_FAILED") {
        return reply.status(400).send({
          code: "VALIDATION_FAILED",
          message: err.message ?? "Validation failed",
          details: { field: err.field },
        });
      }
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not join team" });
    }
  });

  app.post("/api/v1/teams/join", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const parsed = joinTeamBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "VALIDATION_FAILED", message: "Invalid team code" });
    }
    try {
      const result = await getControlStore().joinTeam({
        userId: session.user.id,
        teamCode: parsed.data.teamCode.toUpperCase(),
      });
      return result;
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === "TEAM_NOT_FOUND") {
        return reply.status(404).send({ code: "TEAM_NOT_FOUND", message: "Team not found" });
      }
      if (err.code === "TEAM_CAPACITY_REACHED") {
        return reply.status(403).send({
          code: "TEAM_CAPACITY_REACHED",
          message: "Team has reached its member limit for the current plan",
        });
      }
      req.log.error(e);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Could not join team" });
    }
  });
};

export default authRoutes;
