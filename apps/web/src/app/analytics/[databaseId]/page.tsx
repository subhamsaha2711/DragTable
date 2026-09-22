"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { IconActivity, IconArrowLeft, IconLoader, IconZap } from "@/components/icons";

type WindowId = "1h" | "1d" | "7d";

type Point = {
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
};

type Analytics = {
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
 points: Point[];
 usage?: {
 tables: number;
 tableLimit: number | null;
 tablePct: number | null;
 warningLevel: string;
 };
};

function LineChart({
 points,
 series,
 height = 200,
}: {
 points: Point[];
 series: Array<{ key: keyof Point; color: string; label: string }>;
 height?: number;
}) {
 const [hover, setHover] = useState<number | null>(null);
 const uid = useId();
 const width = 640;
 const pad = { t: 16, r: 12, b: 28, l: 40 };
 const innerW = width - pad.l - pad.r;
 const innerH = height - pad.t - pad.b;

 const maxY = useMemo(() => {
 let m = 1;
 for (const p of points) {
 for (const s of series) {
 const v = Number(p[s.key]);
 if (v > m) m = v;
 }
 }
 return m;
 }, [points, series]);

 const pathFor = (key: keyof Point) => {
 if (!points.length) return "";
 return points
 .map((p, i) => {
 const x = pad.l + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
 const y = pad.t + innerH - (Number(p[key]) / maxY) * innerH;
 return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
 })
 .join("");
 };

 const areaFor = (key: keyof Point, gradId: string) => {
 if (points.length < 2) return null;
 const line = pathFor(key);
 const lastX = pad.l + innerW;
 const firstX = pad.l;
 const base = pad.t + innerH;
 return <path d={`${line} L${lastX},${base} L${firstX},${base} Z`} fill={`url(#${gradId})`} />;
 };

 return (
 <div className="dt-anim-fade relative w-full overflow-x-auto">
 <svg
 viewBox={`0 0 ${width} ${height}`}
 className="w-full max-w-full"
 onMouseLeave={() => setHover(null)}
 >
 <defs>
 {series.map((s) => (
 <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
 <stop offset="0%" stopColor={s.color} stopOpacity={0.32} />
 <stop offset="100%" stopColor={s.color} stopOpacity={0} />
 </linearGradient>
 ))}
 </defs>
 {/* grid */}
 {[0, 0.25, 0.5, 0.75, 1].map((f) => {
 const y = pad.t + innerH * (1 - f);
 return (
 <g key={f}>
 <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
 <text x={4} y={y + 3} fill="rgba(255,255,255,0.28)" fontSize={9}>
 {Math.round(maxY * f)}
 </text>
 </g>
 );
 })}
 {series.map((s) => (
 <g key={s.key}>
 {areaFor(s.key, `${uid}-${s.key}`)}
 <path
 d={pathFor(s.key)}
 fill="none"
 stroke={s.color}
 strokeWidth={2.25}
 strokeLinejoin="round"
 strokeLinecap="round"
 />
 </g>
 ))}
 {/* hover points */}
 {points.map((p, i) => {
 const x = pad.l + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
 return (
 <rect
 key={p.ts}
 x={x - 6}
 y={pad.t}
 width={12}
 height={innerH}
 fill="transparent"
 onMouseEnter={() => setHover(i)}
 />
 );
 })}
 {hover != null && points[hover] && (
 <>
 <line
 x1={pad.l + (points.length === 1 ? innerW / 2 : (hover / (points.length - 1)) * innerW)}
 x2={pad.l + (points.length === 1 ? innerW / 2 : (hover / (points.length - 1)) * innerW)}
 y1={pad.t}
 y2={pad.t + innerH}
 stroke="rgba(255,255,255,0.32)"
 strokeDasharray="3 3"
 strokeWidth={1}
 />
 {series.map((s) => {
 const x = pad.l + (points.length === 1 ? innerW / 2 : (hover / (points.length - 1)) * innerW);
 const y = pad.t + innerH - (Number(points[hover]![s.key]) / maxY) * innerH;
 return (
 <circle
 key={s.key}
 cx={x}
 cy={y}
 r={4}
 fill={s.color}
 stroke="#000"
 strokeWidth={2}
 style={{ filter: `drop-shadow(0 0 5px ${s.color}90)` }}
 />
 );
 })}
 </>
 )}
 {/* x labels */}
 {points.length > 0 &&
 [0, Math.floor((points.length - 1) / 2), points.length - 1]
 .filter((v, i, a) => a.indexOf(v) === i)
 .map((i) => {
 const p = points[i]!;
 const x = pad.l + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
 const label = new Date(p.ts).toLocaleString(undefined, {
 month: "short",
 day: "numeric",
 hour: "2-digit",
 minute: "2-digit",
 });
 return (
 <text key={i} x={x} y={height - 8} textAnchor="middle" fill="rgba(255,255,255,0.28)" fontSize={9}>
 {label}
 </text>
 );
 })}
 </svg>
 {hover != null && points[hover] && (
 <div
 className="dt-glass dt-anim-pop pointer-events-none absolute right-2 top-2 rounded-[var(--r-md)] px-3.5 py-2.5 text-xs text-white"
 style={{ boxShadow: "var(--shadow-md)" }}
 >
 <p className="mb-1.5 text-[10px] text-[var(--text-quaternary)]">
 {new Date(points[hover].ts).toLocaleString()}
 </p>
 {series.map((s) => (
 <p key={s.key} className="flex items-center gap-2">
 <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
 {s.label}: <strong className="dt-mono font-semibold">{Number(points[hover][s.key]).toFixed(2)}</strong>
 </p>
 ))}
 </div>
 )}
 <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--text-tertiary)]">
 {series.map((s) => (
 <span key={s.key} className="inline-flex items-center gap-1.5">
 <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
 {s.label}
 </span>
 ))}
 </div>
 </div>
 );
}

