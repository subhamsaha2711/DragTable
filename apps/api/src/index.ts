import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Load monorepo-root .env into process.env (does not override existing vars). */
function loadRootEnv() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, "../../../.env"), // apps/api/src → monorepo root
      path.resolve(process.cwd(), ".env"),
      path.resolve(process.cwd(), "../../.env"),
    ];
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (key && process.env[key] === undefined) process.env[key] = val;
      }
      break;
    }
  } catch {
    /* non-fatal */
  }
}
loadRootEnv();

import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import authRoutes from "./routes/auth.js";
import databaseRoutes from "./routes/databases.js";
import workspaceRoutes from "./routes/workspace.js";
import teamsRoutes from "./routes/teams.js";
import analyticsRoutes from "./routes/analytics.js";
import wsRoutes from "./routes/ws.js";
import { usingMemoryStore } from "@dragtable/db-control";
import { isTargetPgEnabled } from "@dragtable/target-pg";

const app = Fastify({
  logger: true,
});

/**
 * Multi-device CORS (hackathon).
 * - Explicit CORS_ORIGINS always allowed
 * - localhost / 127.0.0.1 always allowed
 * - Private LAN origins (10/8, 172.16–31, 192.168/16) always allowed
 * - Set CORS_ALLOW_ALL=0 to disable the open fallback
 */
const defaultOrigins = [
  "http://127.0.0.1:3000",
  "http://localhost:3000",
];
const corsOrigins = (process.env.CORS_ORIGINS || defaultOrigins.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowAll = process.env.CORS_ALLOW_ALL !== "0";

function isPrivateLanOrigin(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    // Link-local / common dev hostnames
    if (hostname.endsWith(".local")) return true;
    return false;
  } catch {
    return false;
  }
}

await app.register(cors, {
  origin: (origin, cb) => {
    // Non-browser clients (curl, VS Code, native apps) send no Origin
    if (!origin) {
      cb(null, true);
      return;
    }
    if (corsOrigins.includes(origin) || isPrivateLanOrigin(origin) || allowAll) {
      // Reflect requesting origin so credentials (cookies) work cross-device
      cb(null, true);
      return;
    }
    cb(new Error(`CORS blocked for origin: ${origin}`), false);
  },
  credentials: true,
});
await app.register(cookie);
await app.register(websocket);

app.get("/health", async () => ({
  status: "ok",
  service: "dragtable-api",
  store: usingMemoryStore() ? "memory" : "postgres",
  targetPg: isTargetPgEnabled(),
  bind: process.env.HOST ?? "0.0.0.0",
  timestamp: new Date().toISOString(),
}));

app.get("/api/v1/status", async () => ({
  product: "DragTable",
  version: "0.7.2",
  phase: "multi-device",
  store: usingMemoryStore() ? "memory" : "postgres",
  targetPg: isTargetPgEnabled(),
  payments: "disabled",
  plans: "free-hackathon",
}));

await app.register(authRoutes);
await app.register(databaseRoutes);
await app.register(workspaceRoutes);
await app.register(teamsRoutes);
await app.register(analyticsRoutes);
await app.register(wsRoutes);

const port = Number(process.env.PORT ?? 3001);
// Listen on all interfaces so phones / other laptops on the LAN can reach the API
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  console.log(`DragTable API listening on http://${host}:${port}`);
  console.log(`WS: ws://<this-machine-ip>:${port}/ws/databases/:databaseId`);
  console.log(`Control store: ${usingMemoryStore() ? "memory+file" : "postgres"}`);
  console.log(
    `Target Postgres: ${isTargetPgEnabled() ? "ENABLED (TARGET_ADMIN_URL)" : "disabled (set TARGET_ADMIN_URL)"}`
  );
  console.log(
    `CORS: allowAll=${allowAll} explicit=[${corsOrigins.join(", ")}] + private LAN origins`
  );
  console.log(`Data dir: ${process.env.DATA_DIR || ".data (cwd)"}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
