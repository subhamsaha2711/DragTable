"use client";

import { useCallback, useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { useRouter } from "next/navigation";
import { api, type PublicDatabase } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Modal } from "@/lib/modal";
import { LoadingScreen } from "@/components/Loading";
import {
  IconActivity,
  IconArrowUpRight,
  IconBook,
  IconCopy,
  IconDatabase,
  IconDownload,
  IconKey,
  IconLoader,
  IconLogOut,
  IconPlus,
  IconSettings,
  IconTrash,
  IconUsers,
} from "@/components/icons";

type Team = {
 id: string;
 teamCode: string;
 name: string;
 planId: string;
 role: string;
};

type Me = {
 user: { id: string; username: string; email: string; name: string };
 teams: Team[];
 store: string;
};

export default function DashboardPage() {
 const router = useRouter();
 const toast = useToast();
 const [me, setMe] = useState<Me | null>(null);
 const [loading, setLoading] = useState(true);
 const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
 const [databases, setDatabases] = useState<PublicDatabase[]>([]);
 const [dbLoading, setDbLoading] = useState(false);

 const [createOpen, setCreateOpen] = useState(false);
 const [newDbName, setNewDbName] = useState("");
 const [creating, setCreating] = useState(false);

 const [keyReveal, setKeyReveal] = useState<{
 name: string;
 authKey: string;
 connectionUrl: string;
 } | null>(null);

 const [personalConn, setPersonalConn] = useState<{
 name: string;
 dbCode: string;
 connectionUrl: string;
 pgUser: string;
 password: string;
 fullAccess: boolean;
 note: string;
 } | null>(null);
 const [personalLoadingId, setPersonalLoadingId] = useState<string | null>(null);

 const [deleteTarget, setDeleteTarget] = useState<PublicDatabase | null>(null);
 const [confirmName, setConfirmName] = useState("");
 const [deleting, setDeleting] = useState(false);

 const activeTeam = me?.teams.find((t) => t.id === activeTeamId) ?? me?.teams[0] ?? null;

 const loadDatabases = useCallback(
 async (teamId: string) => {
 setDbLoading(true);
 const { data, error } = await api.listDatabases(teamId);
 setDbLoading(false);
 if (error) {
 toast.error("Could not load databases", error.message);
 return;
 }
 setDatabases(data?.databases ?? []);
 },
 [toast]
 );

 useEffect(() => {
 api.me().then(({ data, error, status }) => {
 setLoading(false);
 if (status === 401 || error) {
 router.replace("/signin");
 return;
 }
 if (data) {
 setMe(data);
 const prefer =
 typeof window !== "undefined"
 ? new URLSearchParams(window.location.search).get("team")
 : null;
 const pick =
 data.teams.find((t) => t.id === prefer || t.teamCode === prefer)?.id ??
 data.teams[0]?.id ??
 null;
 setActiveTeamId(pick);
 }
 });
 }, [router]);

 useEffect(() => {
 if (activeTeamId) loadDatabases(activeTeamId);
 }, [activeTeamId, loadDatabases]);

 // Live dashboard: pick up admin create/delete for other online members (~100ms)
 useEffect(() => {
 if (!activeTeamId) return;
 let alive = true;
 const tick = async () => {
 if (!alive) return;
 const { data, status } = await api.listDatabases(activeTeamId);
 if (!alive || status === 401 || !data) return;
 const next = data.databases ?? [];
 setDatabases((prev) => {
 const prevKey = prev.map((d) => `${d.id}:${d.status}:${d.name}`).join("|");
 const nextKey = next.map((d) => `${d.id}:${d.status}:${d.name}`).join("|");
 if (prevKey === nextKey) return prev;
 return next;
 });
 };
 const id = window.setInterval(tick, 100);
 return () => {
 alive = false;
 clearInterval(id);
 };
 }, [activeTeamId]);

 async function signOut() {
 await api.signOut();
 toast.info("Signed out");
 router.push("/");
 }

 async function onCreateDb(e: React.FormEvent) {
 e.preventDefault();
 if (!activeTeamId) return;
 setCreating(true);
 const { data, error } = await api.createDatabase(activeTeamId, newDbName.trim());
 setCreating(false);
 if (error) {
 toast.error("Create failed", error.message);
 return;
 }
 if (data) {
 setCreateOpen(false);
 setNewDbName("");
 setKeyReveal({
 name: data.database.name,
 authKey: data.authKey,
 connectionUrl: data.connectionUrl,
 });
 toast.success("Database created", data.database.dbCode);
 loadDatabases(activeTeamId);
 }
 }

 async function onRevokeKey(db: PublicDatabase) {
 setPersonalLoadingId(db.id);
 const { data, error } = await api.personalConnection(db.id);
 setPersonalLoadingId(null);
 if (error) {
 toast.error("Could not revoke key", error.message);
 return;
 }
 if (data) {
 setPersonalConn({
 name: db.name,
 dbCode: db.dbCode,
 connectionUrl: data.connectionUrl,
 pgUser: data.pgUser,
 password: data.password,
 fullAccess: data.fullAccess,
 note: data.note,
 });
 // Refresh card tip so Personal key ···XXXX updates for this user only
 if (activeTeamId) loadDatabases(activeTeamId);
 toast.success("Key revoked", "Previous personal password is invalid — copy the new credentials");
 }
 }

 async function onDelete() {
 if (!deleteTarget) return;
 setDeleting(true);
 const { error } = await api.deleteDatabase(deleteTarget.id, confirmName);
 setDeleting(false);
 if (error) {
 toast.error("Delete failed", error.message);
 return;
 }
 toast.success("Database deleted", deleteTarget.name);
 setDeleteTarget(null);
 setConfirmName("");
 if (activeTeamId) loadDatabases(activeTeamId);
 }

 function copyKey(key: string) {
 navigator.clipboard?.writeText(key).then(
 () => toast.success("Copied to clipboard"),
 () => toast.error("Could not copy")
 );
 }

 if (loading) {
 return <LoadingScreen label="Loading workspace…" />;
 }

 if (!me) return null;

 return (
 <main className="dt-shell min-h-screen">
 <header className="dt-topbar">
 <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
 <BrandMark size={24} />
 <div className="flex items-center gap-5 text-sm">
 <a href="/docs" className="hidden items-center gap-1.5 text-[var(--text-tertiary)] transition hover:text-white sm:flex">
 <IconBook size={14} />
 Docs
 </a>
 <span className="hidden text-[var(--text-secondary)] sm:inline">
 {me.user.name}{" "}
 <span className="dt-mono text-[var(--text-quaternary)]">@{me.user.username}</span>
 </span>
 <button onClick={signOut} className="flex items-center gap-1.5 text-[var(--text-tertiary)] transition hover:text-white">
 <IconLogOut size={14} />
 <span className="hidden sm:inline">Sign out</span>
 </button>
 </div>
 </div>
 </header>

 <div className="mx-auto max-w-5xl px-6 py-10">
 {/* Team switcher */}
 <div className="dt-anim-in mb-9 flex flex-wrap items-end justify-between gap-4">
 <div>
 <p className="dt-label">Team</p>
 {me.teams.length > 1 ? (
 <select
 value={activeTeamId ?? ""}
 onChange={(e) => setActiveTeamId(e.target.value)}
 className="dt-select mt-1 max-w-xs"
 >
 {me.teams.map((t) => (
 <option key={t.id} value={t.id}>
 {t.name} ({t.teamCode})
 </option>
 ))}
 </select>
 ) : activeTeam ? (
 <h1 className="dt-page-title">{activeTeam.name}</h1>
 ) : (
 <h1 className="dt-page-title">No teams</h1>
 )}
 {activeTeam && (
 <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--text-secondary)]">
 <span>Team ID</span>
 <button
 type="button"
 className="dt-mono inline-flex items-center gap-1 text-[var(--blue-light)] transition hover:text-white"
 onClick={() => {
 navigator.clipboard?.writeText(activeTeam.teamCode);
 toast.success("Team ID copied", activeTeam.teamCode);
 }}
 >
 {activeTeam.teamCode}
 <IconCopy size={11} />
 </button>
 <span className="text-[var(--text-quaternary)]">·</span>
 <span className="capitalize">{activeTeam.role}</span>
 <span className="text-[var(--text-quaternary)]">·</span>
 <span className="dt-chip dt-chip-green capitalize">{activeTeam.planId} · free</span>
 </p>
 )}
 </div>
 <div className="flex flex-wrap gap-2">
 <a href="/join-team" className="dt-btn dt-btn-ghost dt-btn-sm">
 <IconUsers size={13} />
 Join team
 </a>
 <a href="/profile" className="dt-btn dt-btn-ghost dt-btn-sm">
 <IconSettings size={13} />
 Profile
 </a>
 {activeTeam && (
 <a href={`/team?team=${activeTeam.id}`} className="dt-btn dt-btn-ghost dt-btn-sm">
 <IconUsers size={13} />
 Team
 </a>
 )}
 {activeTeam?.role === "admin" && (
 <button type="button" onClick={() => setCreateOpen(true)} className="dt-btn dt-btn-primary dt-btn-sm">
 <IconPlus size={13} />
 New database
 </button>
 )}
 </div>
 </div>

 {/* Database directory */}
 <section>
 <div className="mb-4 flex items-center justify-between">
 <h2 className="text-[17px] font-semibold text-white">Databases</h2>
 {dbLoading && (
 <span className="flex items-center gap-1.5 text-xs text-[var(--text-quaternary)]">
 <IconLoader size={12} />
 Refreshing…
 </span>
 )}
 </div>

 {!activeTeam ? (
 <Empty hint="Create or join a team to manage databases." />
 ) : databases.length === 0 ? (
 <Empty
 hint={
 activeTeam.role === "admin"
 ? "No databases yet. Create one to open a visual workspace."
 : "No databases in this team yet."
 }
 action={
 activeTeam.role === "admin"
 ? { label: "Create database", onClick: () => setCreateOpen(true) }
 : undefined
 }
 />
 ) : (
 <ul className="dt-stagger grid gap-3 sm:grid-cols-2">
 {databases.map((db) => (
 <li
 key={db.id}
 className="dt-card dt-card-lift dt-spotlight rounded-[var(--r-lg)] p-5"
 onMouseMove={(e) => {
 const el = e.currentTarget;
 const r = el.getBoundingClientRect();
 el.style.setProperty("--mx", `${e.clientX - r.left}px`);
 el.style.setProperty("--my", `${e.clientY - r.top}px`);
 }}
 >
 <div className="flex items-start justify-between gap-2">
 <div className="flex items-start gap-3">
 <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--blue-light)]">
 <IconDatabase size={16} />
 </div>
 <div>
 <h3 className="font-semibold text-white">{db.name}</h3>
 <p className="dt-mono mt-1 text-xs text-[var(--blue-light)]">ID {db.dbCode}</p>
 </div>
 </div>
 <StatusPill status={db.status} />
 </div>
 <p className="mt-3.5 text-xs text-[var(--text-quaternary)]">
 {db.authKeyHint ? (
                  <>
                    Personal key ···{db.authKeyHint}
                  </>
                ) : (
                  "No personal key yet"
                )}{" "}
                · schema v{db.schemaVersion}</p>
 <div className="mt-4 flex flex-wrap gap-1.5">
 <a href={`/workspace/${db.id}`} className="dt-btn dt-btn-subtle dt-btn-xs">
 Open workspace
 <IconArrowUpRight size={11} />
 </a>
 <a href={`/analytics/${db.id}`} className="dt-btn dt-btn-xs" style={{ color: "var(--blue-light)", borderColor: "var(--blue-border)", background: "transparent", border: "1px solid var(--blue-border)" }}>
 <IconActivity size={11} />
 Analytics
 </a>
 <button
 type="button"
 onClick={async () => {
 const r = await api.downloadDatabaseExport(db.id, db.dbCode);
 if ("error" in r && r.error) toast.error("Export failed", r.error.message);
 else toast.success("Export downloaded", db.name);
 }}
 className="dt-btn dt-btn-subtle dt-btn-xs"
 >
 <IconDownload size={11} />
 Export
 </button>
 <button
 type="button"
 disabled={personalLoadingId === db.id}
 onClick={() => onRevokeKey(db)}
 className="dt-btn dt-btn-xs"
 style={{ color: "var(--red-light)", border: "1px solid var(--red-border)", background: "transparent" }}
 title="Revoke your personal DB key and show a new connection URL + auth key"
 >
 {personalLoadingId === db.id ? <IconLoader size={11} /> : <IconKey size={11} />}
 {personalLoadingId === db.id ? "Revoking…" : "Revoke Key"}
 </button>
 {activeTeam.role === "admin" && (
 <button
 type="button"
 onClick={() => {
 setDeleteTarget(db);
 setConfirmName("");
 }}
 className="dt-btn dt-btn-xs"
 style={{ color: "var(--red-light)", border: "1px solid var(--red-border)", background: "transparent" }}
 >
 <IconTrash size={11} />
 Delete
 </button>
 )}
 </div>
 </li>
 ))}
 </ul>
 )}
 </section>
 </div>

 {/* Create DB modal */}
 <Modal open={createOpen} onClose={() => !creating && setCreateOpen(false)} title="Create database" tone="info">
 <form onSubmit={onCreateDb} className="space-y-4">
 <label className="dt-field block">
 <span className="dt-label">Name</span>
 <input
 value={newDbName}
 onChange={(e) => setNewDbName(e.target.value)}
 required
 maxLength={64}
 placeholder="production"
 className="dt-input"
 autoFocus
 />
 </label>
 <p className="dt-hint">
 Plan limits apply. Auth key is shown once after create.
 </p>
 <div className="flex justify-end gap-2 pt-2">
 <button
 type="button"
 onClick={() => setCreateOpen(false)}
 className="dt-btn dt-btn-text"
 >
 Cancel
 </button>
 <button
 type="submit"
 disabled={creating || !newDbName.trim()}
 className="dt-btn dt-btn-primary"
 >
 {creating ? <><IconLoader size={14} />Creating…</> : "Create"}
 </button>
 </div>
 </form>
 </Modal>

 {/* Auth key reveal — once */}
 <Modal
 open={!!keyReveal}
 onClose={() => setKeyReveal(null)}
 title="Save your auth key"
 size="lg"
 tone="warn"
 >
 {keyReveal && (
 <div className="space-y-4">
 <div className="dt-callout dt-callout-warn">
 <IconKey size={15} />
 <span>
 This key is shown <strong>once</strong>. Copy it now — you cannot view it again (only
 rotate).
 </span>
 </div>
 <p className="text-xs text-[var(--text-tertiary)]">Database: {keyReveal.name}</p>
 <div>
 <p className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">Auth key</p>
 <code className="dt-inset block break-all p-3 font-mono text-sm text-[var(--blue-light)]">
 {keyReveal.authKey}
 </code>
 </div>
 <div>
 <p className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">Connection URL</p>
 <p className="dt-hint mb-1.5 mt-0">
 Postgres URL for your app (user password = auth key). Host defaults to localhost:5432 —
 set TARGET_DB_HOST if remote.
 </p>
 <code className="dt-inset block break-all p-3 font-mono text-xs text-[var(--blue-light)]">
 {keyReveal.connectionUrl}
 </code>
 </div>
 <div className="flex flex-wrap justify-end gap-2 pt-1">
 <button type="button" onClick={() => copyKey(keyReveal.authKey)} className="dt-btn dt-btn-ghost dt-btn-sm">
 <IconCopy size={12} />
 Copy key
 </button>
 <button
 type="button"
 onClick={() => copyKey(keyReveal.connectionUrl)}
 className="dt-btn dt-btn-primary dt-btn-sm"
 >
 <IconCopy size={12} />
 Copy connection URL
 </button>
 <button type="button" onClick={() => setKeyReveal(null)} className="dt-btn dt-btn-ghost dt-btn-sm">
 Done
 </button>
 </div>
 </div>
 )}
 </Modal>

 {/* Revoke Key — shows this user's connection URL + auth key */}
 <Modal
 open={!!personalConn}
 onClose={() => setPersonalConn(null)}
 title="Revoke Key — your connection credentials"
 size="lg"
 tone="warn"
 >
 {personalConn && (
 <div className="space-y-4">
 <div className="dt-callout dt-callout-warn">
 <IconKey size={15} />
 <span>
 Previous personal key is <strong>revoked</strong>. Copy the new auth key and
 connection URL now — shown once until you revoke again.
 </span>
 </div>
 <p className="text-xs text-[var(--text-tertiary)]">
 Database: <span className="text-white">{personalConn.name}</span> · ID{" "}
 <span className="dt-mono text-[var(--blue-light)]">{personalConn.dbCode}</span>
 {personalConn.fullAccess ? " · full access (admin)" : " · member RBAC grants"}
 </p>
 <div>
 <p className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">Postgres username</p>
 <code className="dt-inset block break-all p-3 font-mono text-sm text-[var(--text-secondary)]">
 {personalConn.pgUser}
 </code>
 </div>
 <div>
 <p className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">Auth key</p>
 <code className="dt-inset block break-all p-3 font-mono text-sm text-[var(--blue-light)]">
 {personalConn.password}
 </code>
 </div>
 <div>
 <p className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">Connection URL</p>
 <p className="dt-hint mb-1.5 mt-0">
 Use this in VS Code Database Client. Do <strong>not</strong> use the shared{" "}
 <span className="dt-code-inline">u_*</span> admin user — that is team admin only.
 </p>
 <code className="dt-inset block break-all p-3 font-mono text-xs text-[var(--green-light)]">
 {personalConn.connectionUrl}
 </code>
 </div>
 <p className="dt-hint">{personalConn.note}</p>
 <div className="flex flex-wrap gap-2 pt-2">
 <button type="button" onClick={() => copyKey(personalConn.password)} className="dt-btn dt-btn-ghost dt-btn-sm">
 <IconCopy size={12} />
 Copy password
 </button>
 <button
 type="button"
 onClick={() => copyKey(personalConn.connectionUrl)}
 className="dt-btn dt-btn-ghost dt-btn-sm"
 >
 <IconCopy size={12} />
 Copy connection URL
 </button>
 <button type="button" onClick={() => setPersonalConn(null)} className="dt-btn dt-btn-primary dt-btn-sm ml-auto">
 Done
 </button>
 </div>
 </div>
 )}
 </Modal>

 {/* Delete confirm */}
 <Modal
 open={!!deleteTarget}
 onClose={() => !deleting && setDeleteTarget(null)}
 title="Delete database"
 tone="danger"
 >
 {deleteTarget && (
 <div className="space-y-4">
 <div className="dt-callout dt-callout-danger">
 <IconTrash size={15} />
 <span>
 Type <span className="dt-code-inline">{deleteTarget.name}</span> to confirm.
 This cannot be undone in the hackathon build.
 </span>
 </div>
 <input
 value={confirmName}
 onChange={(e) => setConfirmName(e.target.value)}
 className="dt-input"
 placeholder={deleteTarget.name}
 autoFocus
 />
 <div className="flex justify-end gap-2">
 <button type="button" onClick={() => setDeleteTarget(null)} className="dt-btn dt-btn-text">
 Cancel
 </button>
 <button
 type="button"
 disabled={deleting || confirmName !== deleteTarget.name}
 onClick={onDelete}
 className="dt-btn dt-btn-danger"
 >
 {deleting ? <><IconLoader size={14} />Deleting…</> : <><IconTrash size={13} />Delete permanently</>}
 </button>
 </div>
 </div>
 )}
 </Modal>
 </main>
 );
}

function StatusPill({ status }: { status: string }) {
 if (status === "active") {
 return (
 <span className="dt-chip dt-chip-green">
 <span className="dt-live-dot" />
 {status}
 </span>
 );
 }
 if (status === "provisioning") {
 return (
 <span className="dt-chip dt-chip-yellow">
 <span className="dt-live-dot-yellow" />
 {status}
 </span>
 );
 }
 return <span className="dt-chip dt-chip-neutral">{status}</span>;
}

function Empty({
 hint,
 action,
}: {
 hint: string;
 action?: { label: string; onClick: () => void };
}) {
 return (
 <div className="dt-anim-in flex flex-col items-center gap-4 rounded-[var(--r-lg)] border border-dashed border-[var(--border-strong)] px-10 py-14 text-center">
 <div className="flex h-12 w-12 items-center justify-center rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-quaternary)]">
 <IconDatabase size={20} />
 </div>
 <p className="max-w-xs text-sm text-[var(--text-tertiary)]">{hint}</p>
 {action && (
 <button type="button" onClick={action.onClick} className="dt-btn dt-btn-primary dt-btn-sm">
 <IconPlus size={13} />
 {action.label}
 </button>
 )}
 </div>
 );
}