function BarChart({ points, height = 180 }: { points: Point[]; height?: number }) {
 const [hover, setHover] = useState<number | null>(null);
 const width = 640;
 const pad = { t: 12, r: 12, b: 28, l: 40 };
 const innerW = width - pad.l - pad.r;
 const innerH = height - pad.t - pad.b;
 const maxY = Math.max(1, ...points.map((p) => p.calls));
 const barW = points.length ? Math.max(2, (innerW / points.length) * 0.7) : 4;

 return (
 <div className="dt-anim-fade relative w-full overflow-x-auto">
 <svg viewBox={`0 0 ${width} ${height}`} className="w-full" onMouseLeave={() => setHover(null)}>
 {[0, 0.5, 1].map((f) => {
 const y = pad.t + innerH * (1 - f);
 return (
 <line key={f} x1={pad.l} x2={width - pad.r} y1={y} y2={y} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
 );
 })}
 {points.map((p, i) => {
 const x =
 pad.l +
 (points.length === 1
 ? innerW / 2 - barW / 2
 : (i / Math.max(points.length - 1, 1)) * innerW - barW / 2);
 const h = (p.calls / maxY) * innerH;
 const y = pad.t + innerH - h;
 const readH = p.calls ? (p.reads / p.calls) * h : 0;
 const writeH = p.calls ? (p.writes / p.calls) * h : 0;
 const isHover = hover === i;
 return (
 <g
 key={p.ts}
 onMouseEnter={() => setHover(i)}
 style={{ transition: "opacity 150ms ease" }}
 opacity={hover == null || isHover ? 1 : 0.45}
 >
 <rect
 x={x}
 y={y + writeH + (h - readH - writeH)}
 width={barW}
 height={Math.max(0, readH)}
 fill="var(--blue)"
 rx={1.5}
 />
 <rect
 x={x}
 y={y + (h - writeH - readH > 0 ? h - writeH - (h - readH - writeH) : h - writeH)}
 width={barW}
 height={Math.max(0, writeH)}
 fill="var(--green)"
 rx={1.5}
 />
 <rect
 x={x}
 y={y}
 width={barW}
 height={Math.max(0, h - readH - writeH)}
 fill="rgba(255,255,255,0.22)"
 rx={1.5}
 />
 </g>
 );
 })}
 </svg>
 {hover != null && points[hover] && (
 <div
 className="dt-glass dt-anim-pop pointer-events-none absolute right-2 top-2 rounded-[var(--r-md)] px-3.5 py-2.5 text-xs text-white"
 style={{ boxShadow: "var(--shadow-md)" }}
 >
 <p className="text-[var(--text-secondary)]">
 Calls: <strong className="dt-mono text-white">{points[hover].calls}</strong>
 </p>
 <p style={{ color: "var(--blue-light)" }}>
 Reads: <strong className="dt-mono">{points[hover].reads}</strong>
 </p>
 <p style={{ color: "var(--green-light)" }}>
 Writes: <strong className="dt-mono">{points[hover].writes}</strong>
 </p>
 </div>
 )}
 </div>
 );
}

