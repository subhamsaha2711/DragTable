<p align="center"><img src="./apps/web/public/logo.svg" alt="logo" width="100"></p>

<h1 align="center">
  <strong>DragTable</strong>
</h1>

<p align="center">
<b>Visual relational database management for teams that think in tables — not SQL.</b>
</p>

DragTable is a dual-plane, multi-tenant workspace that lets non-developer team leads *own* structured data: create databases, design schemas, edit rows, invite members with fine-grained RBAC, and still hand power users a real Postgres connection URL when they need external tooling.

> *Control plane for identity, teams, and policy. Data plane for tables, rows, and live collaboration. One product surface.*

---

## Table of Contents

- [Why DragTable](#why-dragtable)
- [Architecture](#architecture)
- [Monorepo Layout](#monorepo-layout)
- [Core Capabilities](#core-capabilities)
- [Security Model](#security-model)
- [Plans & Limits](#plans--limits)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Environment](#environment)
- [API Surface](#api-surface)
- [External Postgres Access](#external-postgres-access)
- [Realtime & Audit](#realtime--audit)
- [Import / Export](#import--export)
- [Development](#development)
- [Design Principles](#design-principles)

---

## Why DragTable

Traditional database tools assume everyone is comfortable with SQL, migrations, and connection strings. Team leads are not. Spreadsheets scale poorly and have no real schema, concurrency, or permissions model.

DragTable sits in the middle:

| Concern | Spreadsheets | Classic DBA tools | **DragTable** |
|--------|--------------|-------------------|---------------|
| Schema | Implicit | Full DDL | Visual + enforced system PK |
| Collaboration | Conflict-prone | None / limited | Live WS + audit |
| Permissions | Share-all or nothing | Role soup | Deny-by-default RBAC |
| External access | Export only | Native | Personal Postgres roles |
| Audience | Everyone | Engineers | **Team leaders + power users** |

---

## Architecture

```mermaid
flowchart TB
  subgraph CLIENT["Client"]
    WEB["apps/web<br/>Next.js 15 · React 19<br/>Dashboard · Workspace · Team · Analytics"]
  end

  subgraph API["apps/api — Fastify 5"]
    direction TB
    ROUTES["HTTP Routes<br/>Auth · Databases · Workspace · RBAC"]
    WS["WebSocket Hub<br/>@dragtable/realtime"]
    LISTEN["pg LISTEN bridge<br/>dt_change → audit + EXTERNAL_CHANGE"]
  end

  subgraph CONTROL["Control Plane"]
    DBC["@dragtable/db-control<br/>teams · members · sessions<br/>plans · personal keys · notifications"]
    RBAC["@dragtable/rbac<br/>deny-by-default permissions"]
    AUTH["@dragtable/auth<br/>sessions · password hashing"]
  end

  subgraph DATA["Data Plane"]
    TDB["@dragtable/target-db<br/>tables · rows · schema<br/>dual-write orchestration"]
    TPG["@dragtable/target-pg<br/>provision · grants · UUID guards<br/>event triggers · NOTIFY"]
  end

  subgraph STORE["Optional Storage"]
    PG[("PostgreSQL<br/>one DB per DragTable database<br/>+ _dt metadata schema")]
    MEM[("In-memory target<br/>hackathon / soft-fallback")]
  end

  WEB -->|"HTTP + cookie session"| ROUTES
  WEB <-->|"WS database:{id}"| WS
  ROUTES --> DBC
  ROUTES --> RBAC
  ROUTES --> AUTH
  ROUTES --> TDB
  WS --> TDB
  TDB -->|"dual-write when enabled"| TPG
  TDB -.->|"fallback"| MEM
  TPG --> PG
  LISTEN -->|"LISTEN / NOTIFY"| PG
  LISTEN --> WS
  LISTEN --> DBC
```

### Control plane vs data plane

- **Control plane** — users, teams, memberships, plan limits, personal keys, notifications. Authoritative for *who may do what*.
- **Data plane** — tables, columns, rows, FKs, indexes, checks. Authoritative for *what the data is*.

When `TARGET_ADMIN_URL` is set, the data plane **dual-writes** to a provisioned Postgres database per DragTable DB. Workspace mutations go through the API (RBAC + audit). External clients can also connect with a personal role; DDL/DML is attributed via `session_user` and reflected in history.

When Postgres is unavailable, the system **soft-falls back** to an in-memory target so local and hackathon flows stay usable.

---

## Monorepo Layout

```
dragtable/
├── apps/
│   ├── api/                 # Fastify API + WebSocket + pg LISTEN
│   └── web/                 # Next.js 15 App Router UI
├── packages/
│   ├── contracts/           # Shared types, plan limits, error codes
│   ├── domain/              # Pure domain rules (limits, name validation)
│   ├── auth/                # Session tokens, PBKDF2 password hashing
│   ├── rbac/                # Deny-by-default permission engine
│   ├── db-control/          # Control-plane store (memory / PG)
│   ├── target-db/           # Data-plane facade + dual-write orchestration
│   ├── target-pg/           # Real Postgres provision, ops, event triggers
│   ├── audit/               # Append-only history (last 100 per table)
│   ├── realtime/            # In-process pub/sub for workspace sockets
│   ├── analytics/           # Time-bucketed read/write latency metrics
│   └── import-export/       # CSV table export · ZIP of CSVs for full DB
└── package.json             # npm workspaces root
```

| Package | Responsibility |
|---------|----------------|
| `@dragtable/contracts` | `PlanId`, `PLAN_LIMITS`, `ErrorCode`, mutation command types |
| `@dragtable/domain` | `planAllowsNewTable`, name validators — **no I/O** |
| `@dragtable/rbac` | `can` / `assertCan` — admin full access; members explicit grants only |
| `@dragtable/target-db` | Structured table/row API; binds `databaseId → dbCode` |
| `@dragtable/target-pg` | `CREATE DATABASE`, role grants, system UUID guards, DDL NOTIFY |

---

## Core Capabilities

### Workspace

- Create / rename / drop **tables** with typed columns (`text`, `integer`, `numeric`, `boolean`, `date`, `timestamp`, `uuid`, `jsonb`)
- Insert, update cells (optimistic version checks), delete rows
- Schema tab reflects **live** nullability and constraints after external or UI changes
- Relations panel for foreign keys and integrity extras

### System-managed identity

Every table gets a **system `id` column**:

- Type: `uuid`
- Always **first** column
- Auto-generated with `gen_random_uuid()`
- **Not editable** in the workspace UI
- **Ignored** if supplied by clients or external SQL
- Enforced with Postgres `BEFORE INSERT` / `BEFORE UPDATE` triggers and table rebuild when external DDL tries to redefine it

> You never own the primary key. The platform does — so joins, audit, and dual-write stay consistent.

### Teams & RBAC

- Create a team (admin) or **join** with a team code
- Members start with **zero** permissions until an admin grants checkboxes
- Grants apply to **both** workspace routes and external Postgres privileges

| Permission | Effect |
|------------|--------|
| `data.read` | List tables / rows |
| `data.insert` / `data.update` / `data.delete` | Row mutations |
| `table.create` / `table.rename` / `table.delete` | Table lifecycle |
| `table.edit_schema` | Add / drop columns |
| `relation.manage` / `constraint.manage` | FKs, checks, indexes |
| `csv.import` / `csv.export` | Bulk I/O |
| `analytics.read` / `audit.read` | Observability |
| `database.manage` / `credentials.rotate` / `team.manage_members` | Governance |

### Dashboard

- Per-database **personal key hint** (not shared across users)
- Issue / revoke personal connection credentials
- Full-database **ZIP of CSV** export
- Analytics deep-link per database

---

## Security Model

1. **Session cookies** — HTTP-only; API resolves user on every request
2. **Deny-by-default RBAC** — `assertCan` on workspace mutations; PG `GRANT`/`REVOKE` mirrored for members
3. **Personal Postgres roles** — `m_<dbCode>_<userPrefix>`; password shown once
4. **Actor attribution** — external SQL logs resolve `session_user` → DragTable username (not a shared `@postgres` identity)
5. **Internal dual-write suppression** — `app.dt_internal` skips audit spam and notify loops for API-originated changes
6. **Plan table limit guard** — Postgres **event trigger** aborts external `CREATE TABLE` when over plan max

```sql
-- External CREATE past the plan limit fails with:
-- DragTable plan table limit reached (max N tables per database)
```

---

## Plans & Limits

| Plan | Databases | Tables / DB | People | Writes / day / DB | Reads / day / DB |
|------|-----------|-------------|--------|-------------------|------------------|
| **personal** | 1 | 5 | 5 | 1 000 | 5 000 |
| **startup** | 5 | 10 | 50 | 10 000 | 50 000 |
| **enterprise** | 10 | 100 | 100 | 100 000 | 500 000 |

Limits are enforced in the **API** (workspace) and in **Postgres** (external DDL) via `_dt.config` + event triggers.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | **Node.js ≥ 24** |
| API | **Fastify 5**, Zod, `@fastify/websocket`, `pg` |
| Web | **Next.js 15**, React 19, Tailwind CSS 4 |
| Validation | Zod (request bodies) · domain pure functions |
| Auth | Web Crypto PBKDF2 (bootstrap); session token hashing SHA-256 |
| Workspaces | **npm workspaces** (`apps/*`, `packages/*`) |
| Database | PostgreSQL 17 (alpine image) |
| Container | Docker 29 |

---

## Getting Started

### Prerequisites

- Node.js **24+**
- npm **10+**
- PostgreSQL 17 (alpine image)
- Docker 29

### Install

```bash
git clone https://github.com/subham59036/DragTable.git dragtable
cd dragtable
```

### Environment

Copy or create a root `.env`:

```bash
# Required for API session / local defaults
# Optional: enable real Postgres data plane
TARGET_ADMIN_URL=postgresql://postgres:password@127.0.0.1:5432/postgres
TARGET_DB_HOST=127.0.0.1
TARGET_DB_PORT=5432

# Optional control-plane persistence
# DATABASE_URL=postgresql://...

# Web → API (browser)
NEXT_PUBLIC_API_URL=http://127.0.0.1:3001
```

> Without `TARGET_ADMIN_URL`, DragTable runs **memory-only** data plane — ideal for demos and hackathons.

### Run

```bash
docker compose build
docker compose up --build
```

Open **http://localhost:3000**, register a team admin, create a database, and open the workspace.

---

## API Surface

Base path: `/api/v1`

| Area | Examples |
|------|----------|
| Auth | `POST /auth/register`, `POST /auth/signin`, `POST /auth/register-and-join` |
| Teams | `GET /teams/:teamId/members`, permissions `PUT`, remove member |
| Databases | `GET/POST /teams/:teamId/databases`, rotate key, personal-connection, delete |
| Workspace | tables CRUD, rows, cells, columns, schema-extras, FKs |
| Export | `GET .../tables/:tableId/export.csv`, `GET .../export` (ZIP of CSVs) |
| Analytics | `GET /databases/:databaseId/analytics?window=1h\|1d\|7d` |
| Realtime | WebSocket channel `database:{databaseId}` |

All mutating workspace routes require the matching **permission**. Members without grants receive `403 FORBIDDEN`.

---

## External Postgres Access

1. Admin creates a database → platform provisions `dt_<dbcode>` and shared admin role when PG is enabled.
2. Each user issues a **personal connection** from the dashboard (password once).
3. Connect with any Postgres client:

```text
postgresql://m_<dbcode>_<prefix>:<password>@<host>:<port>/dt_<dbcode>
```

4. `CREATE TABLE` / DML respect RBAC grants and plan limits.
5. Changes appear in workspace history with the **correct username**, not a shared service account.

System rules still apply: **no client-defined `id` PK**; DragTable injects and freezes UUID identity.

---

## Realtime & Audit

- **Realtime** — in-process hub fans out compact events to subscribed workspace clients (inserts, schema changes, external DDL).
- **Audit** — append-only, **last 100 entries per table** (and a DB-wide feed). Actor is always server-resolved.
- **pg LISTEN** — target databases `NOTIFY dt_change` on external `CREATE`/`DROP TABLE` and DML triggers; the API debounces, attributes, audits, and pushes `EXTERNAL_CHANGE`.

---

## Import / Export

| Action | Format |
|--------|--------|
| Single table | Pure **CSV** (`Content-Type: text/csv`) |
| Full database | **ZIP** of one CSV per table |
| Import | CSV → typed rows (permission `csv.import`) |

CSV cells are formula-injection guarded (`=`, `+`, `-`, `@` prefixes neutralized).

---

## Development

```bash
# Install packages
npm i

# Typecheck all workspaces
npm run typecheck

# Build
npm run build

# API only / Web only
npm run dev:api
npm run dev:web

# If Docker only
docker compose up --build
```

### Conventions

- **Pure packages** (`domain`, `rbac`, `contracts`, `auth` helpers) have no I/O.
- **Dual-write order** — prefer Postgres when enabled; soft-fallback to memory if the target is unreachable.
- **Never** expose system `id` as a required input in UI forms.
- **Event triggers** must skip when `app.dt_internal = '1'` to avoid feedback loops.

---

## Design Principles

1. **Team leaders first** — UI is the primary interface; SQL is an escape hatch, not the product.
2. **Deny by default** — joined members cannot mutate until explicitly granted.
3. **One source of truth for identity** — platform-owned UUID `id` on every table.
4. **Attribute every change** — workspace and external SQL share the same audit vocabulary.
5. **Degrade gracefully** — missing `TARGET_ADMIN_URL` must not brick create-database or local demos.
6. **Plan limits are real** — enforced in API *and* in the database engine.