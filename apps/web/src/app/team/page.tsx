"use client";

import { useCallback, useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Modal } from "@/lib/modal";
import { LoadingScreen } from "@/components/Loading";
import {
  IconArrowLeft,
  IconLoader,
  IconShield,
  IconTrash,
  IconUser,
  IconUsers,
} from "@/components/icons";

type Member = {
 memberId: string;
 userId: string;
 username: string;
 name: string;
 email: string;
 role: string;
 permissions: string[];
 joinedAt: string;
};

type Team = {
 id: string;
 teamCode: string;
 name: string;
 planId: string;
 role: string;
};

const MEMBER_PERMS = [
 { id: "data.read", label: "View data" },
 { id: "data.insert", label: "Insert data" },
 { id: "data.update", label: "Update data" },
 { id: "data.delete", label: "Delete data" },
 { id: "table.create", label: "Create tables" },
 { id: "table.rename", label: "Rename tables" },
 { id: "table.delete", label: "Delete tables" },
 { id: "table.edit_schema", label: "Edit schema" },
 { id: "relation.manage", label: "Manage relations" },
 { id: "constraint.manage", label: "Manage constraints" },
 { id: "csv.import", label: "Import CSV" },
 { id: "csv.export", label: "Export" },
 { id: "analytics.read", label: "View analytics" },
 { id: "audit.read", label: "View history" },
];