const WINDOWS: WindowId[] = ["1h", "1d", "7d"];

export default function AnalyticsPage() {
 const params = useParams();
 const databaseId = params.databaseId as string;
 const router = useRouter();
 const toast = useToast();
 const [windowId, setWindowId] = useState<WindowId>("1d");
 const [data, setData] = useState<Analytics | null>(null);
 const [dbName, setDbName] = useState("");
 const [planId, setPlanId] = useState("");
 const [loading, setLoading] = useState(true);

 const load = useCallback(async () => {
 const { data: res, error, status } = await api.getAnalytics(databaseId, windowId);
 if (status === 401) {
 router.replace("/signin");
 return;
 }
 if (error) {
 toast.error("Analytics failed", error.message);
 setLoading(false);
 return;
 }
 if (res) {
 setData(res.analytics);
 setDbName(res.database.name);
 setPlanId(res.planId);
 }
 setLoading(false);
 }, [databaseId, windowId, router, toast]);

 useEffect(() => {
 load();
 const id = window.setInterval(load, 5000);
 return () => clearInterval(id);
 }, [load]);

 const warnTone: "red" | "yellow" | "blue" | "neutral" =
 data?.usage?.warningLevel === "limit"
 ? "red"
 : data?.usage?.warningLevel === "high"
 ? "yellow"
 : data?.usage?.warningLevel === "warning"
 ? "yellow"
 : data?.usage?.warningLevel === "info"
 ? "blue"
 : "neutral";

 const STAT_CARDS = [
 {
 label: "Reads / sec",
 value: data?.readsPerSec ?? 0,
 sub: `${data?.totalReads ?? 0} total`,
 accent: "blue",
 },
 {
 label: "Writes / sec",
 value: data?.writesPerSec ?? 0,
 sub: `${data?.totalWrites ?? 0} total`,
 accent: "green",
 },
 {
 label: "Calls / min",
 value: data?.callsPerMin ?? 0,
 sub: `${data?.totalCalls ?? 0} in window`,
 accent: "blue",
 },
 {
 label: "Latency / call",
 value: `${data?.avgLatencyMs ?? 0} ms`,
 sub: `max ${data?.maxLatencyMs ?? 0} ms`,
 accent: "yellow",
 },
 ];

 return (
 <main className="dt-shell min-h-screen">
 <header className="dt-topbar !px-6">
 <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3">
 <div className="flex items-center gap-3">
 <BrandMark size={22} withWordmark={false} href="/dashboard" />
 <a href={`/workspace/${databaseId}`} className="dt-back-link">
 <span className="dt-back-chevron">
 <IconArrowLeft size={13} />
 </span>
 Workspace
 </a>
 <span className="dt-crumb-sep hidden sm:inline">/</span>
 <div className="hidden sm:block">
 <h1 className="flex items-center gap-1.5 text-[15px] font-semibold text-white">
 <IconActivity size={14} className="text-[var(--blue-light)]" />
 Analytics
 </h1>
 <p className="text-[11px] text-[var(--text-quaternary)]">{dbName || databaseId}</p>
 </div>
 </div>
 <div className="dt-seg" style={{ ["--n" as string]: WINDOWS.length }}>
 <div className="dt-seg-indicator" style={{ ["--i" as string]: WINDOWS.indexOf(windowId) }} />
 {WINDOWS.map((w) => (
 <button
 key={w}
 type="button"
 onClick={() => setWindowId(w)}
 className={`dt-seg-btn ${windowId === w ? "dt-seg-btn-active" : ""}`}
 >
 {w === "1h" ? "1 hour" : w === "1d" ? "1 day" : "7 days"}
 </button>
 ))}
 </div>
 </div>
 </header>

 <div className="mx-auto max-w-5xl space-y-6 px-6 py-9">
 {loading && !data ? (
 <div className="flex items-center gap-2 py-16 text-sm text-[var(--text-tertiary)]">
 <IconLoader size={14} />
 Loading real metrics…
 </div>
 ) : (
 <>
 <div className="dt-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
 {STAT_CARDS.map((c) => (
 <div
 key={c.label}
 className="dt-card rounded-[var(--r-lg)] p-4"
 style={{ borderTop: `2px solid var(--${c.accent})` }}
 >
 <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-quaternary)]">
 {c.accent === "yellow" && (
 <span style={{ color: "var(--yellow-light)" }}>
 <IconZap size={11} />
 </span>
 )}
 {c.label}
 </p>
 <p key={String(c.value)} className="dt-anim-pop mt-2 text-2xl font-semibold tracking-tight text-white">
 {c.value}
 </p>
 <p className="mt-1 text-xs text-[var(--text-quaternary)]">{c.sub}</p>
 </div>
 ))}
 </div>

 {data?.usage && (
 <div
 className={`dt-callout ${
 warnTone === "red"
 ? "dt-callout-danger"
 : warnTone === "yellow"
 ? "dt-callout-warn"
 : warnTone === "blue"
 ? "dt-callout-info"
 : ""
 }`}
 style={warnTone === "neutral" ? { borderColor: "var(--border)", background: "var(--surface-1)" } : undefined}
 >
 <span style={{ color: warnTone === "neutral" ? "var(--text-tertiary)" : undefined }}>
 <IconActivity size={15} />
 </span>
 <span className={warnTone === "neutral" ? "text-[var(--text-secondary)]" : ""}>
 <strong className="text-white">Table usage</strong>: {data.usage.tables}
 {data.usage.tableLimit != null ? ` / ${data.usage.tableLimit}` : ""} tables
 {data.usage.tablePct != null ? ` (${data.usage.tablePct}%)` : ""}
 {data.usage.warningLevel !== "none" && (
 <span className="ml-1.5 capitalize">· {data.usage.warningLevel} warning</span>
 )}
 <span className="ml-1.5 text-[var(--text-quaternary)]">· Plan: {planId}</span>
 </span>
 </div>
 )}

 <section className="dt-card rounded-[var(--r-lg)] p-5">
 <h2 className="mb-1 text-sm font-semibold text-white">Reads &amp; writes / sec</h2>
 <p className="mb-4 text-xs text-[var(--text-quaternary)]">
 Interactive · hover for exact values · server-instrumented only
 </p>
 {data && data.points.length > 0 ? (
 <LineChart
 points={data.points}
 series={[
 { key: "readsPerSec", color: "var(--blue)", label: "Reads/sec" },
 { key: "writesPerSec", color: "var(--green)", label: "Writes/sec" },
 ]}
 />
 ) : (
 <p className="py-12 text-center text-sm text-[var(--text-quaternary)]">
 No traffic in this window yet — open the workspace and edit data to generate metrics.
 </p>
 )}
 </section>

 <section className="dt-card rounded-[var(--r-lg)] p-5">
 <h2 className="mb-1 text-sm font-semibold text-white">Latency (ms avg)</h2>
 <p className="mb-4 text-xs text-[var(--text-quaternary)]">Server handler time · network hop excluded</p>
 {data && data.points.length > 0 ? (
 <LineChart
 points={data.points}
 series={[
 { key: "latencyAvg", color: "var(--blue)", label: "Avg latency ms" },
 { key: "latencyMax", color: "var(--yellow)", label: "Max latency ms" },
 ]}
 />
 ) : (
 <p className="py-8 text-center text-sm text-[var(--text-quaternary)]">No latency samples yet.</p>
 )}
 </section>

 <section className="dt-card rounded-[var(--r-lg)] p-5">
 <h2 className="mb-1 text-sm font-semibold text-white">Calls volume</h2>
 <p className="mb-4 flex flex-wrap items-center gap-3 text-xs text-[var(--text-quaternary)]">
 <span className="inline-flex items-center gap-1.5">
 <span className="h-2 w-2 rounded-full" style={{ background: "var(--blue)" }} />
 Reads
 </span>
 <span className="inline-flex items-center gap-1.5">
 <span className="h-2 w-2 rounded-full" style={{ background: "var(--green)" }} />
 Writes
 </span>
 <span className="inline-flex items-center gap-1.5">
 <span className="h-2 w-2 rounded-full bg-white/25" />
 Other
 </span>
 </p>
 {data && data.points.length > 0 ? (
 <BarChart points={data.points} />
 ) : (
 <p className="py-8 text-center text-sm text-[var(--text-quaternary)]">No calls yet.</p>
 )}
 </section>

 <p className="text-center text-[11px] text-[var(--text-quaternary)]">
 Updated {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : "—"} · auto-refresh 5s ·
 windows 1h / 1d / 7d
 </p>
 </>
 )}
 </div>
 </main>
 );
}
