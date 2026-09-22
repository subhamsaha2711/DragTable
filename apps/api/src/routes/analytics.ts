import type { FastifyPluginAsync } from "fastify";
import { getControlStore } from "@dragtable/db-control";
import { targetDb } from "@dragtable/target-db";
import {
  queryAnalytics,
  usageWarningLevel,
  recordMetricSync,
} from "@dragtable/analytics";
import { planTableLimit } from "@dragtable/domain";
import { requireUser } from "../lib/session.js";

async function authorizeDb(userId: string, databaseId: string) {
  const store = getControlStore();
  const database = await store.getDatabase({ userId, databaseId });
  if (!database) return null;
  const membership = await store.getMembership(userId, database.teamId);
  if (!membership) return null;
  return { database, membership };
}

const analyticsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/v1/databases/:databaseId/analytics?window=1h|1d|7d
   * Real metrics only — from server instrumentation.
   */
  app.get("/api/v1/databases/:databaseId/analytics", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session || "statusCode" in session) return;
    const { databaseId } = req.params as { databaseId: string };
    const q = req.query as { window?: string };
    const ctx = await authorizeDb(session.user.id, databaseId);
    if (!ctx) {
      return reply.status(404).send({ code: "DB_NOT_FOUND", message: "Database not found" });
    }

    // Do NOT record metrics for viewing analytics (would inflate charts)
    const summary = queryAnalytics(databaseId, q.window);

    const tables = targetDb.listTables(databaseId);
    const limit = planTableLimit(ctx.membership.planId);
    const tableCount = tables.length;
    const pct = limit != null && limit > 0 ? tableCount / limit : null;
    summary.usage = {
      tables: tableCount,
      tableLimit: limit,
      tablePct: pct != null ? Math.round(pct * 1000) / 10 : null,
      warningLevel: usageWarningLevel(tableCount, limit),
    };

    return {
      analytics: summary,
      database: {
        id: ctx.database.id,
        name: ctx.database.name,
        dbCode: ctx.database.dbCode,
      },
      planId: ctx.membership.planId,
      semantics: {
        read: "Successful table/row/audit/export list or get",
        write: "Successful insert/update/delete/schema/import mutation",
        latency: "Server handler duration in ms (network excluded)",
        buckets: "10-second aggregation, retained 7 days",
      },
    };
  });
};

export default analyticsRoutes;
