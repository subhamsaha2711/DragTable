import fs from "node:fs";
import path from "node:path";

export type MetricKind = "read" | "write" | "meta";

export type WindowId = "1h" | "1d" | "7d";

interface Bucket {
  t: number;
  reads: number;
  writes: number;
  meta: number;
  latencySum: number;
  latencyCount: number;
  latencyMax: number;
}

const BUCKET_MS = 10_000;
const RETAIN_MS = 7 * 24 * 60 * 60 * 1000;

const series = new Map<string, Bucket[]>();

function dataDir(): string {
  return process.env.DATA_DIR || path.resolve(process.cwd(), ".data");
}

function align(ts: number): number {
  return Math.floor(ts / BUCKET_MS) * BUCKET_MS;
}

function ensureSeries(databaseId: string): Bucket[] {
  let list = series.get(databaseId);
  if (!list) {
    list = [];
    series.set(databaseId, list);
  }
  return list;
}

function prune(list: Bucket[], now: number) {
  const cutoff = now - RETAIN_MS;
  while (list.length && list[0]!.t < cutoff) list.shift();
}

function getOrCreateBucket(databaseId: string, now = Date.now()): Bucket {
  const list = ensureSeries(databaseId);
  prune(list, now);
  const t = align(now);
  const last = list[list.length - 1];
  if (last && last.t === t) return last;
  const b: Bucket = {
    t,
    reads: 0,
    writes: 0,
    meta: 0,
    latencySum: 0,
    latencyCount: 0,
    latencyMax: 0,
  };
  list.push(b);
  return b;
}

const STORE_VERSION = 2;

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      const dir = dataDir();
      fs.mkdirSync(dir, { recursive: true });
      const obj: Record<string, Bucket[]> = {};
      for (const [id, list] of series) obj[id] = list;
      const file = path.join(dir, "analytics.json");
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify({ version: STORE_VERSION, series: obj }));
      fs.renameSync(tmp, file);
    } catch (e) {
      console.error("[analytics] persist failed", e);
    }
  }, 50);
}

function load() {
  const file = path.join(dataDir(), "analytics.json");
  if (!fs.existsSync(file)) return;
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    if (payload.version !== STORE_VERSION) {
      console.log(`[analytics] discarding store v${payload.version ?? 1} (need v${STORE_VERSION})`);
      series.clear();
      schedulePersist();
      return;
    }
    series.clear();
    for (const [id, list] of Object.entries(payload.series || {}) as [string, Bucket[]][]) {
      series.set(id, list);
    }
    console.log(`[analytics] restored from ${file}`);
  } catch (e) {
    console.error("[analytics] load failed", e);
  }
}

load();

const READ_DEDUP_MS = 300;
const lastReadAt = new Map<string, number>();

export function recordMetric(
  databaseId: string,
  kind: MetricKind,
  latencyMs: number
): void {
  if (!databaseId) return;
  if (kind === "read") {
    const now = Date.now();
    const prev = lastReadAt.get(databaseId) ?? 0;
    if (now - prev < READ_DEDUP_MS) {
      const b = getOrCreateBucket(databaseId, now);
      const lat = Math.max(0, Math.round(latencyMs));
      if (lat > 0) {
        b.latencySum += lat;
        b.latencyCount += 1;
        if (lat > b.latencyMax) b.latencyMax = lat;
        schedulePersist();
      }
      return;
    }
    lastReadAt.set(databaseId, now);
  }
  const b = getOrCreateBucket(databaseId);
  if (kind === "read") b.reads += 1;
  else if (kind === "write") b.writes += 1;
  else b.meta += 1;
  const lat = Math.max(0, Math.round(latencyMs));
  b.latencySum += lat;
  b.latencyCount += 1;
  if (lat > b.latencyMax) b.latencyMax = lat;
  schedulePersist();
}

export async function timedMetric<T>(
  databaseId: string,
  kind: MetricKind,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  const result = await fn();
  recordMetric(databaseId, kind, Date.now() - start);
  return result;
}

export function recordMetricSync(
  databaseId: string,
  kind: MetricKind,
  startMs: number
): void {
  recordMetric(databaseId, kind, Date.now() - startMs);
}

