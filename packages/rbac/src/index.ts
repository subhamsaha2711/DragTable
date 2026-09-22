/**
 * RBAC policy engine — pure, deny-by-default.
 */

export type Permission =
  | "database.read"
  | "table.create"
  | "table.rename"
  | "table.delete"
  | "table.edit_schema"
  | "relation.manage"
  | "constraint.manage"
  | "data.read"
  | "data.insert"
  | "data.update"
  | "data.delete"
  | "csv.import"
  | "csv.export"
  | "analytics.read"
  | "audit.read"
  | "database.manage"
  | "credentials.rotate"
  | "team.manage_members";

export const ALL_PERMISSIONS: Permission[] = [
  "database.read",
  "table.create",
  "table.rename",
  "table.delete",
  "table.edit_schema",
  "relation.manage",
  "constraint.manage",
  "data.read",
  "data.insert",
  "data.update",
  "data.delete",
  "csv.import",
  "csv.export",
  "analytics.read",
  "audit.read",
  "database.manage",
  "credentials.rotate",
  "team.manage_members",
];

/** Admin has every permission. Member only granted ones. */
export function can(
  role: "admin" | "member",
  granted: ReadonlySet<string> | string[],
  permission: Permission
): boolean {
  if (role === "admin") return true;
  const set = granted instanceof Set ? granted : new Set(granted);
  return set.has(permission);
}

export function assertCan(
  role: "admin" | "member",
  granted: ReadonlySet<string> | string[],
  permission: Permission
): void {
  if (!can(role, granted, permission)) {
    throw Object.assign(new Error(`Missing permission: ${permission}`), {
      code: "FORBIDDEN",
      permission,
    });
  }
}
