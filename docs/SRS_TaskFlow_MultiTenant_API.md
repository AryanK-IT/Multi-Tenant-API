# Software Requirements Specification (SRS)
## TaskFlow — Multi-Tenant Project Management API

**Version:** 1.1
**Date:** November 3, 2026
**Author:** [Your Name]
**Status:** Draft (revised after review)

---

## 1. Introduction

### 1.1 Purpose
This document specifies the functional and non-functional requirements for **TaskFlow**, a multi-tenant, GitHub-inspired project management backend API. It is intended to serve as a reference during design, development, and testing, and as a portfolio artifact demonstrating backend architecture and API design skills.

### 1.2 Scope
TaskFlow is a REST API that allows multiple independent organizations (tenants) to manage projects and tasks under strict data isolation. It supports role-based access control, API-key-based programmatic access, and event-driven webhooks. The initial release is API-only (no frontend); a minimal client or Postman/Swagger collection may be provided for demonstration.

Out of scope for v1: billing/subscriptions, organization deletion, public repository-style visibility, forking, real-time collaboration (WebSockets), email verification with a live provider, and mobile clients.

### 1.3 Intended Audience
- The developer (self) as design reference
- Reviewers/interviewers evaluating the portfolio project
- Future contributors, if the project is open-sourced

### 1.4 Definitions and Acronyms

| Term | Definition |
|---|---|
| Tenant / Org | An isolated customer account containing its own users, projects, and tasks |
| RBAC | Role-Based Access Control |
| JWT | JSON Web Token, used for session authentication (access token) |
| Refresh Token | Opaque, long-lived, rotating token used to obtain new access tokens |
| API Key | Long-lived token used for programmatic/external access |
| Webhook | HTTP callback fired by the system on defined events |
| RLS | PostgreSQL Row-Level Security |
| SSRF | Server-Side Request Forgery |

---

## 2. Overall Description

### 2.1 Product Perspective
TaskFlow is a standalone backend service, structurally inspired by GitHub's organization/repository/permission model, applied to project and task management instead of source code hosting.

### 2.2 Product Features (Summary)
- Organization (tenant) creation and membership management, including ownership transfer
- User authentication (JWT + refresh tokens) and org invitation flow
- Role-based access control (Owner, Admin, Member) with an explicit permission matrix
- Project and Task CRUD, fully scoped per tenant
- API key generation for external/programmatic access
- Webhook registration, signed event delivery, and delivery logs
- Rate limiting (per-org, per-credential, and per-IP on auth endpoints)
- Audit logging of key actions

### 2.3 User Classes and Characteristics

| Role | Description | Summary of Permissions |
|---|---|---|
| Owner | Exactly one per org; creator or transferee | Everything an Admin can do, plus manage Admins and transfer ownership |
| Admin | Elevated org member | Manage projects, manage Members (not other Admins or the Owner), manage API keys/webhooks, view audit log |
| Member | Standard org user | Create/edit projects and tasks, view everything in the org |
| External Consumer | Third-party system using an API key | Limited to the key's scope (read-only or read-write); never has access to administrative endpoints |

The full action-by-role matrix is in Section 3.8.

### 2.4 Operating Environment
- Backend: Node.js + Express (TypeScript)
- Database: PostgreSQL (via Prisma ORM)
- Cache / rate-limiting store / job queue backend: Redis (queue via BullMQ or equivalent)
- Deployment target (future): Docker containers on AWS

### 2.5 Design and Implementation Constraints
- **Tenancy model:** shared database, shared schema, with an `orgId` discriminator on every tenant-owned table.
- All tenant-owned data access must be scoped by `orgId`. The only code paths allowed to run without tenant context are those that must resolve it: signup, login, token refresh, invite acceptance, and API key lookup.
- Authentication must support both session-style JWT (web/app clients) and API keys (external clients).
- Must be stateless at the application layer to support future horizontal scaling.

### 2.6 Assumptions and Dependencies
- A user may hold memberships in multiple orgs at the data level, but each access token is bound to exactly one org (see FR-2). A mid-session org-switch endpoint is a stretch goal.
- Email delivery (invitations, password reset) goes through an `EmailService` interface; v1 ships a console/log implementation, swappable for a real provider later.

