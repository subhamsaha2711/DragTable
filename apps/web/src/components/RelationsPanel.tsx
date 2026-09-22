"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { IconGrid, IconLink, IconLoader, IconPlus, IconShield, IconTrash } from "@/components/icons";

type Col = { id: string; name: string; dataType: string; isPrimaryKey: boolean };
type Tbl = { id: string; name: string; columns: Col[] };
type Fk = {
 id: string;
 name: string;
 tableId: string;
 columnId: string;
 refTableId: string;
 refColumnId: string;
 onDelete: string;
};
type Ix = { id: string; name: string; tableId: string; columnIds: string[]; unique: boolean };
type Ck = { id: string; name: string; tableId: string; columnId: string; op: string; value?: unknown };

export function RelationsPanel({ databaseId }: { databaseId: string }) {
 const toast = useToast();
 const [tables, setTables] = useState<Tbl[]>([]);
 const [fks, setFks] = useState<Fk[]>([]);
 const [indexes, setIndexes] = useState<Ix[]>([]);
 const [checks, setChecks] = useState<Ck[]>([]);
 const [loading, setLoading] = useState(true);

 // FK form
 const [fkTable, setFkTable] = useState("");
 const [fkCol, setFkCol] = useState("");
 const [fkRefTable, setFkRefTable] = useState("");
 const [fkRefCol, setFkRefCol] = useState("");
 const [fkOnDelete, setFkOnDelete] = useState<"restrict" |"cascade" |"set_null">("restrict");
 const [fkName, setFkName] = useState("");

 // Index form
 const [ixTable, setIxTable] = useState("");
 const [ixCols, setIxCols] = useState<string[]>([]);
 const [ixUnique, setIxUnique] = useState(false);
 const [ixName, setIxName] = useState("");

 // Check form
 const [ckTable, setCkTable] = useState("");
 const [ckCol, setCkCol] = useState("");
 const [ckOp, setCkOp] = useState("not_null");
 const [ckValue, setCkValue] = useState("");
 const [ckName, setCkName] = useState("");

 const load = useCallback(async () => {
 const { data, error } = await api.listSchemaExtras(databaseId);
 if (error) {
 toast.error("Could not load relations", error.message);
 setLoading(false);
 return;
 }
 if (data) {
 setTables(data.tables);
 setFks(data.foreignKeys as Fk[]);
 setIndexes(data.indexes as Ix[]);
 setChecks(data.checks as Ck[]);
 }
 setLoading(false);
 }, [databaseId, toast]);

 useEffect(() => {
 load();
 }, [load]);

 const nameOf = (tableId: string, columnId?: string) => {
 const tb = tables.find((t) => t.id === tableId);
 if (!tb) return"?";
 if (!columnId) return tb.name;
 const c = tb.columns.find((x) => x.id === columnId);
 return `${tb.name}.${c?.name ?? "?"}`;
 };

 const layout = useMemo(() => {
 // simple grid positions for ER boxes
 const cols = 3;
 return tables.map((t, i) => ({
 ...t,
 x: 40 + (i % cols) * 220,
 y: 40 + Math.floor(i / cols) * 140,
 }));
 }, [tables]);

 const fkLines = useMemo(() => {
 return fks
 .map((fk) => {
 const from = layout.find((t) => t.id === fk.tableId);
 const to = layout.find((t) => t.id === fk.refTableId);
 if (!from || !to) return null;
 return {
 id: fk.id,
 x1: from.x + 180,
 y1: from.y + 40,
 x2: to.x,
 y2: to.y + 40,
 label: fk.name,
 };
 })
 .filter(Boolean) as Array<{
 id: string;
 x1: number;
 y1: number;
 x2: number;
 y2: number;
 label: string;
 }>;
 }, [fks, layout]);

 if (loading) {
 return (
 <div className="flex flex-1 items-center justify-center gap-2 p-6 text-sm text-[var(--text-tertiary)]">
 <IconLoader size={14} />
 Loading schema relations…
 </div>
 );
 }

 return (
 <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
 {/* ER diagram */}
 <section className="dt-panel rounded-[var(--r-lg)] p-4">
 <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
 <IconGrid size={13} />
 Entity relationship
 </h3>
 {tables.length === 0 ? (
 <p className="py-8 text-center text-sm text-[var(--text-tertiary)]">Create tables to see the ER diagram.</p>
 ) : (
 <svg
 viewBox={`0 0 ${Math.max(700, 40 + Math.min(tables.length, 3) * 220)} ${Math.max(280, 80 + Math.ceil(tables.length / 3) * 140)}`}
 className="w-full"
 >
 <defs>
 <marker id="dt-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
 <path d="M0,0 L6,3 L0,6 Z" fill="var(--blue-light)" />
 </marker>
 <linearGradient id="dt-node-fill" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0%" stopColor="var(--surface-3)" />
 <stop offset="100%" stopColor="var(--surface-1)" />
 </linearGradient>
 </defs>
 {fkLines.map((l) => (
 <g key={l.id}>
 <line
 x1={l.x1}
 y1={l.y1}
 x2={l.x2}
 y2={l.y2}
 stroke="var(--blue)"
 strokeWidth={1.5}
 markerEnd="url(#dt-arrow)"
 opacity={0.75}
 />
 <text
 x={(l.x1 + l.x2) / 2}
 y={(l.y1 + l.y2) / 2 - 4}
 fill="var(--blue-light)"
 fontSize={9}
 textAnchor="middle"
 >
 {l.label}
 </text>
 </g>
 ))}
 {layout.map((t) => (
 <g key={t.id}>
 <rect
 x={t.x}
 y={t.y}
 width={180}
 height={20 + t.columns.length * 14}
 rx={10}
 fill="url(#dt-node-fill)"
 stroke="var(--border-strong)"
 strokeWidth={1.25}
 />
 <rect x={t.x} y={t.y} width={180} height={22} rx={10} fill="var(--blue-soft)" />
 <rect x={t.x} y={t.y + 11} width={180} height={11} fill="var(--blue-soft)" />
 <text x={t.x + 10} y={t.y + 15} fill="var(--blue-light)" fontSize={11} fontWeight={650}>
 {t.name}
 </text>
 {t.columns.slice(0, 6).map((c, i) => (
 <text key={c.id} x={t.x + 10} y={t.y + 38 + i * 14} fill="var(--text-secondary)" fontSize={10}>
 {c.isPrimaryKey ? "PK " : ""}
 {c.name}
 <tspan fill="var(--text-quaternary)"> : {c.dataType}</tspan>
 </text>
 ))}
 </g>
 ))}
 </svg>
 )}
 </section>

 <div className="grid gap-4 lg:grid-cols-3">
 {/* Foreign keys */}
 <section className="dt-card rounded-[var(--r-lg)] p-4">
 <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
 <IconLink size={14} className="text-[var(--blue-light)]" />
 Foreign keys
 </h3>
 <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
 Enforced on insert/update. On delete: restrict / cascade / set null.
 </p>
 <ul className="mt-3 max-h-40 space-y-1.5 overflow-y-auto text-xs">
 {fks.length === 0 && <li className="text-[var(--text-quaternary)]">None yet</li>}
 {fks.map((fk) => (
 <li
 key={fk.id}
 className="dt-inset flex items-start justify-between gap-2 rounded-[var(--r-sm)] px-2.5 py-2"
 >
 <span className="text-[var(--text-secondary)]">
 <span className="dt-mono text-[var(--blue-light)]">{fk.name}</span>
 <br />
 {nameOf(fk.tableId, fk.columnId)} → {nameOf(fk.refTableId, fk.refColumnId)}
 <span className="ml-1 text-[var(--text-quaternary)]">({fk.onDelete})</span>
 </span>
 <button
 type="button"
 className="shrink-0 text-[var(--red-light)] transition hover:text-[var(--red)]"
 onClick={async () => {
 const { error } = await api.dropForeignKey(databaseId, fk.id);
 if (error) toast.error("Drop FK failed", error.message);
 else {
 toast.success("FK dropped");
 load();
 }
 }}
 >
 <IconTrash size={13} />
 </button>
 </li>
 ))}
 </ul>
 <div className="mt-3 space-y-2 border-t border-[var(--border-subtle)] pt-3">
 <input
 placeholder="name (optional)"
 value={fkName}
 onChange={(e) => setFkName(e.target.value)}
 className="dt-input !py-1.5 !text-xs"
 />
 <select
 value={fkTable}
 onChange={(e) => {
 setFkTable(e.target.value);
 setFkCol("");
 }}
 className="dt-select !py-1.5 !text-xs"
 >
 <option value="">Child table</option>
 {tables.map((t) => (
 <option key={t.id} value={t.id}>
 {t.name}
 </option>
 ))}
 </select>
 <select
 value={fkCol}
 onChange={(e) => setFkCol(e.target.value)}
 className="dt-select !py-1.5 !text-xs"
 >
 <option value="">Child column</option>
 {tables
 .find((t) => t.id === fkTable)
 ?.columns.map((c) => (
 <option key={c.id} value={c.id}>
 {c.name}
 </option>
 ))}
 </select>
 <select
 value={fkRefTable}
 onChange={(e) => {
 setFkRefTable(e.target.value);
 setFkRefCol("");
 }}
 className="dt-select !py-1.5 !text-xs"
 >
 <option value="">Parent table</option>
 {tables.map((t) => (
 <option key={t.id} value={t.id}>
 {t.name}
 </option>
 ))}
 </select>
 <select
 value={fkRefCol}
 onChange={(e) => setFkRefCol(e.target.value)}
 className="dt-select !py-1.5 !text-xs"
 >
 <option value="">Parent column</option>
 {tables
 .find((t) => t.id === fkRefTable)
 ?.columns.map((c) => (
 <option key={c.id} value={c.id}>
 {c.name}
 {c.isPrimaryKey ? " (PK)" : ""}
 </option>
 ))}
 </select>
 <select
 value={fkOnDelete}
 onChange={(e) => setFkOnDelete(e.target.value as typeof fkOnDelete)}
 className="dt-select !py-1.5 !text-xs"
 >
 <option value="restrict">ON DELETE RESTRICT</option>
 <option value="cascade">ON DELETE CASCADE</option>
 <option value="set_null">ON DELETE SET NULL</option>
 </select>
 <button
 type="button"
 disabled={!fkTable || !fkCol || !fkRefTable || !fkRefCol}
 onClick={async () => {
 const { error } = await api.addForeignKey(databaseId, {
 name: fkName || undefined,
 tableId: fkTable,
 columnId: fkCol,
 refTableId: fkRefTable,
 refColumnId: fkRefCol,
 onDelete: fkOnDelete,
 });
 if (error) toast.error("Add FK failed", error.message);
 else {
 toast.success("Foreign key added");
 setFkName("");
 load();
 }
 }}
 className="dt-btn dt-btn-primary dt-btn-xs dt-btn-block"
 >
 <IconPlus size={11} />
 Add foreign key
 </button>
 </div>
 </section>

 {/* Indexes */}
 <section className="dt-card rounded-[var(--r-lg)] p-4">
 <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
 <IconGrid size={14} className="text-[var(--green-light)]" />
 Indexes
 </h3>
 <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">Single or multi-column; optional UNIQUE.</p>
 <ul className="mt-3 max-h-40 space-y-1.5 overflow-y-auto text-xs">
 {indexes.length === 0 && <li className="text-[var(--text-quaternary)]">None yet</li>}
 {indexes.map((ix) => (
 <li
 key={ix.id}
 className="dt-inset flex items-start justify-between gap-2 rounded-[var(--r-sm)] px-2.5 py-2"
 >
 <span className="text-[var(--text-secondary)]">
 <span className="dt-mono text-[var(--green-light)]">{ix.name}</span>
 {ix.unique && <span className="dt-chip dt-chip-yellow ml-1.5 !py-0">UNIQUE</span>}
 <br />
 {nameOf(ix.tableId)} ({ix.columnIds.map((id) => nameOf(ix.tableId, id).split(".")[1]).join(",")})
 </span>
 <button
 type="button"
 className="shrink-0 text-[var(--red-light)] transition hover:text-[var(--red)]"
 onClick={async () => {
 const { error } = await api.dropIndex(databaseId, ix.id);
 if (error) toast.error("Drop index failed", error.message);
 else {
 toast.success("Index dropped");
 load();
 }
 }}
 >
 <IconTrash size={13} />
 </button>
 </li>
 ))}
 </ul>
 <div className="mt-3 space-y-2 border-t border-[var(--border-subtle)] pt-3">
 <input
 placeholder="name (optional)"
 value={ixName}
 onChange={(e) => setIxName(e.target.value)}
 className="dt-input !py-1.5 !text-xs"
 />
 <select
 value={ixTable}
 onChange={(e) => {
 setIxTable(e.target.value);
 setIxCols([]);
 }}
 className="dt-select !py-1.5 !text-xs"
 >
 <option value="">Table</option>
 {tables.map((t) => (
 <option key={t.id} value={t.id}>
 {t.name}
 </option>
 ))}
 </select>
 <div className="dt-inset max-h-24 space-y-1 overflow-y-auto rounded-[var(--r-sm)] p-2">
 {tables
 .find((t) => t.id === ixTable)
 ?.columns.map((c) => (
 <label key={c.id} className="dt-checkbox-row !text-xs">
 <input
 type="checkbox"
 checked={ixCols.includes(c.id)}
 onChange={(e) => {
 setIxCols((prev) =>
 e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id)
 );
 }}
 />
 {c.name}
 </label>
 )) ?? <span className="text-[var(--text-quaternary)]">Select a table</span>}
 </div>
 <label className="dt-checkbox-row !text-xs">
 <input type="checkbox" checked={ixUnique} onChange={(e) => setIxUnique(e.target.checked)} />
 UNIQUE index
 </label>
 <button
 type="button"
 disabled={!ixTable || ixCols.length === 0}
 onClick={async () => {
 const { error } = await api.addIndex(databaseId, {
 name: ixName || undefined,
 tableId: ixTable,
 columnIds: ixCols,
 unique: ixUnique,
 });
 if (error) toast.error("Add index failed", error.message);
 else {
 toast.success("Index added");
 setIxName("");
 setIxCols([]);
 load();
 }
 }}
 className="dt-btn dt-btn-success dt-btn-xs dt-btn-block"
 >
 <IconPlus size={11} />
 Add index
 </button>
 </div>
 </section>

 {/* Checks */}
 <section className="dt-card rounded-[var(--r-lg)] p-4">
 <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
 <IconShield size={14} className="text-[var(--yellow-light)]" />
 Check constraints
 </h3>
 <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
 Structured checks only (no free-form SQL): comparisons &amp; not-null.
 </p>
 <ul className="mt-3 max-h-40 space-y-1.5 overflow-y-auto text-xs">
 {checks.length === 0 && <li className="text-[var(--text-quaternary)]">None yet</li>}
 {checks.map((ck) => (
 <li
 key={ck.id}
 className="dt-inset flex items-start justify-between gap-2 rounded-[var(--r-sm)] px-2.5 py-2"
 >
 <span className="text-[var(--text-secondary)]">
 <span className="dt-mono text-[var(--yellow-light)]">{ck.name}</span>
 <br />
 {nameOf(ck.tableId, ck.columnId)} {ck.op}
 {ck.op !== "not_null" ? ` ${String(ck.value ?? "")}` : ""}
 </span>
 <button
 type="button"
 className="shrink-0 text-[var(--red-light)] transition hover:text-[var(--red)]"
 onClick={async () => {
 const { error } = await api.dropCheck(databaseId, ck.id);
 if (error) toast.error("Drop check failed", error.message);
 else {
 toast.success("Check dropped");
 load();
 }
 }}
 >
 <IconTrash size={13} />
 </button>
 </li>
 ))}
 </ul>
 <div className="mt-3 space-y-2 border-t border-[var(--border-subtle)] pt-3">
 <input
 placeholder="name (optional)"
 value={ckName}
 onChange={(e) => setCkName(e.target.value)}
 className="dt-input !py-1.5 !text-xs"
 />
 <select
 value={ckTable}
 onChange={(e) => {
 setCkTable(e.target.value);
 setCkCol("");
 }}
 className="dt-select !py-1.5 !text-xs"
 >
 <option value="">Table</option>
 {tables.map((t) => (
 <option key={t.id} value={t.id}>
 {t.name}
 </option>
 ))}
 </select>
 <select
 value={ckCol}
 onChange={(e) => setCkCol(e.target.value)}
 className="dt-select !py-1.5 !text-xs"
 >
 <option value="">Column</option>
 {tables
 .find((t) => t.id === ckTable)
 ?.columns.map((c) => (
 <option key={c.id} value={c.id}>
 {c.name}
 </option>
 ))}
 </select>
 <select
 value={ckOp}
 onChange={(e) => setCkOp(e.target.value)}
 className="dt-select !py-1.5 !text-xs"
 >
 <option value="not_null">NOT NULL</option>
 <option value="eq">=</option>
 <option value="neq">≠</option>
 <option value="gt">&gt;</option>
 <option value="gte">≥</option>
 <option value="lt">&lt;</option>
 <option value="lte">≤</option>
 </select>
 {ckOp !== "not_null" && (
 <input
 placeholder="value"
 value={ckValue}
 onChange={(e) => setCkValue(e.target.value)}
 className="dt-input !py-1.5 !text-xs"
 />
 )}
 <button
 type="button"
 disabled={!ckTable || !ckCol}
 onClick={async () => {
 let value: unknown = ckValue;
 if (["gt","gte","lt","lte"].includes(ckOp)) {
 value = Number(ckValue);
 if (Number.isNaN(value as number)) {
 toast.error("Check value must be a number for this operator");
 return;
 }
 }
 const { error } = await api.addCheck(databaseId, {
 name: ckName || undefined,
 tableId: ckTable,
 columnId: ckCol,
 op: ckOp,
 value: ckOp === "not_null" ? undefined : value,
 });
 if (error) toast.error("Add check failed", error.message);
 else {
 toast.success("Check added");
 setCkName("");
 setCkValue("");
 load();
 }
 }}
 className="dt-btn dt-btn-warn dt-btn-xs dt-btn-block"
 >
 <IconPlus size={11} />
 Add check
 </button>
 </div>
 </section>
 </div>
 </div>
 );
}
