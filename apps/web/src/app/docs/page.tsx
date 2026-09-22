"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
import {
  IconActivity,
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconCopy,
  IconDatabase,
  IconGitBranch,
  IconHistory,
  IconInfo,
  IconKey,
  IconLock,
  IconMenu,
  IconPencil,
  IconSearch,
  IconSettings,
  IconShield,
  IconSparkles,
  IconTable,
  IconTerminal,
  IconUpload,
  IconUsers,
  IconWifi,
  IconX,
  IconZap,
} from "@/components/icons";

type IconFn = (p: { size?: number; className?: string }) => ReactNode;

type SectionMeta = { id: string; title: string; group: string; icon: IconFn };

const GROUPS = [
  "Start here",
  "Teams",
  "Databases & schema",
  "Working with data",
  "Operate",
  "Reference",
] as const;

const SECTIONS: SectionMeta[] = [
  { id: "overview", title: "Overview", group: "Start here", icon: IconSparkles },
  { id: "quick-start", title: "Quick start", group: "Start here", icon: IconZap },
  { id: "teams-roles", title: "Teams & roles", group: "Teams", icon: IconUsers },
  { id: "team-governance", title: "Governance", group: "Teams", icon: IconShield },
  { id: "databases", title: "Databases", group: "Databases & schema", icon: IconDatabase },
  { id: "tables-columns", title: "Tables & columns", group: "Databases & schema", icon: IconTable },
  { id: "schema-tools", title: "Schema tools", group: "Databases & schema", icon: IconSettings },
  { id: "relations", title: "Relations", group: "Databases & schema", icon: IconGitBranch },
  { id: "editing-data", title: "Editing data", group: "Working with data", icon: IconPencil },
  { id: "realtime", title: "Realtime sync", group: "Working with data", icon: IconWifi },
  { id: "history", title: "History & audit", group: "Working with data", icon: IconHistory },
  { id: "csv", title: "Import & export", group: "Working with data", icon: IconUpload },
  { id: "analytics", title: "Analytics", group: "Operate", icon: IconActivity },
  { id: "connecting", title: "Connecting externally", group: "Operate", icon: IconKey },
  { id: "security", title: "Security model", group: "Operate", icon: IconLock },
  { id: "tips", title: "Tips & shortcuts", group: "Reference", icon: IconTerminal },
  { id: "faq", title: "FAQ", group: "Reference", icon: IconInfo },
];

function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="dt-anchor-heading group flex scroll-mt-24 items-center">
      {children}
      <a href={`#${id}`} className="dt-anchor-link" aria-label={`Link to ${id}`}>
        <IconHashSmall />
      </a>
    </h2>
  );
}

function IconHashSmall() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="5" y1="9" x2="19" y2="9" />
      <line x1="4.5" y1="15" x2="18.5" y2="15" />
      <line x1="10" y1="4" x2="7.5" y2="20" />
      <line x1="16" y1="4" x2="13.5" y2="20" />
    </svg>
  );
}

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="dt-code-block">
      {label && <p className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-quaternary)]">{label}</p>}
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          });
        }}
        className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-tertiary)] transition hover:text-white"
        aria-label="Copy"
      >
        {copied ? <IconCheck size={11} className="text-[var(--green-light)]" /> : <IconCopy size={11} />}
      </button>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all pr-6">{code}</pre>
    </div>
  );
}

function Callout({ tone, children }: { tone: "info" | "warn" | "danger"; children: ReactNode }) {
  const Icon = tone === "info" ? IconInfo : tone === "warn" ? IconAlertTriangle : IconAlertTriangle;
  return (
    <div className={`dt-callout dt-callout-${tone}`}>
      <Icon size={15} />
      <span>{children}</span>
    </div>
  );
}