### 2.7 Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Tenancy isolation | Shared schema + `orgId` column, enforced in a Prisma client extension **and** PostgreSQL RLS | Application-level scoping alone is one bug away from a data leak; RLS is the safety net |
| Cross-tenant access | Return `404 NOT_FOUND`, not `403` | Avoids revealing that a resource exists in another tenant |
| Roles | Exactly one Owner per org; Admins cannot manage Admins | Prevents privilege escalation and "admin coups" |
| API keys | Org-owned service principals with a scope, not a role | A key has no human identity; it must never reach administrative endpoints |
| Access tokens | 15-minute JWT + rotating refresh token | Limits the window in which a stale role in the JWT is honoured |
| Pagination | Cursor-based on all list endpoints | Stable under concurrent writes; scales better than offset |
| Project deletion | Hard delete with cascade to tasks, audit-logged | Simplest correct behaviour for v1; soft delete is a possible later change |

---

## 3. System Features / Functional Requirements

### 3.1 Authentication & Org Management

**FR-1: User Signup**
- A new user signs up with email and password. Email is globally unique and case-insensitive.
- Password policy: minimum 10 characters; stored with argon2id (or bcrypt).
- At signup the user either creates a new organization (becoming its Owner) or supplies a valid invitation token (joining that org with the invited role).

**FR-2: Login**
- Registered users log in with email/password and receive:
  - a short-lived **access token** (JWT, 15 min) containing `userId`, `orgId`, and `role`;
  - a **refresh token** (opaque, stored hashed server-side).
- If the user belongs to more than one org, the request must include `orgId`; if they belong to exactly one it is inferred.
- Because roles in a JWT can go stale, the refresh flow re-reads the current membership; removed members cannot obtain new tokens.

**FR-3: Token Refresh and Logout**
- `POST /auth/refresh` exchanges a refresh token for a new access token and a **new** refresh token (rotation).
- Reuse of an already-rotated refresh token revokes the entire token family (theft detection).
- `POST /auth/logout` revokes the presented refresh token.

**FR-4: Password Reset** *(Should-have)*
- A user can request a reset link (delivered via `EmailService`) and set a new password with a single-use, time-limited token. All refresh tokens for the user are revoked on success.

**FR-5: Org Invitation**
- Owner/Admin can invite a user by email with role `admin` or `member`. The Owner role cannot be granted by invitation.
- Invitation tokens are single-use, expire after 7 days, are stored hashed, and are bound to the invited email address.
- Accepting an invitation creates the membership. Both new and existing users can accept (new users via signup, existing users via `POST /auth/invite/accept` while authenticated).
- Owner/Admin can list pending invitations and revoke them.

**FR-6: Org Membership Management**
- Owner/Admin can list members. Changing roles and removing members follows these rules:
  - Owner can change or remove any Admin or Member.
  - Admin can change or remove Members only (not other Admins, not the Owner).
  - The Owner cannot be demoted or removed; ownership must be transferred first (FR-7).
- On removal: the user's refresh tokens for that org are revoked, tasks assigned to them are unassigned, and the action is audit-logged. API keys they created remain valid (keys belong to the org).

**FR-7: Ownership Transfer**
- The Owner can transfer ownership to an existing member. The operation is atomic: the target becomes Owner and the previous Owner becomes Admin. Audit-logged.

### 3.2 Project Management

**FR-8: Create Project**
- Owner, Admin, and Member can create a project in their org. Project names are unique within an org.

**FR-9: View/List Projects**
- Users see only projects belonging to the org in their token/key. Requests for another org's project return `404`.

**FR-10: Update Project**
- Owner, Admin, and Member can edit a project's name and description.

**FR-11: Delete Project**
- Only Owner/Admin can delete a project. Deletion cascades to its tasks, emits `project.deleted`, and is audit-logged.

*(Per-project permissions remain a stretch goal; v1 permissions are org-level only.)*

### 3.3 Task Management