const WINDOW_MS: Record<WindowId, number> = {
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export interface AnalyticsPoint {
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
}

export interface AnalyticsSummary {
  databaseId: string;
  window: WindowId;
  windowMs: number;
  generatedAt: string;
  totalReads: number;
  totalWrites: number;
  totalCalls: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  readsPerSec: number;
  writesPerSec: number;
  callsPerMin: number;
  points: AnalyticsPoint[];
  usage?: {
    tables: number;
    tableLimit: number | null;
    tablePct: number | null;
    warningLevel: "none" | "info" | "warning" | "high" | "limit";
  };
}

function windowId(raw: string | undefined): WindowId {
  if (raw === "1h" || raw === "7d" || raw === "1d") return raw;
  return "1d";
}

export function queryAnalytics(
  databaseId: string,
  window: string | undefined
): AnalyticsSummary {
  const w = windowId(window);
  const now = Date.now();
  const from = now - WINDOW_MS[w];
  const list = ensureSeries(databaseId).filter((b) => b.t >= from);

  const step =
    w === "1h" ? BUCKET_MS : w === "1d" ? 60_000 : 10 * 60_000;

  const byStep = new Map<number, Bucket>();
  for (const b of list) {
    const key = Math.floor(b.t / step) * step;
    let agg = byStep.get(key);
    if (!agg) {
      agg = {
        t: key,
        reads: 0,
        writes: 0,
        meta: 0,
        latencySum: 0,
        latencyCount: 0,
        latencyMax: 0,
      };
      byStep.set(key, agg);
    }
    agg.reads += b.reads;
    agg.writes += b.writes;
    agg.meta += b.meta;
    agg.latencySum += b.latencySum;
    agg.latencyCount += b.latencyCount;
    if (b.latencyMax > agg.latencyMax) agg.latencyMax = b.latencyMax;
  }

  const points: AnalyticsPoint[] = [...byStep.values()]
    .sort((a, b) => a.t - b.t)
    .map((b) => {
      const calls = b.reads + b.writes + b.meta;
      const sec = step / 1000;
      const latencyAvg = b.latencyCount ? b.latencySum / b.latencyCount : 0;
      return {
        t: new Date(b.t).toISOString(),
        ts: b.t,
        reads: b.reads,
        writes: b.writes,
        calls,
        latencyAvg: Math.round(latencyAvg * 100) / 100,
        latencyMax: b.latencyMax,
        readsPerSec: Math.round((b.reads / sec) * 1000) / 1000,
        writesPerSec: Math.round((b.writes / sec) * 1000) / 1000,
        callsPerMin: Math.round((calls / (step / 60000)) * 100) / 100,
      };
    });

  let totalReads = 0;
  let totalWrites = 0;
  let totalCalls = 0;
  let latSum = 0;
  let latCount = 0;
  let maxLat = 0;
  for (const b of list) {
    totalReads += b.reads;
    totalWrites += b.writes;
    totalCalls += b.reads + b.writes + b.meta;
    latSum += b.latencySum;
    latCount += b.latencyCount;
    if (b.latencyMax > maxLat) maxLat = b.latencyMax;
  }

  const lastMin = list.filter((b) => b.t >= now - 60_000);
  let r = 0;
  let wcount = 0;
  let c = 0;
  for (const b of lastMin) {
    r += b.reads;
    wcount += b.writes;
    c += b.reads + b.writes + b.meta;
  }

  return {
    databaseId,
    window: w,
    windowMs: WINDOW_MS[w],
    generatedAt: new Date().toISOString(),
    totalReads,
    totalWrites,
    totalCalls,
    avgLatencyMs: latCount ? Math.round((latSum / latCount) * 100) / 100 : 0,
    maxLatencyMs: maxLat,
    readsPerSec: Math.round((r / 60) * 1000) / 1000,
    writesPerSec: Math.round((wcount / 60) * 1000) / 1000,
    callsPerMin: c,
    points,
  };
}

export function wipeAnalytics(databaseId: string): void {
  series.delete(databaseId);
  schedulePersist();
}

export const USAGE_THRESHOLDS = {
  info: 0.5,
  warning: 0.75,
  high: 0.9,
  limit: 1.0,
} as const;

export function usageWarningLevel(
  used: number,
  limit: number | null
): "none" | "info" | "warning" | "high" | "limit" {
  if (limit == null || limit <= 0) return "none";
  const pct = used / limit;
  if (pct >= USAGE_THRESHOLDS.limit) return "limit";
  if (pct >= USAGE_THRESHOLDS.high) return "high";
  if (pct >= USAGE_THRESHOLDS.warning) return "warning";
  if (pct >= USAGE_THRESHOLDS.info) return "info";
  return "none";
}