export default function DocsPage() {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const [query, setQuery] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setActiveId((prev) => {
          const visible = entries.filter((e) => e.isIntersecting);
          if (visible.length === 0) return prev;
          visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          return visible[0].target.id;
        });
      },
      { rootMargin: "-10% 0px -75% 0px", threshold: 0 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const filtered = useMemo(
    () => SECTIONS.filter((s) => s.title.toLowerCase().includes(query.toLowerCase())),
    [query]
  );

  const NavList = (
    <>
      <label className="dt-focus-ring mb-3 flex items-center gap-2 rounded-[var(--r-md)] border border-[var(--border)] bg-black px-2.5 py-2">
        <IconSearch size={13} className="text-[var(--text-quaternary)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search docs…"
          className="w-full bg-transparent text-[13px] text-white outline-none placeholder:text-[var(--text-quaternary)]"
        />
      </label>
      {GROUPS.map((g) => {
        const items = filtered.filter((s) => s.group === g);
        if (items.length === 0) return null;
        return (
          <div key={g}>
            <p className="dt-docs-group-label">{g}</p>
            {items.map((s) => {
              const Icon = s.icon;
              return (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  onClick={() => setMobileNavOpen(false)}
                  className={`dt-docs-nav-link ${activeId === s.id ? "dt-docs-nav-link-active" : ""}`}
                >
                  <Icon size={13} />
                  {s.title}
                </a>
              );
            })}
          </div>
        );
      })}
    </>
  );

  return (
    <div className="dt-shell min-h-screen">
      <header className="dt-topbar">
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setMobileNavOpen((v) => !v)}
              className="dt-btn dt-btn-ghost dt-btn-icon !h-8 !w-8 lg:hidden"
              aria-label="Toggle navigation"
            >
              {mobileNavOpen ? <IconX size={15} /> : <IconMenu size={15} />}
            </button>
            <BrandMark size={22} />
          </div>
          <nav className="flex items-center gap-5">
            <a href="/" className="dt-back-link">
              <span className="dt-back-chevron">
                <IconArrowLeft size={13} />
              </span>
              Home
            </a>
            <a href="/signin" className="dt-nav-link hidden sm:inline">
              Sign in
            </a>
            <a href="/create-team" className="dt-btn dt-btn-primary dt-btn-sm">
              Create team
            </a>
          </nav>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1280px]">
        {/* Desktop sidebar */}
        <nav className="dt-docs-sidebar hidden lg:block">{NavList}</nav>

        {/* Mobile drawer */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-[80] lg:hidden">
            <button
              className="absolute inset-0 dt-modal-scrim"
              aria-label="Close navigation"
              onClick={() => setMobileNavOpen(false)}
            />
            <nav className="dt-anim-slide-down relative h-full w-72 overflow-y-auto border-r border-[var(--border)] bg-[var(--surface-0)] p-4 pt-[calc(var(--header-h)+12px)]">
              {NavList}
            </nav>
          </div>
        )}

        <main className="dt-docs-main dt-prose min-w-0 px-6 py-10 sm:px-10 lg:py-14">
          <div className="mx-auto max-w-[720px] space-y-16">
            <div className="dt-anim-in">
              <p className="dt-eyebrow mb-3">
                <IconSparkles size={12} />
                Documentation
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-white">DragTable guide</h1>
              <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-secondary)]">
                Everything a team needs to provision, model, and operate relational databases visually —
                without writing SQL by hand.
              </p>
            </div>

            {/* ---------------- OVERVIEW ---------------- */}
            <section id="overview" className="dt-doc-section space-y-4">
              <H2 id="overview-h">Overview</H2>
              <p>
                DragTable is a self-hosted, visual relational database platform. A team creates real
                Postgres databases, then designs tables, relations, and data through structured controls
                instead of writing SQL. Every mutation — creating a table, adding a foreign key, editing a
                cell — is validated and executed server-side, so the schema and data stay consistent no
                matter who is making the change.
              </p>
              <p>The core building blocks:</p>
              <ul>
                <li>
                  <strong>Team</strong> — the container for members and databases, identified by a
                  5-character Team ID.
                </li>
                <li>
                  <strong>Database</strong> — one provisioned Postgres database with its own auth key,
                  status, and schema version.
                </li>
                <li>
                  <strong>Table</strong> — a set of typed columns, primary keys, and constraints, edited
                  from the Workspace.
                </li>
                <li>
                  <strong>Workspace</strong> — the live, collaborative screen where a database's data,
                  schema, relations, and history live.
                </li>
              </ul>
              <Callout tone="info">
                Nothing here executes arbitrary SQL from the browser. Every schema and data change goes
                through a validated, structured operation — see <a href="#security" className="dt-code-inline no-underline">Security model</a>.
              </Callout>
            </section>

            {/* ---------------- QUICK START ---------------- */}
            <section id="quick-start" className="dt-doc-section space-y-1">
              <H2 id="quick-start-h">Quick start</H2>
              <p className="mb-5">Five steps from nothing to a working, shared database.</p>
              <div>
                {[
                  {
                    title: "Create or join a team",
                    body: "Create a team to become its admin, or join an existing one with the 5-character Team ID your admin shares with you.",
                  },
                  {
                    title: "Create a database",
                    body: "From the dashboard, admins create a database. The auth key is shown exactly once — copy it before closing the dialog.",
                  },
                  {
                    title: "Model your first table",
                    body: "Open the workspace, create a table, and add typed columns — text, integer, numeric, boolean, date, timestamp, uuid, or jsonb.",
                  },
                  {
                    title: "Add data",
                    body: "Insert rows one at a time from the Data tab, or import a CSV to create a populated table in one step.",
                  },
                  {
                    title: "Invite your team",
                    body: "Share the Team ID with teammates so they can join and start collaborating in the same workspace, live.",
                  },
                ].map((s, i) => (
                  <div key={s.title} className="dt-kbd-step">
                    <span className="dt-kbd-step-num">{i + 1}</span>
                    <div className="pb-1">
                      <p className="font-semibold text-white">{s.title}</p>
                      <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--text-tertiary)]">{s.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ---------------- TEAMS & ROLES ---------------- */}
            <section id="teams-roles" className="dt-doc-section space-y-4">
              <H2 id="teams-roles-h">Teams &amp; roles</H2>
              <p>
                Every account belongs to one or more teams. Teams have exactly two roles:{" "}
                <strong>admin</strong> (the creator, with full control over databases and membership) and{" "}
                <strong>member</strong> (granted specific permissions by an admin).
              </p>
              <p>Plans set limits on databases, tables per database, and members. All plans are available without payment:</p>
              <div className="dt-table-wrap">
                <table className="dt-table">
                  <thead>
                    <tr>
                      <th>Plan</th>
                      <th>Databases</th>
                      <th>Tables / database</th>
                      <th>Members</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="text-white">Personal</td>
                      <td>1</td>
                      <td>5</td>
                      <td>5</td>
                    </tr>
                    <tr>
                      <td className="text-white">Startup</td>
                      <td>5</td>
                      <td>10</td>
                      <td>50</td>
                    </tr>
                    <tr>
                      <td className="text-white">Enterprise</td>
                      <td>10</td>
                      <td>100</td>
                      <td>100</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* ---------------- GOVERNANCE ---------------- */}
            <section id="team-governance" className="dt-doc-section space-y-4">
              <H2 id="team-governance-h">Governance</H2>
              <p>
                The <span className="dt-code-inline">Team</span> screen is an admin's control panel for
                membership. Admins can remove a member (revokes access to every database immediately) and
                grant members a specific combination of permissions:
              </p>
              <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {[
                  "table.create",
                  "table.delete",
                  "table.edit_schema",
                  "data.insert",
                  "data.update",
                  "data.delete",
                  "csv.import",
                  "csv.export",
                  "audit.read",
                ].map((p) => (
                  <li key={p}>
                    <span className="dt-code-inline">{p}</span>
                  </li>
                ))}
              </ul>
              <p>
                A running notification log records key events — joins, removals, permission changes — so
                admins have a record of who changed what at the team level.
              </p>
            </section>

            {/* ---------------- DATABASES ---------------- */}
            <section id="databases" className="dt-doc-section space-y-4">
              <H2 id="databases-h">Databases</H2>
              <p>
                Each database record maps to one real, isolated Postgres database. Admins create databases
                from the dashboard; each one gets a short <span className="dt-code-inline">dbCode</span>,
                a status (<span className="dt-code-inline">provisioning</span> →{" "}
                <span className="dt-code-inline">active</span>), and a schema version that increments with
                every structural change.
              </p>
              <Callout tone="warn">
                The auth key is displayed <strong>once</strong>, at creation time. It is the Postgres
                password used by application connections — store it in a secrets manager immediately. If
                it's lost, rotate credentials from <a href="#connecting" className="dt-code-inline no-underline">Connecting externally</a>.
              </Callout>
              <p>
                From the dashboard, a database can also be exported as a full JSON archive (schema + every
                table's data) or deleted — deletion requires typing the database's exact name to confirm.
              </p>
            </section>

            {/* ---------------- TABLES & COLUMNS ---------------- */}
            <section id="tables-columns" className="dt-doc-section space-y-4">
              <H2 id="tables-columns-h">Tables &amp; columns</H2>
              <p>
                A table is a name plus an ordered set of columns. When creating a table you define each
                column's name, data type, and flags:
              </p>
              <div className="dt-table-wrap">
                <table className="dt-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Use for</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["text", "Free-form strings"],
                      ["integer", "Whole numbers"],
                      ["numeric", "Exact decimals — money, measurements"],
                      ["boolean", "True / false flags"],
                      ["date", "Calendar dates without a time"],
                      ["timestamp", "Date + time"],
                      ["uuid", "Identifiers — the default primary key type"],
                      ["jsonb", "Structured, semi-schema-less data"],
                    ].map(([t, d]) => (
                      <tr key={t}>
                        <td className="dt-mono text-[var(--blue-light)]">{t}</td>
                        <td>{d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                Every table needs exactly one primary key. Marking a column as the primary key
                automatically makes it unique and non-nullable — a <span className="dt-code-inline">uuid</span>{" "}
                primary key is generated for you on insert if you leave it blank.
              </p>
            </section>

            {/* ---------------- SCHEMA TOOLS ---------------- */}
            <section id="schema-tools" className="dt-doc-section space-y-4">
              <H2 id="schema-tools-h">Schema tools</H2>
              <p>From the workspace's <strong>Schema</strong> tab and table toolbar, you can:</p>
              <ul>
                <li>
                  <strong>Add a column</strong> — name, type, and whether it's nullable.
                </li>
                <li>
                  <strong>Drop a column</strong> — any non-primary-key column can be removed; existing data
                  in that column is dropped with it.
                </li>
                <li>
                  <strong>Rename the table</strong> — must start with a letter and use only letters,
                  numbers, and underscores.
                </li>
                <li>
                  <strong>Drop the table</strong> — permanently deletes the table and every row in it,
                  after confirmation.
                </li>
              </ul>
              <p>Every structural change bumps the table's schema version, visible at the bottom of the Schema tab.</p>
            </section>

            {/* ---------------- RELATIONS ---------------- */}
            <section id="relations" className="dt-doc-section space-y-4">
              <H2 id="relations-h">Relations</H2>
              <p>
                The <strong>Relations</strong> tab manages structured constraints across the whole
                database and renders a live entity-relationship diagram from them:
              </p>
              <ul>
                <li>
                  <strong>Foreign keys</strong> — link a child column to a parent's column, with an{" "}
                  <span className="dt-code-inline">ON DELETE</span> policy: restrict, cascade, or set null.
                </li>
                <li>
                  <strong>Indexes</strong> — single or multi-column, optionally unique, for lookup speed
                  and uniqueness guarantees.
                </li>
                <li>
                  <strong>Check constraints</strong> — structured comparisons (not-null, =, ≠, &gt;, ≥,
                  &lt;, ≤) enforced on every write. No free-form SQL expressions.
                </li>
              </ul>
              <p>
                Each of the three panels lists existing constraints with a one-click drop, and a compact
                form for adding new ones scoped to the tables already in the database.
              </p>
            </section>

            {/* ---------------- EDITING DATA ---------------- */}
            <section id="editing-data" className="dt-doc-section space-y-4">
              <H2 id="editing-data-h">Editing data</H2>
              <p>
                The <strong>Data</strong> tab is a spreadsheet-style grid. Double-click any cell to edit it
                inline; press <span className="dt-kbd">↵</span> to save or <span className="dt-kbd">Esc</span>{" "}
                to cancel. New rows are added through the Insert row dialog, and any row can be deleted from
                its row action.
              </p>
              <Callout tone="info">
                Every row carries a <span className="dt-code-inline">version</span> number. If someone else
                changes a row while you're editing it, your save is rejected with a conflict notice and the
                grid reloads the latest value automatically — edits never silently overwrite each other.
              </Callout>
            </section>

            {/* ---------------- REALTIME ---------------- */}
            <section id="realtime" className="dt-doc-section space-y-4">
              <H2 id="realtime-h">Realtime sync</H2>
              <p>
                Opening a workspace establishes a WebSocket connection, shown as a status badge in the
                header: <span className="dt-chip dt-chip-green mx-1"><span className="dt-live-dot" />Live</span>{" "}
                with a live viewer count, <span className="dt-chip dt-chip-yellow mx-1"><span className="dt-live-dot-yellow" />Connecting</span>,
                or <span className="dt-chip dt-chip-neutral mx-1">Offline</span>.
              </p>
              <p>
                Schema and data changes from any teammate — or from a tool connected directly with your
                personal credentials — push to every open workspace automatically. If the socket drops, a
                lightweight poll keeps the workspace eventually consistent until it reconnects.
              </p>
            </section>

            {/* ---------------- HISTORY ---------------- */}
            <section id="history" className="dt-doc-section space-y-4">
              <H2 id="history-h">History &amp; audit</H2>
              <p>
                The <strong>History</strong> tab shows the last 100 changes, scoped to the active table or
                database-wide. Every entry is immutable and records the actor's username, the action taken,
                the affected table, and a timestamp — useful for reconstructing who changed what, and when.
              </p>
            </section>

            {/* ---------------- CSV ---------------- */}
            <section id="csv" className="dt-doc-section space-y-4">
              <H2 id="csv-h">Import &amp; export</H2>
              <p>
                <strong>Import CSV</strong> always creates a <em>new</em> table from the file's header row
                and data. Column types are inferred automatically (boolean, integer, numeric, or text), up
                to 5,000 rows per import — rows that don't parse cleanly are skipped and reported in the
                success message rather than failing the whole import.
              </p>
              <p>
                <strong>Export</strong> works two ways: a single table as CSV, or the entire database as a
                JSON archive containing the full schema plus every table's data.
              </p>
            </section>

            {/* ---------------- ANALYTICS ---------------- */}
            <section id="analytics" className="dt-doc-section space-y-4">
              <H2 id="analytics-h">Analytics</H2>
              <p>
                Each database has an analytics view with reads/sec, writes/sec, calls/min, and average +
                peak latency, charted over 1 hour, 1 day, or 7 day windows. The page auto-refreshes every 5
                seconds. A table-usage banner appears as you approach your plan's table limit, moving
                through info → warning → limit reached.
              </p>
            </section>

            {/* ---------------- CONNECTING ---------------- */}
            <section id="connecting" className="dt-doc-section space-y-4">
              <H2 id="connecting-h">Connecting externally</H2>
              <p>
                Beyond the web UI, you can connect to a database directly with any Postgres client (a
                database GUI, a script, an ORM). From the dashboard, use{" "}
                <strong>Revoke Key</strong> on a database to generate your personal connection credentials:
              </p>
              <CodeBlock
                label="Example connection URL shape"
                code={"postgres://<your-personal-user>:<auth-key>@<host>:5432/<database>"}
              />
              <Callout tone="warn">
                Revoking immediately invalidates your <em>previous</em> personal password — copy the new
                credentials before closing the dialog, since they're shown once. This only affects your own
                personal connection, not the shared admin role.
              </Callout>
              <p>
                Every teammate gets their own personal Postgres role scoped by their team permissions. The
                shared admin role (prefixed differently from personal roles) is reserved for the team owner
                and should not be distributed.
              </p>
            </section>

            {/* ---------------- SECURITY ---------------- */}
            <section id="security" className="dt-doc-section space-y-4">
              <H2 id="security-h">Security model</H2>
              <p>DragTable is self-hosted — you run the API, web app, and Postgres yourself — and is built around five non-negotiables:</p>
              <ul>
                <li>The server is authoritative for identity, permissions, schema, and data — never the client.</li>
                <li>No arbitrary client SQL is ever executed; every mutation is a validated, structured operation.</li>
                <li>Successful persistence is never faked — a success response means the write actually landed.</li>
                <li>Tenant isolation (team and database boundaries) is enforced server-side, not just in the UI.</li>
                <li>Secrets — auth keys, personal passwords — are never logged or broadcast.</li>
              </ul>
              <p>
                A typical deployment runs everything through Docker Compose, with Postgres, the API, and the
                web app as separate containers, ports bound to the host machine only by default.
              </p>
            </section>

            {/* ---------------- TIPS ---------------- */}
            <section id="tips" className="dt-doc-section space-y-4">
              <H2 id="tips-h">Tips &amp; shortcuts</H2>
              <ul>
                <li>
                  <span className="dt-kbd">↵</span> saves an inline cell edit, <span className="dt-kbd">Esc</span>{" "}
                  discards it.
                </li>
                <li>Team IDs are always exactly 5 characters — share them directly, there's no separate invite link.</li>
                <li>Auth keys and personal connection passwords are shown once — copy them immediately.</li>
                <li>Only admins can create or delete databases and manage membership; members act within their granted permissions.</li>
                <li>Double-clicking a cell edits it in place; clicking elsewhere or pressing Enter commits the change.</li>
              </ul>
            </section>

            {/* ---------------- FAQ ---------------- */}
            <section id="faq" className="dt-doc-section space-y-5 pb-10">
              <H2 id="faq-h">FAQ</H2>
              <div>
                <h3>The app says it "cannot reach API" — what now?</h3>
                <p>
                  The web app can't reach the API server. In a local/dev setup, start it with{" "}
                  <span className="dt-code-inline">npm run dev -w @dragtable/api</span>. In a Docker deployment,
                  confirm the API container is running and reachable on its configured port.
                </p>
              </div>
              <div>
                <h3>I lost an auth key or personal password — now what?</h3>
                <p>
                  Use <strong>Revoke Key</strong> on the database from the dashboard to rotate it. The
                  previous password stops working immediately and a fresh one is shown once.
                </p>
              </div>
              <div>
                <h3>Two people edited the same row at once — what happens?</h3>
                <p>
                  The second save is rejected as a conflict and that row reloads with the latest values —
                  no silent overwrites, no lost writes.
                </p>
              </div>
              <div>
                <h3>Can I run raw SQL against a database?</h3>
                <p>
                  Not through the app UI — every change goes through validated, structured operations. You
                  can connect directly with Postgres tooling using your personal credentials if you need
                  raw access outside DragTable.
                </p>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