**FR-12: Create/Read/Update/Delete Task**
- Tasks belong to a project and inherit its org scope; the database enforces that a task's `orgId` matches its project's `orgId`.
- Any Owner/Admin/Member can create and edit tasks. Deletion is allowed for Owner/Admin or the task's creator.
- Task lists support filtering by `status` and `assigneeId` and cursor pagination.

**FR-13: Task Status Workflow**
- Statuses: `todo`, `in_progress`, `done`.
- Allowed transitions, validated server-side:

| From | To |
|---|---|
| `todo` | `in_progress` |
| `in_progress` | `todo`, `done` |
| `done` | `in_progress` (reopen) |

- Invalid transitions return `422 INVALID_STATUS_TRANSITION`.

**FR-14: Assign Task**
- A task can be assigned to any **current member of the same org** (validated in the service layer). Assignment is cleared when the assignee is removed from the org.

### 3.4 API Keys

**FR-15: Generate API Key**
- Owner/Admin can create a key with a name, a scope (`read` or `read_write`), and an optional expiry.
- Key format: `tf_<prefix>_<secret>`. The prefix is stored in plaintext for lookup; the secret is stored only as a hash (SHA-256 is sufficient for high-entropy keys). The full key is shown **once**, at creation.

**FR-16: List and Revoke API Keys**
- Owner/Admin can list keys (name, prefix, scope, expiry, last used, creator; never the secret) and revoke any key. Revoked or expired keys are rejected immediately.

**FR-17: Authenticate via API Key**
- Requests may send `Authorization: Bearer <api_key>`. The server distinguishes keys from JWTs by the `tf_` prefix.
- A key resolves to its org and scope. It does **not** carry a user role, and it can never call administrative endpoints (members, invitations, API keys, webhooks, audit log, ownership transfer). See the matrix in 3.8.
- `lastUsedAt` is updated (throttled, e.g., at most once per minute per key).

### 3.5 Webhooks

**FR-18: Manage Webhooks**
- Owner/Admin can register, list, update (URL, events, active flag), and delete webhooks.
- Supported events (v1): `project.created`, `project.updated`, `project.deleted`, `task.created`, `task.updated`, `task.deleted`, `task.status_changed`, `member.added`, `member.removed`.
- URLs must use HTTPS (HTTP allowed only in development) and must pass SSRF checks: resolve the hostname and reject loopback, private, link-local, and cloud-metadata addresses, both at registration and at delivery time. Redirects are not followed.
- The signing secret is generated by the server and shown once; it is stored encrypted (not hashed) because it is needed to sign payloads.

**FR-19: Deliver Webhook**
- On qualifying events, a job is enqueued and a signed `POST` is sent to each matching, active webhook of that org. Each payload carries a unique `eventId` so receivers can deduplicate (delivery is at-least-once).
- Timeout per attempt: 10 seconds. Retries use exponential backoff, for a maximum of 3 attempts total (first try included). A webhook is auto-disabled after a configurable number of consecutive failed deliveries (default 20).
- Events are enqueued only after the originating database transaction commits.

**FR-20: Webhook Signature**
- Each request includes `X-TaskFlow-Timestamp` and `X-TaskFlow-Signature`, where the signature is an HMAC-SHA256 over `timestamp + "." + body`. Receivers should reject timestamps older than 5 minutes (replay protection) and compare signatures in constant time. Verification instructions are included in the API docs.

**FR-21: Delivery Log**
- Every attempt is recorded (status code, duration, error, attempt number). Owner/Admin can view recent deliveries per webhook.

### 3.6 Rate Limiting

**FR-22: Rate Limiting**
- Redis-backed sliding-window (or token-bucket) limits at three levels:
  - **per org** — flat default in v1, tier-configurable later;
  - **per credential** (user or API key) — prevents one client from exhausting the org's budget;
  - **per IP** on unauthenticated auth endpoints (login, signup, refresh, password reset, invite accept), with stricter limits for brute-force protection. Per-org limiting cannot apply there because no tenant context exists yet.
- Exceeded limits return `429` with `Retry-After`; successful responses include `X-RateLimit-Limit/Remaining/Reset`.
- If Redis is unavailable, general API limits **fail open** (and log/alert); auth-endpoint limits **fail closed**.

