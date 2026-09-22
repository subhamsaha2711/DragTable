-- DragTable control-plane schema
-- Database: dragtable_control
-- Isolation: one PostgreSQL DB for control metadata; target user DBs are separate (dt_<id>)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Plans (seeded)
CREATE TABLE IF NOT EXISTS plans (
  id            TEXT PRIMARY KEY,          -- personal | startup | enterprise
  monthly_cost  INTEGER NOT NULL DEFAULT 0,
  max_databases INTEGER NOT NULL,
  max_tables_per_db INTEGER NOT NULL,
  max_people    INTEGER NOT NULL,
  writes_per_day_per_db INTEGER NOT NULL,
  reads_per_day_per_db  INTEGER NOT NULL
);

INSERT INTO plans (id, monthly_cost, max_databases, max_tables_per_db, max_people, writes_per_day_per_db, reads_per_day_per_db)
VALUES
  ('personal',   0,  1,   5,   5,   1000,    5000),
  ('startup',   10,  5,  10,  50,  10000,   50000),
  ('enterprise',50, 10, 100, 100, 100000,  500000)
ON CONFLICT (id) DO NOTHING;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      CHAR(5) NOT NULL,           -- 5-char alphanumeric display handle
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_username_unique UNIQUE (username),
  CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (lower(email));

-- Sessions (server-side, revocable)
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL,             -- hash of session token (never store raw)
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent    TEXT,
  ip_hint       TEXT,
  CONSTRAINT sessions_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at) WHERE revoked_at IS NULL;

-- Teams
CREATE TABLE IF NOT EXISTS teams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_code     CHAR(5) NOT NULL,           -- human-shareable join code (NOT a secret)
  name          TEXT NOT NULL,
  plan_id       TEXT NOT NULL REFERENCES plans(id),
  created_by    UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teams_team_code_unique UNIQUE (team_code)
);

-- Team membership
CREATE TABLE IF NOT EXISTS team_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'suspended', 'removed')),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at    TIMESTAMPTZ,
  CONSTRAINT team_members_unique UNIQUE (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members (user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members (team_id) WHERE status = 'active';

-- Per-member permission grants (Member role only; Admin has all)
CREATE TABLE IF NOT EXISTS member_permissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  permission    TEXT NOT NULL,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by    UUID REFERENCES users(id),
  CONSTRAINT member_permissions_unique UNIQUE (team_member_id, permission)
);

-- Database registry (control plane metadata for target DBs)
CREATE TABLE IF NOT EXISTS databases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  db_code       CHAR(5) NOT NULL,           -- human-facing Database ID
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'provisioning'
                  CHECK (status IN ('provisioning', 'active', 'deleting', 'deleted', 'failed')),
  pg_database_name TEXT,                    -- e.g. dt_ABC12
  schema_version INTEGER NOT NULL DEFAULT 0,
  created_by    UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  CONSTRAINT databases_db_code_unique UNIQUE (db_code),
  CONSTRAINT databases_team_name_unique UNIQUE (team_id, name)
);

CREATE INDEX IF NOT EXISTS idx_databases_team ON databases (team_id) WHERE status NOT IN ('deleted');

-- Credential metadata (secrets encrypted at rest where possible; never log)
CREATE TABLE IF NOT EXISTS database_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  database_id   UUID NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  auth_key_hash TEXT NOT NULL,              -- hash of DragTable auth key
  auth_key_hint TEXT,                       -- last 4 chars for UI display
  encrypted_pg_password TEXT,               -- encrypted PG role password
  pg_role_name  TEXT,
  rotated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_db_creds_database ON database_credentials (database_id) WHERE revoked_at IS NULL;

-- Audit events (append-oriented; trim to last 100 per table in application logic)
CREATE TABLE IF NOT EXISTS audit_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_id     TEXT NOT NULL,              -- ULID / unique change id
  team_id       UUID NOT NULL REFERENCES teams(id),
  database_id   UUID REFERENCES databases(id),
  table_id      TEXT,                       -- logical table id in target DB
  actor_user_id UUID NOT NULL REFERENCES users(id),
  action        TEXT NOT NULL,
  target        JSONB,
  previous_state JSONB,
  new_state     JSONB,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_change_id_unique UNIQUE (change_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_db_table ON audit_events (database_id, table_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_team ON audit_events (team_id, created_at DESC);

-- Notifications (durable)
CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id),
  target_user_id UUID REFERENCES users(id), -- null = team-wide
  payload       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_team ON notifications (team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (target_user_id, created_at DESC) WHERE read_at IS NULL;

-- Outbox for reliable realtime / side effects
CREATE TABLE IF NOT EXISTS outbox_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id  TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ,
  CONSTRAINT outbox_events_event_id_unique UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON outbox_events (created_at) WHERE published_at IS NULL;

-- Usage buckets (time-bucketed aggregation)
CREATE TABLE IF NOT EXISTS usage_buckets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  database_id   UUID NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  bucket_start  TIMESTAMPTZ NOT NULL,
  bucket_seconds INTEGER NOT NULL DEFAULT 60,
  reads         INTEGER NOT NULL DEFAULT 0,
  writes        INTEGER NOT NULL DEFAULT 0,
  latency_sum_ms BIGINT NOT NULL DEFAULT 0,
  latency_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT usage_buckets_unique UNIQUE (database_id, bucket_start, bucket_seconds)
);

CREATE INDEX IF NOT EXISTS idx_usage_db_time ON usage_buckets (database_id, bucket_start DESC);
