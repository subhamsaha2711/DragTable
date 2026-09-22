import type { FastifyPluginAsync } from "fastify";

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    status: "ok",
    service: "dragtable-api",
    timestamp: new Date().toISOString(),
  }));

  app.get("/api/v1/status", async () => ({
    product: "DragTable",
    version: "0.1.0",
    phase: "bootstrap",
  }));
};

export default healthRoutes;