### 3.7 Audit Log

**FR-23: Action Logging**
- The following are logged with actor (user or API key), timestamp, org, target, and metadata (e.g., old/new role):
  - member invited, joined, role changed, removed; ownership transferred
  - project deleted
  - API key created, revoked
  - webhook created, updated, deleted
  - failed-login lockouts (optional)
- Audit records are append-only; no endpoint can modify or delete them.

**FR-24: View Audit Log**
- Owner/Admin can view and filter (by actor, action, date range) their org's audit log with cursor pagination.

### 3.8 Permission Matrix

| Action | Owner | Admin | Member | API key (read) | API key (read_write) |
|---|:-:|:-:|:-:|:-:|:-:|
| View projects and tasks | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create/edit projects | ✓ | ✓ | ✓ | ✗ | ✓ |
| Delete project | ✓ | ✓ | ✗ | ✗ | ✗ |
| Create/edit tasks, assign | ✓ | ✓ | ✓ | ✗ | ✓ |
| Delete task | ✓ | ✓ | creator only | ✗ | ✗ |
| View members | ✓ | ✓ | ✓ | ✗ | ✗ |
| Invite members | ✓ | ✓ | ✗ | ✗ | ✗ |
| Change role / remove Member | ✓ | ✓ | ✗ | ✗ | ✗ |
| Change role / remove Admin | ✓ | ✗ | ✗ | ✗ | ✗ |
| Transfer ownership | ✓ | ✗ | ✗ | ✗ | ✗ |
| Manage API keys | ✓ | ✓ | ✗ | ✗ | ✗ |
| Manage webhooks / view deliveries | ✓ | ✓ | ✗ | ✗ | ✗ |
| View audit log | ✓ | ✓ | ✗ | ✗ | ✗ |

Authorization is implemented as a single policy module (action → allowed principals) rather than inline checks in routes, so the matrix above can be unit-tested directly.

---

## 4. External Interface Requirements

### 4.1 API Interface
- RESTful JSON API under a versioned base path: `/api/v1/...`
- Standard HTTP status codes and a consistent error envelope:
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action.",
    "details": [],
    "requestId": "req_01H..."
  }
}
```
  `details` carries field-level validation errors (`400 VALIDATION_ERROR`). Other codes include `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `INVALID_STATUS_TRANSITION` (422), `RATE_LIMITED` (429).
- Cursor pagination on all list endpoints: `?limit=&cursor=` (default 25, max 100), response includes `nextCursor`.
- API documented via an OpenAPI/Swagger spec, generated from the Zod schemas where possible so spec and validation cannot drift.

### 4.2 Core Endpoint Groups (indicative, not exhaustive)

