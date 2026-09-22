import type { FastifyRequest, FastifyReply } from "fastify";
import { getControlStore } from "@dragtable/db-control";

export const SESSION_COOKIE = "dt_session";

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 14 * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/**
 * Auth via HttpOnly session cookie OR Authorization: Bearer <user_api_token>.
 * Bearer tokens are user-scoped — RBAC still enforced per request via membership checks.
 */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const store = getControlStore();

  // 1) Bearer user API token (external IDE / scripts)
  const auth = req.headers.authorization;
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    const raw = auth.slice(7).trim();
    if (raw.startsWith("dtu_")) {
      const resolved = await store.resolveApiToken(raw);
      if (!resolved) {
        return reply.status(401).send({ code: "AUTH_EXPIRED", message: "Invalid or revoked API token" });
      }
      return { user: resolved.user, sessionId: `token:${resolved.tokenId}`, via: "api_token" as const };
    }
  }

  // 2) Session cookie (browser)
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    return reply.status(401).send({ code: "AUTH_EXPIRED", message: "Authentication required" });
  }
  const session = await store.resolveSession(token);
  if (!session) {
    clearSessionCookie(reply);
    return reply.status(401).send({ code: "AUTH_EXPIRED", message: "Session expired or invalid" });
  }
  return { ...session, via: "session" as const };
}
