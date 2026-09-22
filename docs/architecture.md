# DragTable Architecture (v0.1)

## Control plane vs data plane

| Plane | Stores | PostgreSQL location |
|-------|--------|---------------------|
| Control | users, sessions, teams, members, roles, plans, DB registry, credentials metadata, audit, notifications, usage | `dragtable_control` |
| Data | user tables, rows, indexes, constraints | one DB per DragTable database: `dt_<DBID>` |

## Request authorization path

```
HTTP/WS request
  → authenticate session (cookie / token)
  → resolve user
  → resolve team membership
  → resolve target database + status
  → evaluate RBAC permission
  → check plan / quota
  → concurrency / version check
  → transactional mutation
  → write audit + outbox
  → publish realtime event
  → return authoritative result
```

## Isolation (self-hosted)

Single PostgreSQL server. Separate databases per tenant database. Least-privilege roles. Application holds privileged connection for provisioning only.

## Realtime

Authorized channel subscription only. Compact deltas. Outbox for reliability. ~100 ms coalescing target.