export default function TeamPage() {
 const router = useRouter();
 const toast = useToast();
 const [teams, setTeams] = useState<Team[]>([]);
 const [teamId, setTeamId] = useState<string | null>(null);
 const [members, setMembers] = useState<Member[]>([]);
 const [notifications, setNotifications] = useState<
 Array<{ id: string; type: string; payload: Record<string, unknown>; createdAt: string }>
 >([]);
 const [loading, setLoading] = useState(true);
 const [permTarget, setPermTarget] = useState<Member | null>(null);
 const [permDraft, setPermDraft] = useState<string[]>([]);
 const [meId, setMeId] = useState<string | null>(null);
 const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
 const [removing, setRemoving] = useState(false);

 const active = teams.find((t) => t.id === teamId) ?? teams[0] ?? null;

 const loadMembers = useCallback(
 async (tid: string) => {
 const { data, error } = await api.listMembers(tid);
 if (error) {
 toast.error("Could not load members", error.message);
 return;
 }
 setMembers(data?.members ?? []);
 },
 [toast]
 );

 const loadNotifications = useCallback(async (tid: string) => {
 const { data } = await api.listNotifications(tid);
 setNotifications(data?.notifications ?? []);
 }, []);

 useEffect(() => {
 api.me().then(({ data, status }) => {
 setLoading(false);
 if (status === 401 || !data) {
 router.replace("/signin");
 return;
 }
 setMeId(data.user.id);
 setTeams(data.teams);
 const prefer =
 typeof window !== "undefined"
 ? new URLSearchParams(window.location.search).get("team")
 : null;
 const pick =
 data.teams.find((t) => t.id === prefer || t.teamCode === prefer)?.id ??
 data.teams[0]?.id ??
 null;
 setTeamId(pick);
 });
 }, [router]);

 useEffect(() => {
 if (teamId) {
 loadMembers(teamId);
 loadNotifications(teamId);
 }
 }, [teamId, loadMembers, loadNotifications]);

 async function onRemove(m: Member) {
 if (!teamId) return;
 setRemoving(true);
 const { error } = await api.removeMember(teamId, m.userId);
 setRemoving(false);
 if (error) {
 toast.error("Remove failed", error.message);
 return;
 }
 toast.success("Member removed", m.name);
 setRemoveTarget(null);
 loadMembers(teamId);
 loadNotifications(teamId);
 }

 async function savePerms() {
 if (!teamId || !permTarget) return;
 const { error } = await api.setMemberPermissions(teamId, permTarget.userId, permDraft);
 if (error) {
 toast.error("Permissions failed", error.message);
 return;
 }
 toast.success("Permissions updated", permTarget.name);
 setPermTarget(null);
 loadMembers(teamId);
 loadNotifications(teamId);
 }

 if (loading) {
 return <LoadingScreen />;
 }

 return (
 <main className="dt-shell min-h-screen">
 <header className="dt-topbar">
 <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3">
 <div className="flex items-center gap-4">
 <BrandMark size={22} withWordmark={false} href="/dashboard" />
 <a href="/dashboard" className="dt-back-link">
 <span className="dt-back-chevron"><IconArrowLeft size={13} /></span>
 Dashboard
 </a>
 <span className="dt-crumb-sep hidden sm:inline">/</span>
 <h1 className="hidden text-[15px] font-semibold text-white sm:block">Team governance</h1>
 </div>
 {teams.length > 1 && (
 <select
 value={teamId ?? ""}
 onChange={(e) => setTeamId(e.target.value)}
 className="dt-select max-w-[180px]"
 >
 {teams.map((t) => (
 <option key={t.id} value={t.id}>
 {t.name}
 </option>
 ))}
 </select>
 )}
 </div>
 </header>

 <div className="mx-auto max-w-4xl space-y-9 px-6 py-10">
 {active && (
 <div className="dt-anim-in dt-card rounded-[var(--r-lg)] p-6">
 <div className="flex items-center gap-3">
 <div className="flex h-10 w-10 items-center justify-center rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--blue-light)]">
 <IconUsers size={18} />
 </div>
 <div>
 <h2 className="text-lg font-semibold text-white">{active.name}</h2>
 <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-[var(--text-secondary)]">
 <span>
 Team ID <span className="dt-mono text-[var(--blue-light)]">{active.teamCode}</span>
 </span>
 <span className="text-[var(--text-quaternary)]">·</span>
 <span className="dt-chip dt-chip-green capitalize">{active.planId} · free</span>
 <span className="text-[var(--text-quaternary)]">·</span>
 <span>
 You are <span className="capitalize text-white">{active.role}</span>
 </span>
 </p>
 </div>
 </div>
 </div>
 )}

 <section className="dt-anim-in" style={{ animationDelay: "0.05s" }}>
 <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-quaternary)]">
 <IconUser size={12} />
 Members
 </h3>
 <ul className="space-y-2">
 {members.map((m) => (
 <li
 key={m.memberId}
 className="dt-card flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-md)] px-4 py-3.5"
 >
 <div>
 <p className="font-medium text-white">
 {m.name}{" "}
 <span className="dt-mono text-xs text-[var(--text-quaternary)]">@{m.username}</span>
 </p>
 <p className="text-xs text-[var(--text-tertiary)]">
 {m.email} · <span className="capitalize">{m.role}</span>
 {m.role === "member" && m.permissions.length > 0 && (
 <span className="text-[var(--text-quaternary)]"> · {m.permissions.length} grants</span>
 )}
 </p>
 </div>
 {active?.role === "admin" && m.userId !== meId && (
 <div className="flex gap-2">
 {m.role === "member" && (
 <button
 type="button"
 onClick={() => {
 setPermTarget(m);
 setPermDraft([...m.permissions]);
 }}
 className="dt-btn dt-btn-ghost dt-btn-xs"
 >
 <IconShield size={11} />
 Permissions
 </button>
 )}
 <button
 type="button"
 onClick={() => setRemoveTarget(m)}
 className="dt-btn dt-btn-xs"
 style={{ color: "var(--red-light)", border: "1px solid var(--red-border)", background: "transparent" }}
 >
 <IconTrash size={11} />
 Remove
 </button>
 </div>
 )}
 </li>
 ))}
 </ul>
 </section>

 <section className="dt-anim-in" style={{ animationDelay: "0.1s" }}>
 <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-quaternary)]">
 Notifications
 </h3>
 {notifications.length === 0 ? (
 <p className="text-sm text-[var(--text-tertiary)]">No team notifications yet.</p>
 ) : (
 <ul className="space-y-2">
 {notifications.map((n: any) => (
 <li
 key={n.id}
 className="dt-card rounded-[var(--r-md)] px-4 py-3 text-sm text-[var(--text-secondary)]"
 >
 <div className="flex flex-wrap items-baseline justify-between gap-2">
 <span className="font-medium text-[var(--blue-light)]">{n.type}</span>
 <span className="text-[11px] text-[var(--text-quaternary)]">
 {new Date(n.createdAt).toLocaleString()}
 </span>
 </div>
 <p className="mt-1 text-[var(--text-primary)]">
 {(n.payload && n.payload.summary) || n.type}
 </p>
 <p className="mt-1 text-[11px] text-[var(--text-quaternary)]">
 {n.actorUsername ? <>by <span className="dt-mono text-[var(--blue-light)]/80">@{n.actorUsername}</span></> : null}
 {n.targetUsername ? <> → <span className="dt-mono text-[var(--yellow-light)]/80">@{n.targetUsername}</span></> : null}
 {n.payload?.databaseId ? <> · db <span className="dt-mono">{String(n.payload.databaseId).slice(0, 8)}</span></> : null}
 {n.payload?.tableId ? <> · table <span className="dt-mono">{String(n.payload.tableName || n.payload.tableId).slice(0, 24)}</span></> : null}
 </p>
 </li>
 ))}
 </ul>
 )}
 </section>
 </div>

 <Modal open={!!permTarget} onClose={() => setPermTarget(null)} title="Member permissions" tone="info">
 {permTarget && (
 <div className="space-y-4">
 <p className="text-sm text-[var(--text-secondary)]">
 Grants for <strong className="text-white">{permTarget.name}</strong>. Admin always has
 full access.
 </p>
 <div className="grid gap-2 sm:grid-cols-2">
 {MEMBER_PERMS.map((p) => (
 <label key={p.id} className="dt-checkbox-row">
 <input
 type="checkbox"
 checked={permDraft.includes(p.id)}
 onChange={(e) => {
 if (e.target.checked) setPermDraft([...permDraft, p.id]);
 else setPermDraft(permDraft.filter((x) => x !== p.id));
 }}
 />
 {p.label}
 </label>
 ))}
 </div>
 <div className="flex justify-end gap-2 pt-1">
 <button type="button" onClick={() => setPermTarget(null)} className="dt-btn dt-btn-text">
 Cancel
 </button>
 <button type="button" onClick={savePerms} className="dt-btn dt-btn-primary dt-btn-sm">
 Save
 </button>
 </div>
 </div>
 )}
 </Modal>

 <Modal open={!!removeTarget} onClose={() => !removing && setRemoveTarget(null)} title="Remove member" tone="danger">
 {removeTarget && (
 <div className="space-y-4">
 <div className="dt-callout dt-callout-danger">
 <IconTrash size={15} />
 <span>
 Remove <strong>{removeTarget.name}</strong> (<span className="dt-mono">@{removeTarget.username}</span>) from the team?
 They will lose access to every database immediately.
 </span>
 </div>
 <div className="flex justify-end gap-2">
 <button type="button" onClick={() => setRemoveTarget(null)} className="dt-btn dt-btn-text">
 Cancel
 </button>
 <button type="button" disabled={removing} onClick={() => onRemove(removeTarget)} className="dt-btn dt-btn-danger">
 {removing ? <><IconLoader size={14} />Removing…</> : <><IconTrash size={13} />Remove member</>}
 </button>
 </div>
 </div>
 )}
 </Modal>
 </main>
 );
}
