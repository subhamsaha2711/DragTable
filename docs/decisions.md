# DragTable — Architecture & Implementation Decisions

> Record every non-obvious choice here. Prefer the smallest secure, deterministic, conventional implementation that preserves product intent.

## D-001 — Monorepo layout
**Decision:** npm workspaces monorepo matching the recommended structure in the master prompt.  
**Rationale:** Shared TypeScript types/contracts, single version control, clear control-plane vs data-plane separation.  
**Date:** 2026-09-09

## D-002 — Isolation model (self-hosted)
**Decision:** Single PostgreSQL instance. Control plane lives in database `dragtable_control`. Each user database is a separate PostgreSQL database named `dt_<5char_db_id>`. Application roles are least-privilege per target database.  
**Rationale:** Practical for single-Docker self-host; stronger than schemas-only while remaining operationally simple. Documented honestly — not multi-cluster isolation.  
**Date:** 2026-09-09

## D-003 — ID generation
**Decision:** 5-character alphanumeric IDs (A-Z0-9, case-insensitive collision handling via unique constraints + bounded retry). Internal primary keys remain UUIDv7 / ULID for ordering and global uniqueness.  
**Rationale:** Matches product requirement for human-shareable Team ID / Database ID / username while keeping security identifiers strong.  
**Date:** 2026-09-09

## D-004 — Password hashing
**Decision:** Argon2id via `@node-rs/argon2` (or equivalent) with moderate memory/time params suitable for interactive login.  
**Rationale:** Modern, memory-hard, no plaintext, no logging of secrets.  
**Date:** 2026-09-09

## D-005 — Session model
**Decision:** Server-side sessions stored in control DB + HttpOnly Secure SameSite=Lax cookie. Short-lived access + refresh where needed later.  
**Rationale:** Avoids trusting client-supplied identity; supports revocation.  
**Date:** 2026-09-09

## D-006 — Realtime
**Decision:** Fastify + `@fastify/websocket` (or native WS) with channel authorization on subscribe. Compact event deltas + outbox pattern. ~100 ms coalescing target for delivery, not a hard SLA.  
**Rationale:** Event-driven, not full-table broadcast every 100 ms.  
**Date:** 2026-09-09

## D-007 — No arbitrary SQL endpoint
**Decision:** All mutations are structured commands validated server-side.  
**Rationale:** Non-negotiable security rule from master prompt.  
**Date:** 2026-09-09

## D-008 — Bootstrap control store
**Decision:** When `DATABASE_URL` is unset, `@dragtable/db-control` uses an in-memory store so auth/teams can be exercised without Postgres. When set, uses the control-plane PostgreSQL schema.  
**Rationale:** Unblocks local/hackathon iteration; production and Docker self-host must set DATABASE_URL. Memory store is explicitly not durable.  
**Date:** 2026-09-09

## D-009 — Password hash (bootstrap)
**Decision:** PBKDF2-SHA-256 via Web Crypto for the first auth slice (portable, zero native deps). Production target remains Argon2id (D-004); migration path is a rehash-on-login or forced reset.  
**Rationale:** Ship working auth immediately; record the upgrade path.  
**Date:** 2026-09-09

## D-010 — Session cookie
**Decision:** HttpOnly cookie `dt_session`, SameSite=Lax, Secure in production, 14-day absolute expiry; server stores only token hash.  
**Rationale:** Matches D-005; supports revocation without trusting client identity claims.  
**Date:** 2026-09-09

## D-011 — Hackathon plans are free
**Decision:** Personal, Startup, and Enterprise are selectable with one click. No payment, billing, or card collection. Plan only enforces resource limits (DBs, tables, members, quotas).  
**Rationale:** Explicit product request for hackathon; avoids payment-provider complexity.  
**Date:** 2026-09-10

## D-012 — Database auth key reveal once
**Decision:** Raw auth key returned only on create and rotate; stored as hash + last-4 hint. UI modal forces copy-before-dismiss pattern.  
**Rationale:** Secret handling without embedding secrets in list endpoints.  
**Date:** 2026-09-10

## D-013 — Target data plane in-memory for hackathon
**Decision:** `@dragtable/target-db` holds tables/rows in process memory with structured commands (CreateTable, InsertRow, UpdateCell with version, etc.). No arbitrary SQL endpoint.  
**Rationale:** Unblocks visual workspace without multi-DB PG provisioning in the demo path. Control plane still authoritative for DB registry and membership.  
**Date:** 2026-09-10


## D-014 — Realtime in-process hub
**Decision:** `@dragtable/realtime` pub/sub keyed by `database:{id}`. Fastify WebSocket at `/ws/databases/:databaseId` authenticates via session cookie and membership before subscribe. Compact event envelopes only.  
**Rationale:** Meets live-collab intent for single-node hackathon deploy without Redis.  
**Date:** 2026-09-10

## D-015 — Audit last 100 per table
**Decision:** In-memory append-only log trimmed to 100 entries per table (+ database-wide feed). Actor always from server session.  
**Rationale:** Matches product “Git-like last 100 edits” without fake Git.  
**Date:** 2026-09-10


## D-016 — Full DB export is structured archive
**Decision:** Table export = CSV. Database export = `dragtable-export-v1` JSON with manifest, schema, per-table rows + embedded CSV strings. Not a single CSV.  
**Rationale:** Product requires one-click complete export without lying that CSV can represent relations.  
**Date:** 2026-09-10
