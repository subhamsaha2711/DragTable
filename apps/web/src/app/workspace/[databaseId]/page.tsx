"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { useParams, useRouter } from "next/navigation";
import {
 api,
 type AuditEntry,
 type ColumnMeta,
 type DataType,
 type PublicDatabase,
 type RowRecord,
 type TableMeta,
} from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Modal } from "@/lib/modal";
import { RelationsPanel } from "@/components/RelationsPanel";
import { LoadingScreen } from "@/components/Loading";
import {
 IconActivity,
 IconArrowLeft,
 IconBook,
 IconDownload,
 IconHistory,
 IconLoader,
 IconPencil,
 IconPlus,
 IconTable,
 IconTrash,
 IconUpload,
 IconWifiOff,
 IconX,
} from "@/components/icons";

const DATA_TYPES: DataType[] = ["text","integer","numeric","boolean","date","timestamp","uuid","jsonb",
];

type ColDraft = {
 name: string;
 dataType: DataType;
 nullable: boolean;
 unique: boolean;
 isPrimaryKey: boolean;
};

export default function WorkspacePage() {
 const params = useParams();
 const databaseId = params.databaseId as string;
 const router = useRouter();
 const toast = useToast();

 const [database, setDatabase] = useState<PublicDatabase | null>(null);
 const [tables, setTables] = useState<TableMeta[]>([]);
 const [activeTableId, setActiveTableId] = useState<string | null>(null);
 const [rows, setRows] = useState<RowRecord[]>([]);
 const [totalRows, setTotalRows] = useState(0);
 const [loading, setLoading] = useState(true);
 const [tab, setTab] = useState<"data" |"schema" |"relations" |"audit">("data");
 const [audit, setAudit] = useState<AuditEntry[]>([]);
 const [live, setLive] = useState<"off" |"connecting" |"on">("off");
 const [liveViewers, setLiveViewers] = useState(0);
 const [csvOpen, setCsvOpen] = useState(false);
 const [csvName, setCsvName] = useState("");
 const [csvText, setCsvText] = useState("");
 const [importing, setImporting] = useState(false);

 const [createOpen, setCreateOpen] = useState(false);
 const [tableName, setTableName] = useState("");
 const [colDrafts, setColDrafts] = useState<ColDraft[]>([
 { name: "name", dataType: "text", nullable: true, unique: false, isPrimaryKey: false },
 ]);
 const [creating, setCreating] = useState(false);

 const [addColOpen, setAddColOpen] = useState(false);
 const [newCol, setNewCol] = useState<ColDraft>({
 name: "",
 dataType: "text",
 nullable: true,
 unique: false,
 isPrimaryKey: false,
 });

 const [insertOpen, setInsertOpen] = useState(false);
 const [insertValues, setInsertValues] = useState<Record<string, string>>({});
 const [inserting, setInserting] = useState(false);

 const [dropTableTarget, setDropTableTarget] = useState<TableMeta | null>(null);

 const [renameOpen, setRenameOpen] = useState(false);
 const [renameValue, setRenameValue] = useState("");
 const [renaming, setRenaming] = useState(false);

 const [editing, setEditing] = useState<{
 rowId: string;
 columnId: string;
 version: number;
 value: string;
 } | null>(null);

 const activeTable = useMemo(
 () => tables.find((t) => t.id === activeTableId) ?? null,
 [tables, activeTableId]
 );

 const loadTables = useCallback(async (opts?: { poll?: boolean; silent?: boolean }) => {
 const { data, error, status } = await api.listTables(databaseId, { poll: opts?.poll });
 if (status === 401) {
 router.replace("/signin");
 return;
 }
 if (error) {
 if (!opts?.silent && !opts?.poll) {
 toast.error("Workspace error", error.message);
 }
 // Removed / no access while online
 if (error.code === "DB_NOT_FOUND") {
 toast.error("Not found", "This database no longer exists");
 router.replace("/dashboard");
 }
 setLoading(false);
 return;
 }
 if (data) {
 setDatabase(data.database);
 // Always replace from server so column counts stay accurate
 setTables(
 data.tables.map((tb) => ({
 ...tb,
 columns: Array.isArray(tb.columns) ? tb.columns : [],
 }))
 );
 setActiveTableId((prev) => {
 if (prev && data.tables.some((t) => t.id === prev)) return prev;
 return data.tables[0]?.id ?? null;
 });
 }
 setLoading(false);
 }, [databaseId, router, toast]);

 const loadRows = useCallback(
 async (tableId: string, opts?: { poll?: boolean }) => {
 const { data, error, status } = await api.listRows(databaseId, tableId, { poll: opts?.poll });
 if (status === 401) {
 router.replace("/signin");
 return;
 }
 if (error) {
 if (error.code === "FORBIDDEN") {
 // No data.read grant — stay signed in, show empty data
 setRows([]);
 setTotalRows(0);
 if (!opts?.poll) {
 toast.error("No data access", "Ask an admin to grant data.read");
 }
 return;
 }
 if (error.code === "DB_NOT_FOUND") {
 router.replace("/dashboard");
 return;
 }
 if (!opts?.poll) toast.error("Could not load rows", error.message);
 return;
 }
 if (data) {
 setRows(data.rows);
 setTotalRows(data.totalRows);
 setTables((prev) =>
 prev.map((t) =>
 t.id === data.table.id
 ? { ...data.table, columns: Array.isArray(data.table.columns) ? data.table.columns : [] }
 : t
 )
 );
 }
 },
 [databaseId, toast, router]
 );

 const loadAudit = useCallback(async (opts?: { poll?: boolean }) => {
 const { data, error } = await api.listAudit(databaseId, activeTableId ?? undefined, { poll: opts?.poll });
 if (error) {
 if (!opts?.poll) toast.error("Could not load audit", error.message);
 return;
 }
 if (data) setAudit(data.entries);
 }, [databaseId, activeTableId, toast]);


 // Intentional first paints — these count as reads (poll omitted).
 // Background WS/interval/post-mutation paths always pass poll:true.
 useEffect(() => {
 loadTables();
 }, [loadTables]);

 useEffect(() => {
 if (activeTableId) loadRows(activeTableId);
 else {
 setRows([]);
 setTotalRows(0);
 }
 }, [activeTableId, loadRows]);

 useEffect(() => {
 if (tab === "audit") loadAudit();
 }, [tab, loadAudit]);

 // Keep latest callbacks/ids for WS + poll (avoid stale closures)
 const activeTableIdRef = useRef(activeTableId);
 const tabRef = useRef(tab);
 const loadTablesRef = useRef(loadTables);
 const loadRowsRef = useRef(loadRows);
 const loadAuditRef = useRef(loadAudit);
 activeTableIdRef.current = activeTableId;
 tabRef.current = tab;
 loadTablesRef.current = loadTables;
 loadRowsRef.current = loadRows;
 loadAuditRef.current = loadAudit;

 const refreshFromServer = useCallback(() => {
 loadTablesRef.current({ poll: true, silent: true });
 const tid = activeTableIdRef.current;
 if (tid) loadRowsRef.current(tid, { poll: true });
 if (tabRef.current === "audit") loadAuditRef.current({ poll: true });
 }, []);

 // Live WebSocket — push path
 useEffect(() => {
 if (!databaseId) return;
 setLive("connecting");
 const env = process.env.NEXT_PUBLIC_API_URL;
 const httpBase = env && env.length
 ? env.replace(/\/$/,"")
 : `${window.location.protocol}//${window.location.hostname}:3001`;
 const url = `${httpBase.replace(/^http/,"ws")}/ws/databases/${databaseId}`;
 let ws: WebSocket;
 let closed = false;
 let ping: number | undefined;
 try {
 ws = new WebSocket(url);
 } catch {
 setLive("off");
 return;
 }
 ws.onopen = () => {
 if (!closed) setLive("on");
 ping = window.setInterval(() => {
 if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "PING" }));
 }, 25000);
 };
 ws.onmessage = (ev) => {
 try {
 const msg = JSON.parse(String(ev.data));
 if (msg.type === "SUBSCRIBED") {
 setLiveViewers(msg.liveViewers ?? 0);
 setLive("on");
 }
 if (msg.type === "ERROR") {
 setLive("off");
 return;
 }
 if (msg.type === "EVENT" && msg.event) {
 const e = msg.event;
 if (e.type === "PRESENCE_JOIN" || e.type === "PRESENCE_LEAVE") {
 setLiveViewers(e.payload?.liveViewers ?? 0);
 return;
 }
 // Always soft-refresh tables + active rows on any mutation event
 const schemaEvents = ["TABLE_CREATED","TABLE_DROPPED","TABLE_RENAMED","CSV_IMPORTED","COLUMN_ADDED","COLUMN_DROPPED","EXTERNAL_CHANGE"];
 const rowEvents = ["ROW_INSERTED","CELL_UPDATED","ROW_DELETED","CSV_IMPORTED","COLUMN_ADDED","COLUMN_DROPPED","EXTERNAL_CHANGE"];
 if (schemaEvents.includes(e.type) || e.type === "EXTERNAL_CHANGE") {
 loadTablesRef.current({ poll: true, silent: true });
 }
 const tid = (e.tableId as string | undefined) || activeTableIdRef.current;
 if (tid && (rowEvents.includes(e.type) || e.type === "EXTERNAL_CHANGE")) {
 loadRowsRef.current(tid, { poll: true });
 }
 if (tabRef.current === "audit") loadAuditRef.current({ poll: true });
 }
 } catch { /* ignore */ }
 };
 ws.onclose = () => {
 if (!closed) setLive("off");
 if (ping) clearInterval(ping);
 };
 ws.onerror = () => setLive("off");
 return () => {
 closed = true;
 if (ping) clearInterval(ping);
 try { ws.close(); } catch { /* */ }
 };
 }, [databaseId]);

 // Fallback poll when WS drops — keep light (WS handles ~100ms live path)
 useEffect(() => {
 if (!databaseId) return;
 const id = window.setInterval(() => {
 refreshFromServer();
 }, 2000);
 return () => clearInterval(id);
 }, [databaseId, refreshFromServer]);


 async function onCreateTable(e: React.FormEvent) {
 e.preventDefault();
 setCreating(true);
 const columns = colDrafts
 .map((c) => ({
 name: c.name.trim(),
 dataType: c.dataType,
 nullable: c.nullable,
 unique: c.unique,
 isPrimaryKey: false as boolean,
 }))
 .filter((c) => c.name.length > 0 && c.name.toLowerCase() !== "id");
 if (!columns.length) {
 toast.error("Create table failed", "Add at least one column (id is automatic)");
 setCreating(false);
 return;
 }
 const { data, error } = await api.createTable(databaseId, {
 name: tableName.trim(),
 columns,
 });
 setCreating(false);
 if (error) {
 toast.error("Create table failed", error.message);
 return;
 }
 if (data) {
 toast.success("Table created", data.table.name);
 setCreateOpen(false);
 setTableName("");
 setColDrafts([
 { name: "name", dataType: "text", nullable: true, unique: false, isPrimaryKey: false },
 ]);
 await loadTables({ poll: true, silent: true });
 setActiveTableId(data.table.id);
 setTab("data");
 }
 }

 async function onDropTable() {
 if (!dropTableTarget) return;
 const { error } = await api.dropTable(databaseId, dropTableTarget.id);
 if (error) {
 toast.error("Drop failed", error.message);
 return;
 }
 toast.success("Table deleted", dropTableTarget.name);
 setDropTableTarget(null);
 setActiveTableId(null);
 loadTables({ poll: true, silent: true });
 }

 async function onAddColumn(e: React.FormEvent) {
 e.preventDefault();
 if (!activeTableId) return;
 const { data, error } = await api.addColumn(databaseId, activeTableId, {
 name: newCol.name.trim(),
 dataType: newCol.dataType,
 nullable: newCol.nullable,
 unique: newCol.unique,
 });
 if (error) {
 toast.error("Add column failed", error.message);
 return;
 }
 toast.success("Column added", newCol.name);
 setAddColOpen(false);
 setNewCol({ name: "", dataType: "text", nullable: true, unique: false, isPrimaryKey: false });
 if (data) {
 setTables((prev) => prev.map((t) => (t.id === data.table.id ? data.table : t)));
 loadRows(activeTableId, { poll: true });
 }
 }

 async function onDropColumn(col: ColumnMeta) {
 if (!activeTableId) return;
 if (col.isPrimaryKey) {
 toast.error("Cannot drop primary key");
 return;
 }
 const { data, error } = await api.dropColumn(databaseId, activeTableId, col.id);
 if (error) {
 toast.error("Drop column failed", error.message);
 return;
 }
 toast.success("Column removed", col.name);
 if (data) {
 setTables((prev) => prev.map((t) => (t.id === data.table.id ? data.table : t)));
 loadRows(activeTableId, { poll: true });
 }
 }

 async function onInsert(e: React.FormEvent) {
 e.preventDefault();
 if (!activeTableId || !activeTable) return;
 setInserting(true);
 const values: Record<string, unknown> = {};
 for (const col of activeTable.columns) {
 // System-managed id — never send to API
 if (col.name.toLowerCase() === "id") continue;
 if (col.isPrimaryKey && String(col.dataType).toLowerCase() === "uuid") continue;
 values[col.id] = insertValues[col.id] ?? "";
 }
 const { error } = await api.insertRow(databaseId, activeTableId, values);
 setInserting(false);
 if (error) {
 toast.error("Insert failed", error.message);
 return;
 }
 toast.success("Row inserted");
 setInsertOpen(false);
 setInsertValues({});
 loadRows(activeTableId, { poll: true });
 }

 async function commitEdit() {
 if (!editing || !activeTableId) return;
 const { rowId, columnId, version, value } = editing;
 const { data, error } = await api.updateCell(
 databaseId,
 activeTableId,
 rowId,
 columnId,
 value,
 version
 );
 if (error) {
 if (error.code === "ROW_CONFLICT") {
 toast.error("Conflict","Row changed — reloading");
 loadRows(activeTableId, { poll: true });
 } else {
 toast.error("Update failed", error.message);
 }
 setEditing(null);
 return;
 }
 if (data) {
 setRows((prev) => prev.map((r) => (r.id === data.row.id ? data.row : r)));
 toast.success("Cell saved");
 }
 setEditing(null);
 }

 async function onDeleteRow(row: RowRecord) {
 if (!activeTableId) return;
 const { error } = await api.deleteRow(databaseId, activeTableId, row.id, row.version);
 if (error) {
 toast.error("Delete failed", error.message);
 if (error.code === "ROW_CONFLICT") loadRows(activeTableId, { poll: true });
 return;
 }
 toast.success("Row deleted");
 loadRows(activeTableId, { poll: true });
 }

 function displayValue(v: unknown): string {
 if (v === null || v === undefined) return"";
 if (typeof v === "object") return JSON.stringify(v);
 return String(v);
 }

  function auditTone(action: string): "green" | "blue" | "red" | "yellow" | "neutral" {
    const a = action.toLowerCase();
    if (a.includes("delete") || a.includes("drop")) return "red";
    if (a.includes("insert") || a.includes("create") || a.includes("import")) return "green";
    if (a.includes("update") || a.includes("rename") || a.includes("edit") || a.includes("column")) return "blue";
    return "neutral";
  }

  const TABS: Array<{ id: typeof tab; label: string }> = [
    { id: "data", label: `Data${activeTable ? ` (${totalRows})` : ""}` },
    { id: "schema", label: "Schema" },
    { id: "relations", label: "Relations" },
    { id: "audit", label: "History" },
  ];

  if (loading) {
    return <LoadingScreen label="Opening workspace…" />;
  }

  return (
    <div className="dt-ws-shell">
      {/* Top bar */}
      <header className="dt-topbar !px-4">
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark size={22} withWordmark={false} href="/dashboard" />
            <button type="button" onClick={() => router.push("/dashboard")} className="dt-back-link shrink-0">
              <span className="dt-back-chevron">
                <IconArrowLeft size={13} />
              </span>
              <span className="hidden sm:inline">Dashboard</span>
            </button>
            <span className="dt-crumb-sep hidden shrink-0 md:inline">/</span>
            <div className="hidden min-w-0 md:block">
              <p className="truncate text-sm font-semibold text-white">{database?.name ?? "Database"}</p>
              <p className="dt-mono truncate text-[10px] text-[var(--text-quaternary)]">{database?.dbCode}</p>
            </div>
            <span
              className={`dt-chip shrink-0 ${
                live === "on" ? "dt-chip-green" : live === "connecting" ? "dt-chip-yellow" : "dt-chip-neutral"
              }`}
              title="Realtime connection"
            >
              {live === "on" ? (
                <span className="dt-live-dot" />
              ) : live === "connecting" ? (
                <span className="dt-live-dot-yellow" />
              ) : (
                <IconWifiOff size={10} />
              )}
              <span className="hidden sm:inline">
                {live === "on" ? `Live · ${liveViewers}` : live === "connecting" ? "Connecting…" : "Offline"}
              </span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <a href="/docs" title="Documentation" className="dt-btn dt-btn-ghost dt-btn-icon !h-8 !w-8 hidden sm:inline-flex">
              <IconBook size={14} />
            </a>
            <a
              href={`/analytics/${databaseId}`}
              className="dt-btn dt-btn-ghost dt-btn-sm !h-8"
              style={{ color: "var(--blue-light)", borderColor: "var(--blue-border)" }}
            >
              <IconActivity size={13} />
              <span className="hidden lg:inline">Analytics</span>
            </a>
            <button
              type="button"
              onClick={async () => {
                if (!database) return;
                const r = await api.downloadDatabaseExport(databaseId, database.dbCode);
                if ("error" in r && r.error) toast.error("Export failed", r.error.message);
                else toast.success("Export downloaded", "JSON archive with schema + CSVs");
              }}
              className="dt-btn dt-btn-ghost dt-btn-sm !h-8"
            >
              <IconDownload size={13} />
              <span className="hidden lg:inline">Export</span>
            </button>
            <button type="button" onClick={() => setCsvOpen(true)} className="dt-btn dt-btn-ghost dt-btn-sm !h-8">
              <IconUpload size={13} />
              <span className="hidden lg:inline">Import CSV</span>
            </button>
            <button type="button" onClick={() => setCreateOpen(true)} className="dt-btn dt-btn-primary dt-btn-sm !h-8">
              <IconPlus size={13} />
              Table
            </button>
          </div>
        </div>
      </header>

      <div className="dt-ws-body">
        {/* Sidebar tables */}
        <aside className="dt-ws-sidebar p-2.5">
          <p className="dt-docs-group-label !pt-1">Tables · {tables.length}</p>
          {tables.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-[var(--text-quaternary)]">No tables yet</p>
          ) : (
            <ul className="dt-stagger space-y-0.5">
              {tables.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTableId(t.id);
                      setTab("data");
                    }}
                    className={`dt-ws-side-item ${activeTableId === t.id ? "dt-ws-side-item-active" : ""}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <IconTable size={13} className="shrink-0 opacity-70" />
                      <span className="truncate">{t.name}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
                      {Array.isArray(t.columns) ? t.columns.length : 0}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Main */}
        <section className="flex min-w-0 flex-1 flex-col">
          {!activeTable ? (
            <div className="dt-anim-fade flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-quaternary)]">
                <IconTable size={20} />
              </div>
              <p className="max-w-xs text-sm text-[var(--text-tertiary)]">
                Select or create a table to start editing.
              </p>
              <button type="button" onClick={() => setCreateOpen(true)} className="dt-btn dt-btn-primary dt-btn-sm">
                <IconPlus size={13} />
                Create table
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-4">
                  <h2 className="truncate text-sm font-semibold text-white">{activeTable.name}</h2>
                  <div className="dt-tabs !border-b-0">
                    {TABS.map((tItem) => (
                      <button
                        key={tItem.id}
                        type="button"
                        onClick={() => setTab(tItem.id)}
                        className={`dt-tab !px-3 !py-1.5 !text-xs ${tab === tItem.id ? "dt-tab-active" : ""}`}
                      >
                        {tItem.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {tab === "data" && (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!activeTable) return;
                          const r = await api.downloadTableCsv(databaseId, activeTable.id, activeTable.name);
                          if ("error" in r && r.error) toast.error("Export failed", r.error.message);
                          else toast.success("CSV downloaded", activeTable.name);
                        }}
                        className="dt-btn dt-btn-subtle dt-btn-xs"
                      >
                        <IconDownload size={11} />
                        Export CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setInsertValues({});
                          setInsertOpen(true);
                        }}
                        className="dt-btn dt-btn-subtle dt-btn-xs"
                      >
                        <IconPlus size={11} />
                        Insert row
                      </button>
                    </>
                  )}
                  {tab === "schema" && (
                    <button type="button" onClick={() => setAddColOpen(true)} className="dt-btn dt-btn-subtle dt-btn-xs">
                      <IconPlus size={11} />
                      Add column
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (!activeTable) return;
                      setRenameValue(activeTable.name);
                      setRenameOpen(true);
                    }}
                    className="dt-btn dt-btn-subtle dt-btn-xs"
                  >
                    <IconPencil size={11} />
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => setDropTableTarget(activeTable)}
                    className="dt-btn dt-btn-xs"
                    style={{ color: "var(--red-light)", border: "1px solid var(--red-border)", background: "transparent" }}
                  >
                    <IconTrash size={11} />
                    Drop
                  </button>
                </div>
              </div>

              {tab === "audit" ? (
                <div className="min-h-0 flex-1 overflow-auto p-4">
                  <p className="mb-3 flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
                    <IconHistory size={12} />
                    Last 100 changes {activeTable ? `for ${activeTable.name}` : "(database-wide)"}. Immutable.
                  </p>
                  {audit.length === 0 ? (
                    <p className="text-sm text-[var(--text-tertiary)]">No history yet — make an edit.</p>
                  ) : (
                    <ul className="dt-stagger space-y-2">
                      {audit.map((e) => {
                        const tone = auditTone(e.action);
                        return (
                          <li
                            key={e.changeId}
                            className="dt-card rounded-[var(--r-md)] px-3.5 py-2.5"
                            style={{ borderLeft: `2.5px solid var(--${tone === "neutral" ? "border-strong" : tone})` }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm text-white">{e.summary}</p>
                                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-[var(--text-quaternary)]">
                                  <span className="dt-mono text-[var(--blue-light)]/80">@{e.actorUsername}</span>
                                  <span>·</span>
                                  <span
                                    className="uppercase tracking-wide"
                                    style={{ color: tone === "neutral" ? "var(--text-tertiary)" : `var(--${tone}-light)` }}
                                  >
                                    {e.action}
                                  </span>
                                  {e.tableName ? <span>· {e.tableName}</span> : null}
                                </p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="dt-mono text-[10px] text-[var(--text-quaternary)]">
                                  {e.changeId.slice(0, 10)}
                                </p>
                                <p className="text-[10px] text-[var(--text-quaternary)]">
                                  {new Date(e.createdAt).toLocaleString()}
                                </p>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ) : tab === "relations" ? (
                <RelationsPanel databaseId={databaseId} />
              ) : tab === "schema" ? (
                <div className="min-h-0 flex-1 overflow-auto p-4">
                  <div className="dt-table-wrap">
                    <table className="dt-table">
                      <thead>
                        <tr>
                          <th>Column</th>
                          <th>Type</th>
                          <th>Flags</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {activeTable.columns.map((c) => (
                          <tr key={c.id}>
                            <td className="dt-mono text-[var(--blue-light)]">{c.name}</td>
                            <td>{c.dataType}</td>
                            <td>
                              <span className="flex flex-wrap gap-1">
                                {c.isPrimaryKey && <span className="dt-chip dt-chip-yellow">PK</span>}
                                {c.unique && !c.isPrimaryKey && <span className="dt-chip dt-chip-blue">UNIQUE</span>}
                                <span className="dt-chip dt-chip-neutral">{c.nullable ? "nullable" : "required"}</span>
                              </span>
                            </td>
                            <td className="text-right">
                              {!c.isPrimaryKey && (
                                <button
                                  type="button"
                                  onClick={() => onDropColumn(c)}
                                  className="text-[var(--red-light)] transition hover:text-[var(--red)]"
                                  title="Drop column"
                                >
                                  <IconTrash size={13} />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-xs text-[var(--text-quaternary)]">
                    Schema version {activeTable.schemaVersion}
                  </p>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="dt-table w-full min-w-max">
                    <thead className="sticky top-0 z-[1] bg-[var(--surface-0)]">
                      <tr>
                        <th className="w-10 text-right">#</th>
                        {activeTable.columns.map((c) => (
                          <th key={c.id} className="whitespace-nowrap">
                            {c.name}
                            <span className="ml-1.5 font-normal normal-case tracking-normal text-[var(--text-quaternary)]">
                              {c.dataType}
                            </span>
                          </th>
                        ))}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={activeTable.columns.length + 2} className="py-14 text-center">
                            <div className="flex flex-col items-center gap-2 text-[var(--text-quaternary)]">
                              <IconTable size={18} />
                              <span>No rows — insert one to begin.</span>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        rows.map((row, ri) => (
                          <tr key={row.id} className="dt-row-in" style={{ ["--dt-i" as string]: ri }}>
                            <td className="dt-mono text-right text-[var(--text-quaternary)]">{ri + 1}</td>
                            {activeTable.columns.map((c) => {
                              const isEdit = editing?.rowId === row.id && editing?.columnId === c.id;
                              return (
                                <td
                                  key={c.id}
                                  className={`dt-mono max-w-[240px] truncate ${isEdit ? "dt-table-cell-editing !bg-transparent" : ""}`}
                                  onDoubleClick={() => {
                                    if (c.name.toLowerCase() === "id" || (c.isPrimaryKey && String(c.dataType).toLowerCase() === "uuid")) return;
                                    setEditing({
                                      rowId: row.id,
                                      columnId: c.id,
                                      version: row.version,
                                      value: displayValue(row.values[c.id]),
                                    });
                                  }}
                                >
                                  {isEdit ? (
                                    <span className="flex items-center gap-1.5">
                                      <input
                                        autoFocus
                                        value={editing.value}
                                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                        onBlur={() => commitEdit()}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") commitEdit();
                                          if (e.key === "Escape") setEditing(null);
                                        }}
                                        className="dt-mono w-full rounded-[5px] border border-[var(--blue)] bg-black px-1.5 py-1 text-xs text-white outline-none"
                                        style={{ boxShadow: "0 0 0 3px var(--blue-soft-strong)" }}
                                      />
                                      <span className="dt-kbd shrink-0">↵</span>
                                    </span>
                                  ) : (
                                    <span className={row.values[c.id] == null ? "text-[var(--text-quaternary)]" : "text-[var(--text-secondary)]"}>
                                      {row.values[c.id] == null ? "NULL" : displayValue(row.values[c.id])}
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="text-right">
                              <button
                                type="button"
                                onClick={() => onDeleteRow(row)}
                                className="text-[var(--text-quaternary)] transition hover:text-[var(--red-light)]"
                                title="Delete row"
                              >
                                <IconTrash size={12} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  <p className="flex items-center gap-1.5 px-3.5 py-2.5 text-[10px] text-[var(--text-quaternary)]">
                    <IconPencil size={10} />
                    Double-click a cell to edit · optimistic concurrency on version
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* Create table */}
      <Modal open={createOpen} onClose={() => !creating && setCreateOpen(false)} title="Create table" size="lg" tone="info">
        <form onSubmit={onCreateTable} className="space-y-4">
          <label className="dt-field block">
            <span className="dt-label">Table name</span>
            <input
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              required
              pattern="[A-Za-z][A-Za-z0-9_]{0,62}"
              placeholder="users"
              className="dt-input dt-mono"
              autoFocus
            />
          </label>
          <div>
            <p className="dt-label !mb-2">Columns</p>
            <div className="space-y-2">
              {colDrafts.map((c, i) => (
                <div key={i} className="dt-inset flex flex-wrap items-center gap-2 p-2">
                  <input
                    value={c.name}
                    onChange={(e) => {
                      const next = [...colDrafts];
                      next[i] = { ...c, name: e.target.value };
                      setColDrafts(next);
                    }}
                    placeholder="column"
                    className="dt-mono w-28 rounded-[6px] border border-[var(--border-strong)] bg-black px-2 py-1.5 text-xs text-white outline-none focus:border-[var(--blue)]"
                  />
                  <select
                    value={c.dataType}
                    onChange={(e) => {
                      const next = [...colDrafts];
                      next[i] = { ...c, dataType: e.target.value as DataType };
                      setColDrafts(next);
                    }}
                    className="dt-select !w-auto rounded-[6px] !py-1.5 !text-xs"
                  >
                    {DATA_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <label className="dt-checkbox-row !text-[11px]">
                    <input
                      type="checkbox"
                      checked={c.nullable}
                      onChange={(e) => {
                        const next = [...colDrafts];
                        next[i] = { ...c, nullable: e.target.checked };
                        setColDrafts(next);
                      }}
                    />
                    null
                  </label>
                  {colDrafts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setColDrafts(colDrafts.filter((_, j) => j !== i))}
                      className="ml-auto text-[var(--red-light)] transition hover:text-[var(--red)]"
                      title="Remove column"
                    >
                      <IconX size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[var(--text-quaternary)] mt-2">
              A system <span className="dt-chip dt-chip-yellow">id</span> (uuid) is always added automatically and cannot be set by users.
            </p>

            <button
              type="button"
              onClick={() =>
                setColDrafts([
                  ...colDrafts,
                  { name: "", dataType: "text", nullable: true, unique: false, isPrimaryKey: false },
                ])
              }
              className="dt-btn dt-btn-text mt-2.5 !text-[var(--blue-light)]"
            >
              <IconPlus size={12} />
              Add column
            </button>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setCreateOpen(false)} className="dt-btn dt-btn-text">
              Cancel
            </button>
            <button type="submit" disabled={creating || !tableName.trim()} className="dt-btn dt-btn-primary">
              {creating ? (
                <>
                  <IconLoader size={14} />
                  Creating…
                </>
              ) : (
                "Create table"
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add column */}
      <Modal open={addColOpen} onClose={() => setAddColOpen(false)} title="Add column" tone="info">
        <form onSubmit={onAddColumn} className="space-y-4">
          <label className="dt-field block">
            <span className="dt-label">Name</span>
            <input
              value={newCol.name}
              onChange={(e) => setNewCol({ ...newCol, name: e.target.value })}
              required
              placeholder="column_name"
              className="dt-input dt-mono"
              autoFocus
            />
          </label>
          <label className="dt-field block">
            <span className="dt-label">Type</span>
            <select
              value={newCol.dataType}
              onChange={(e) => setNewCol({ ...newCol, dataType: e.target.value as DataType })}
              className="dt-select"
            >
              {DATA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="dt-checkbox-row">
            <input
              type="checkbox"
              checked={newCol.nullable}
              onChange={(e) => setNewCol({ ...newCol, nullable: e.target.checked })}
            />
            Nullable
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setAddColOpen(false)} className="dt-btn dt-btn-text">
              Cancel
            </button>
            <button type="submit" className="dt-btn dt-btn-primary">
              <IconPlus size={13} />
              Add
            </button>
          </div>
        </form>
      </Modal>

      {/* Insert row */}
      <Modal open={insertOpen} onClose={() => !inserting && setInsertOpen(false)} title="Insert row" size="lg" tone="success">
        {activeTable && (
          <form onSubmit={onInsert} className="space-y-3.5">
            {activeTable.columns
              .filter((c) => {
                const n = c.name.toLowerCase();
                const dt = String(c.dataType).toLowerCase();
                if (n === "id") return false;
                if (c.isPrimaryKey && dt === "uuid") return false;
                return true;
              })
              .map((c) => (
              <label key={c.id} className="dt-field block">
                <span className="dt-label !mb-1.5 !normal-case !tracking-normal">
                  <span className="text-[var(--text-secondary)]">{c.name}</span>{" "}
                  <span className="text-[var(--text-quaternary)]">
                    {c.dataType}
                    {c.nullable ? "" : " · required"}
                  </span>
                </span>
                <input
                  value={insertValues[c.id] ?? ""}
                  onChange={(e) => setInsertValues({ ...insertValues, [c.id]: e.target.value })}
                  className="dt-input dt-mono"
                  required={!c.nullable}
                />
              </label>
            ))}
            {activeTable.columns.some((c) => {
              const n = c.name.toLowerCase();
              const dt = String(c.dataType).toLowerCase();
              return n === "id" || (c.isPrimaryKey && dt === "uuid");
            }) && (
              <p className="text-[11px] text-[var(--text-quaternary)]">
                <span className="dt-chip dt-chip-yellow mr-1">id</span>
                auto-generated — not editable
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setInsertOpen(false)} className="dt-btn dt-btn-text">
                Cancel
              </button>
              <button type="submit" disabled={inserting} className="dt-btn dt-btn-success">
                {inserting ? (
                  <>
                    <IconLoader size={14} />
                    Inserting…
                  </>
                ) : (
                  <>
                    <IconPlus size={13} />
                    Insert
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Rename table */}
      <Modal open={renameOpen} onClose={() => !renaming && setRenameOpen(false)} title="Rename table" tone="info">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!activeTable) return;
            const name = renameValue.trim();
            if (!name || name === activeTable.name) {
              setRenameOpen(false);
              return;
            }
            setRenaming(true);
            const { data, error } = await api.renameTable(databaseId, activeTable.id, name);
            setRenaming(false);
            if (error) {
              toast.error("Rename failed", error.message);
              return;
            }
            toast.success("Table renamed", data?.table.name);
            setRenameOpen(false);
            await loadTables({ poll: true, silent: true });
          }}
        >
          <label className="dt-field block">
            <span className="dt-label">New name</span>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              required
              maxLength={63}
              pattern="[a-zA-Z][a-zA-Z0-9_]*"
              title="Letter first, then letters, numbers, underscore"
              className="dt-input dt-mono"
              autoFocus
            />
          </label>
          <p className="dt-hint !mt-0">Must start with a letter; only letters, numbers, underscore.</p>
          <div className="flex justify-end gap-2">
            <button type="button" disabled={renaming} onClick={() => setRenameOpen(false)} className="dt-btn dt-btn-text">
              Cancel
            </button>
            <button type="submit" disabled={renaming || !renameValue.trim()} className="dt-btn dt-btn-primary">
              {renaming ? (
                <>
                  <IconLoader size={14} />
                  Renaming…
                </>
              ) : (
                "Rename"
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Drop table */}
      <Modal open={!!dropTableTarget} onClose={() => setDropTableTarget(null)} title="Drop table" tone="danger">
        {dropTableTarget && (
          <div className="space-y-4">
            <div className="dt-callout dt-callout-danger">
              <IconTrash size={15} />
              <span>
                Delete table <span className="dt-code-inline">{dropTableTarget.name}</span> and all its rows? This
                cannot be undone.
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDropTableTarget(null)} className="dt-btn dt-btn-text">
                Cancel
              </button>
              <button type="button" onClick={onDropTable} className="dt-btn dt-btn-danger">
                <IconTrash size={13} />
                Drop table
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Import CSV */}
      <Modal open={csvOpen} onClose={() => !importing && setCsvOpen(false)} title="Import CSV" size="lg" tone="info">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setImporting(true);
            const { data, error } = await api.importCsv(databaseId, csvName.trim(), csvText);
            setImporting(false);
            if (error) {
              toast.error("Import failed", error.message);
              return;
            }
            if (data) {
              const skipped = (data as { skipped?: number }).skipped ?? 0;
              toast.success(
                "Imported",
                skipped
                  ? `${data.imported} rows → ${data.table.name} (${skipped} invalid rows skipped)`
                  : `${data.imported} rows → ${data.table.name}`
              );
              setCsvOpen(false);
              setCsvName("");
              setCsvText("");
              await loadTables({ poll: true, silent: true });
              setActiveTableId(data.table.id);
              setTab("data");
            }
          }}
          className="space-y-3.5"
        >
          <p className="dt-hint !mt-0 !text-[var(--text-tertiary)]">
            Creates a <strong className="text-[var(--text-secondary)]">new empty table</strong> from the CSV header +
            rows. Types are inferred (boolean / integer / numeric / text). Max 5000 rows.
          </p>
          <label className="dt-field block">
            <span className="dt-label">Table name</span>
            <input
              value={csvName}
              onChange={(e) => setCsvName(e.target.value)}
              required
              placeholder="table_name"
              pattern="[A-Za-z][A-Za-z0-9_]{0,62}"
              className="dt-input dt-mono"
            />
          </label>
          <label className="dt-field block">
            <span className="dt-label">CSV content</span>
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              required
              rows={8}
              placeholder={"id,name,email\n1,Ada,ada@example.com"}
              className="dt-textarea dt-mono !text-xs"
            />
          </label>
          <label className="dt-field block">
            <span className="dt-label">Or choose file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="block w-full text-xs text-[var(--text-tertiary)] file:mr-3 file:rounded-[6px] file:border file:border-[var(--border-strong)] file:bg-[var(--surface-2)] file:px-3 file:py-1.5 file:text-xs file:text-white"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const text = await f.text();
                setCsvText(text);
                if (!csvName) setCsvName(f.name.replace(/\.csv$/i, "").replace(/[^a-zA-Z0-9_]/g, "_") || "imported");
              }}
            />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setCsvOpen(false)} className="dt-btn dt-btn-text">
              Cancel
            </button>
            <button
              type="submit"
              disabled={importing || !csvName.trim() || !csvText.trim()}
              className="dt-btn dt-btn-primary"
            >
              {importing ? (
                <>
                  <IconLoader size={14} />
                  Importing…
                </>
              ) : (
                <>
                  <IconUpload size={13} />
                  Import
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
