# Architecture Decision Records (ADRs) — TaskFlow

This document records key architectural and design decisions for the TaskFlow Multi-Tenant API as defined in the Software Requirements Specification (SRS §2.7).

---

## ADR 1: Tenancy Isolation Model

- **Decision:** Shared database, shared schema with an `orgId` column discriminator on every tenant-owned table. Isolation is enforced in two complementary layers:
  1. Application layer: A Prisma client extension that automatically injects `orgId` into every tenant-scoped query.
  2. Database layer: PostgreSQL Row-Level Security (RLS) policies driven by a per-request `app.current_org` session setting.
  3. Database constraints: Composite foreign keys (e.g. `Task(projectId, orgId)` → `Project(id, orgId)`).
- **Rationale:** Application-level scoping alone is one bug away from a data leak; PostgreSQL RLS acts as a defence-in-depth safety net, and composite FKs guarantee relational tenant integrity.

---

## ADR 2: Cross-Tenant Access Response

- **Decision:** Return `404 NOT_FOUND` rather than `403 FORBIDDEN` when a resource does not belong to the requesting tenant.
- **Rationale:** Prevents tenant enumeration and avoids revealing whether a resource identifier exists in another organization.

---

## ADR 3: Role-Based Access Control Structure

- **Decision:** Exactly one `Owner` per organization. `Admin` cannot manage other `Admins` or the `Owner`. `Member` is standard access.
- **Rationale:** Prevents privilege escalation and administrative takeovers. Role hierarchy is enforced via a centralized policy module.

---

## ADR 4: API Key Authorization Model

- **Decision:** API keys represent organization-owned service principals with explicit scopes (`read` or `read_write`). They do not carry user identities or human roles.
- **Rationale:** Eliminates ghost human privileges for programmatic clients and strictly restricts service credentials from administrative endpoints.

---

## ADR 5: Token Lifecycles and Session Security

- **Decision:** Short-lived access tokens (15-minute JWT) paired with server-stored rotating refresh tokens and reuse detection (revoking token family on reuse).
- **Rationale:** Limits exposure window if credentials or role changes occur, while detecting and mitigating token theft.

---

## ADR 6: Pagination Strategy

- **Decision:** Cursor-based pagination (`?limit=&cursor=`) on all list endpoints returning `nextCursor`.
- **Rationale:** Guarantees stability under concurrent writes and provides consistent performance at scale compared to offset pagination.

---

## ADR 7: Project Deletion Strategy

- **Decision:** Hard delete with cascading deletion to tasks, with full audit logging.
- **Rationale:** Keeps v1 data integrity explicit and auditable; soft delete may be evaluated for future versions.