| Group | Example Endpoints |
|---|---|
| Auth | `POST /auth/signup`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/invite/accept`, `/auth/password/forgot`, `/auth/password/reset` |
| Orgs | `GET /orgs/me`, `POST /orgs/transfer-ownership` |
| Members | `GET /orgs/members`, `PATCH /orgs/members/:userId`, `DELETE /orgs/members/:userId` |
| Invitations | `POST /orgs/invitations`, `GET /orgs/invitations`, `DELETE /orgs/invitations/:id` |
| Projects | `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id` |
| Tasks | `GET/POST /projects/:id/tasks`, `GET/PATCH/DELETE /tasks/:id` |
| API Keys | `GET/POST /api-keys`, `DELETE /api-keys/:id` |
| Webhooks | `GET/POST /webhooks`, `PATCH/DELETE /webhooks/:id`, `GET /webhooks/:id/deliveries` |
| Audit Log | `GET /audit-log` |
| Ops | `GET /health` (liveness), `GET /ready` (DB + Redis readiness) |

---

## 5. Non-Functional Requirements

### 5.1 Security
- Passwords hashed with argon2id (or bcrypt with an appropriate cost factor).
- Access JWTs live 15 minutes; refresh tokens rotate with reuse detection (FR-3). Signing keys come from environment/secret storage, never the repo.
- **Tenant isolation, defence in depth:**
  1. A Prisma client extension injects `orgId` into every tenant-scoped query (shared helper, not ad hoc per route).
  2. PostgreSQL RLS policies on tenant tables, driven by a per-request `app.current_org` setting, act as a backstop.
  3. Composite foreign keys (e.g., `Task(projectId, orgId)` → `Project(id, orgId)`) make cross-tenant references impossible at the database level.
  4. Automated tests attempt cross-tenant reads/writes for every resource and must fail closed.
- Input validation on all endpoints (Zod); request body size limits; CORS allow-list; security headers (helmet).
- Secrets at rest: API keys, invitation tokens, and refresh tokens stored hashed; webhook secrets stored encrypted.
- Webhook SSRF protections as described in FR-18.
- Rate limiting and brute-force protection on auth endpoints (FR-22).

### 5.2 Performance
- Target: p95 under 200 ms for standard CRUD operations, measured against a seeded dataset (e.g., 100 orgs, 10k projects, 500k tasks) at a defined load (e.g., 50 concurrent users). Webhook delivery is async and excluded.
- Required indexes are listed in Section 6.

### 5.3 Reliability
- Webhook delivery never blocks the originating request (background queue, FR-19).
- Failed deliveries are retried with backoff and recorded (FR-21).
- Graceful shutdown: in-flight requests and jobs finish before the process exits.

### 5.4 Maintainability
- TypeScript throughout (strict mode).
- Layered architecture: routes → controllers → services → data access (Prisma). Tenant scoping and authorization live in shared modules, not in controllers.
- Database changes via versioned Prisma migrations only.

### 5.5 Testability
- Unit tests for services, especially the RBAC policy module and tenant-scoping logic.
- Integration tests (Supertest, against a real Postgres/Redis test environment) for critical flows: signup, login/refresh/rotation, invite, project/task CRUD, API key auth, webhook delivery, and cross-tenant isolation.

### 5.6 Scalability
- Stateless application layer so multiple instances can run behind a load balancer without session affinity. Rate-limit state, queues, and tokens live in Redis/Postgres, never in process memory.

### 5.7 Observability *(moved into core scope from the DevOps phase)*
- Structured JSON logging (e.g., pino) with a request ID on every log line and returned in the error envelope. Secrets and tokens are redacted.
- `/health` and `/ready` endpoints.
- Basic metrics hooks (request count/latency, queue depth) so the later Prometheus/Grafana work has something to scrape.

---

## 6. Data Model (High-Level)

```
Org
 ├── id, name, createdAt

User
 ├── id, email (unique, case-insensitive), passwordHash, createdAt

OrgMembership
 ├── userId, orgId, role (owner | admin | member), createdAt
 ├── PK (userId, orgId)
 └── partial unique index: exactly one 'owner' per org

Invitation
 ├── id, orgId, email, role (admin | member), tokenHash,
 │   invitedById, expiresAt, acceptedAt, revokedAt, createdAt

RefreshToken
 ├── id, userId, orgId, familyId, tokenHash, expiresAt, revokedAt, replacedById, createdAt

PasswordResetToken
 ├── id, userId, tokenHash, expiresAt, usedAt

Project
 ├── id, orgId, name, description, createdById, createdAt, updatedAt
 └── unique (orgId, name); unique (id, orgId) for composite FK

Task
 ├── id, projectId, orgId, title, description, status,
 │   assigneeId (nullable), createdById, createdAt, updatedAt
 └── FK (projectId, orgId) → Project(id, orgId)

ApiKey
 ├── id, orgId, name, prefix (unique), hashedSecret, scope (read | read_write),
 │   createdById, expiresAt, revokedAt, lastUsedAt, createdAt

Webhook
 ├── id, orgId, url, encryptedSecret, events[], active,
 │   consecutiveFailures, createdById, createdAt

WebhookDelivery
 ├── id, webhookId, orgId, eventId, eventType, attempt, statusCode,
 │   durationMs, error, createdAt

AuditLog (append-only)
 ├── id, orgId, actorType (user | api_key | system), actorId,
 │   action, targetType, targetId, metadata (JSON), ip, createdAt
