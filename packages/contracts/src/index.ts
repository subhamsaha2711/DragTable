/**
 * Shared request / event / error contracts for DragTable.
 * Keep pure and serializable.
 */

export type PlanId = "personal" | "startup" | "enterprise";

export const PLAN_LIMITS = {
  personal: {
    monthlyCost: 0,
    maxDatabases: 1,
    maxTablesPerDb: 5,
    maxPeople: 5,
    writesPerDayPerDb: 1_000,
    readsPerDayPerDb: 5_000,
  },
  startup: {
    monthlyCost: 10,
    maxDatabases: 5,
    maxTablesPerDb: 10,
    maxPeople: 50,
    writesPerDayPerDb: 10_000,
    readsPerDayPerDb: 50_000,
  },
  enterprise: {
    monthlyCost: 50,
    maxDatabases: 10,
    maxTablesPerDb: 100,
    maxPeople: 100,
    writesPerDayPerDb: 100_000,
    readsPerDayPerDb: 500_000,
  },
} as const;

export type ErrorCode =
  | "AUTH_INVALID"
  | "AUTH_EXPIRED"
  | "FORBIDDEN"
  | "TEAM_NOT_FOUND"
  | "TEAM_CAPACITY_REACHED"
  | "DB_LIMIT_REACHED"
  | "TABLE_LIMIT_REACHED"
  | "DB_NOT_FOUND"
  | "DB_DELETING"
  | "CREDENTIAL_REVOKED"
  | "SCHEMA_CONFLICT"
  | "ROW_CONFLICT"
  | "VALIDATION_FAILED"
  | "CONSTRAINT_VIOLATION"
  | "IMPORT_INVALID"
  | "IMPORT_TOO_LARGE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** Structured mutation commands — never arbitrary SQL */
export type MutationCommand =
  | { type: "CreateTable"; tableName: string; columns: ColumnDef[] }
  | { type: "RenameTable"; tableId: string; newName: string }
  | { type: "DropTable"; tableId: string }
  | { type: "AddColumn"; tableId: string; column: ColumnDef }
  | { type: "AlterColumn"; tableId: string; columnId: string; changes: Partial<ColumnDef> }
  | { type: "DropColumn"; tableId: string; columnId: string }
  | { type: "AddPrimaryKey"; tableId: string; columnIds: string[] }
  | { type: "DropPrimaryKey"; tableId: string }
  | { type: "AddForeignKey"; tableId: string; fk: ForeignKeyDef }
  | { type: "DropForeignKey"; tableId: string; fkId: string }
  | { type: "InsertRow"; tableId: string; values: Record<string, unknown> }
  | { type: "UpdateCell"; tableId: string; rowId: string; columnId: string; value: unknown; expectedVersion: number }
  | { type: "DeleteRow"; tableId: string; rowId: string; expectedVersion: number };

export interface ColumnDef {
  name: string;
  dataType: DataType;
  nullable?: boolean;
  defaultValue?: unknown;
  unique?: boolean;
}

export type DataType =
  | "text"
  | "integer"
  | "numeric"
  | "boolean"
  | "date"
  | "timestamp"
  | "uuid"
  | "jsonb";

export interface ForeignKeyDef {
  columnIds: string[];
  referencedTableId: string;
  referencedColumnIds: string[];
  onDelete?: "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION";
}

export interface RealtimeEvent {
  eventId: string;
  operationId: string;
  type: string;
  teamId: string;
  databaseId?: string;
  tableId?: string;
  actorUserId: string;
  serverTimestamp: string;
  resourceVersion?: number;
  schemaVersion?: number;
  payload: Record<string, unknown>;
}
