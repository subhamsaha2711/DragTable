/**
 * Pure domain rules — no I/O.
 */

import { PLAN_LIMITS, type PlanId } from "@dragtable/contracts";

const ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Generate a candidate 5-char alphanumeric ID (not yet uniqueness-checked). */
export function generateShortId(length = 5): string {
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) {
    out += ALPHANUM[bytes[i]! % ALPHANUM.length];
  }
  return out;
}

export function planAllowsNewDatabase(plan: PlanId, currentCount: number): boolean {
  return currentCount < PLAN_LIMITS[plan].maxDatabases;
}

export function planAllowsNewTable(plan: PlanId, currentTables: number): boolean {
  return currentTables < PLAN_LIMITS[plan].maxTablesPerDb;
}

export function planTableLimit(plan: PlanId): number {
  return PLAN_LIMITS[plan].maxTablesPerDb;
}

export function planDatabaseLimit(plan: PlanId): number {
  return PLAN_LIMITS[plan].maxDatabases;
}

export function planAllowsNewMember(plan: PlanId, currentMembers: number): boolean {
  return currentMembers < PLAN_LIMITS[plan].maxPeople;
}

export function isValidTableName(name: string): boolean {
  return /^[a-z][a-z0-9_]{0,62}$/i.test(name);
}

export function isValidColumnName(name: string): boolean {
  return /^[a-z][a-z0-9_]{0,62}$/i.test(name);
}