```

**Indexes (minimum):**
- `Project (orgId, createdAt, id)` for cursor listing
- `Task (orgId, projectId, status, id)` and `Task (orgId, assigneeId)`
- `ApiKey (prefix)`
- `RefreshToken (tokenHash)` and `(familyId)`
- `Invitation (orgId, email)` and `(tokenHash)`
- `AuditLog (orgId, createdAt, id)` and `(orgId, action, createdAt)`
- `WebhookDelivery (webhookId, createdAt)`

**Notes:**
- `orgId` is denormalized onto `Task` (and similar child tables) to simplify scoped queries, indexing, and RLS; the composite foreign key guarantees it can never disagree with the parent's `orgId`.
- Every tenant-owned table carries `orgId` and is covered by the Prisma extension and RLS policies (Section 5.1).
- Audit log and webhook delivery tables will grow fastest; plan for time-based retention or partitioning later.

---

## 7. Future Improvements — DevOps Wrap

These are explicitly deferred from the core application scope but planned as a follow-on phase to demonstrate the full development-to-deployment lifecycle:

- **Containerization:** Dockerize the API, with a `docker-compose.yml` for local Postgres + Redis + app. *(A minimal compose file for local development is recommended from the first milestone, since the app needs Postgres and Redis from day one.)*
- **CI Pipeline:** GitHub Actions workflow to lint, type-check, run unit/integration tests (with Postgres and Redis service containers), and build the Docker image on every push.
- **CD Pipeline:** Automated deployment of tested images to a cloud target (AWS ECS or EC2) on merge to `main`, including running database migrations as a deployment step.
- **Reverse Proxy:** Nginx (or an AWS ALB) in front of the API for TLS termination and routing.
- **Infrastructure as Code:** Terraform scripts to provision the AWS resources (VPC, ECS/EC2, RDS, ElastiCache) instead of manual setup.
- **Monitoring & Logging:** Centralized logging (CloudWatch or ELK) and metrics dashboards (Prometheus + Grafana), with basic alerting on error rate/latency.
- **Load Testing:** k6 or Locust scripts to validate rate-limiting behavior and measure performance under load against the targets in Section 5.2.
- **Optional:** Kubernetes deployment (via minikube locally, then EKS) once the Docker-based setup is stable.

---

## 8. Appendix

### 8.1 Open Questions / Stretch Goals
- Multi-org membership with an in-session "active org" switch endpoint.
- Per-project granular permissions beyond org-level roles.
- Configurable rate-limit tiers (foundation for a future billing/plan system).
- Organization deletion / data export.
- Soft delete and restore for projects and tasks.
- Email verification and a live email provider.
- Task extras: priority, due date, labels, comments.

### 8.2 Suggested Build Order

| Phase | Deliverable |
|---|---|
| 1 | Project skeleton, docker-compose (Postgres + Redis), Prisma schema/migrations, error envelope, logging, `/health` |
| 2 | Signup, login, refresh/logout; Prisma tenant-scoping extension + RLS; RBAC policy module |
| 3 | Invitations, membership management, ownership transfer |
| 4 | Projects and tasks (including status workflow, assignment, pagination, filters) |
| 5 | Audit logging (wired in as each feature lands, finalized here) and cross-tenant isolation test suite |
| 6 | API keys and API-key authentication |
| 7 | Rate limiting |
| 8 | Webhooks: queue, signing, retries, delivery log, SSRF protection |
| 9 | OpenAPI docs, seed data, Postman collection; then the DevOps wrap (Section 7) |

### 8.3 Revision History

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-09-04 | Initial draft |
| 1.1 | 2026-11-03 | Review pass: added refresh tokens, password reset, ownership transfer, invitation entity, permission matrix, and design-decisions table; clarified API key semantics (scope, no role, no admin access); resolved "configurable" role ambiguities; hardened tenant isolation (RLS, composite FKs, 404 on cross-tenant); strengthened webhook design (SSRF, replay protection, delivery log, event IDs); expanded rate limiting (per-credential, per-IP); chose cursor pagination; completed data model with indexes; moved logging/health into core; added build order |
