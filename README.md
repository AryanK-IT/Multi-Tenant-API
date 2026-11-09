# TaskFlow — Multi-Tenant Project Management API

[![CI](https://github.com/taskflow/api/actions/workflows/ci.yml/badge.svg)](https://github.com/taskflow/api/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/postgresql-16-blue.svg)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/redis-7-red.svg)](https://redis.io/)
[![Prisma](https://img.shields.io/badge/prisma-5.22-1B222D.svg)](https://www.prisma.io/)
[![Tests](https://img.shields.io/badge/tests-380%2B%20passed-success.svg)](https://vitest.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

TaskFlow is an enterprise-grade, multi-tenant project and issue management REST API engineered with Node.js, Express, TypeScript, Prisma ORM, PostgreSQL, and Redis.

Designed with a **defense-in-depth isolation model**, TaskFlow enforces strict tenant boundaries at both the application and database layers, preventing cross-tenant leakage while offering GitHub-style collaboration, token rotation, scoped service API keys, sliding-window rate limiting, and reliable SSRF-safe webhooks.

---

## Table of Contents

- [Architectural Highlights](#architectural-highlights)
- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
  - [Prerequisites](#prerequisites)
  - [Option A: One-Command Docker Setup](#option-a-one-command-docker-setup-recommended)
  - [Option B: Local Development Setup](#option-b-local-development-setup)
- [Demo Seed Data & Credentials](#demo-seed-data--credentials)
- [API Documentation & Endpoints](#api-documentation--endpoints)
  - [Interactive Swagger UI](#interactive-swagger-ui)
  - [Core Endpoint Summary](#core-endpoint-summary)
  - [Response & Error Envelope](#response--error-envelope)
  - [Cursor-Based Pagination](#cursor-based-pagination)
- [Security & Tenancy Model](#security--tenancy-model)
  - [Multi-Layer Tenant Isolation](#multi-layer-tenant-isolation)
  - [Role-Based Access Control (RBAC)](#role-based-access-control-rbac)
  - [API Key Authorization](#api-key-authorization)
  - [Sliding-Window Rate Limiting](#sliding-window-rate-limiting)
  - [Event-Driven Webhook Engine & SSRF Protection](#event-driven-webhook-engine--ssrf-protection)
- [Project Structure](#project-structure)
- [Testing & Quality Assurance](#testing--quality-assurance)
- [DevOps & Production Deployment](#devops--production-deployment)
- [Documentation & Architectural Decisions](#documentation--architectural-decisions)
- [License](#license)

---

## Architectural Highlights

- 🛡️ **Defense-in-Depth Multi-Tenancy**: Application-level Prisma client query injection + PostgreSQL Row-Level Security (RLS) driven by `SET LOCAL app.current_org` + composite foreign keys (`[id, orgId]`).
- 🔒 **Zero Information Leakage**: Cross-tenant requests return `404 NOT_FOUND` rather than `403 FORBIDDEN` to prevent tenant enumeration.
- 🔑 **Hardened Authentication**: 15-minute access JWTs coupled with server-managed rotating refresh tokens featuring **token family reuse detection** (revoking compromised sessions immediately).
- 👥 **Hierarchical RBAC**: Strict single-`Owner` organization governance, administrative boundary protections (Admins cannot modify Owners or other Admins), and standard `Member` permissions.
- ⚡ **Multi-Tier Rate Limiting**: Redis-backed sliding-window rate limiters across three distinct vectors: Per-IP on unauthenticated endpoints, Per-Tenant (1,000 req/min), and Per-Credential for programmatic API keys.
- 🪝 **Fault-Tolerant Webhooks**: Asynchronous delivery queue powered by BullMQ & Redis, HMAC-SHA256 signature verification, AES-256-GCM secret encryption at rest, exponential retries, and comprehensive SSRF validation against private CIDRs and cloud metadata IP ranges.
- 📜 **Append-Only Audit Logging**: Tamper-evident, tenant-isolated audit trail capturing actor types (`user`, `api_key`, `system`), targeted entities, IPs, and contextual metadata.
- 📖 **Self-Documenting API**: Integrated Swagger UI available at `/docs` with a complete OpenAPI 3.1.0 specification and Postman collection.

---

## System Architecture

```text
                               +---------------------------------------+
                               |        Client / Frontend / CLI        |
                               +-------------------+-------------------+
                                                   |
                                                   v
                               +-------------------+-------------------+
                               |           Nginx Reverse Proxy         |
                               |          SSL / Rate Proxy Hop         |
                               +-------------------+-------------------+
                                                   |
                                                   v
                               +-------------------+-------------------+
                               |       TaskFlow Express API Engine     |
                               |  - Request ID Tracing (Pino Logger)   |
                               |  - Helmet / Security Headers & CORS   |
                               |  - Redis Sliding-Window Rate Limiting |
                               |  - JWT & API Key Authentication       |
                               |  - Centralized RBAC Policy Engine     |
                               +---------+-------------------+---------+
                                         |                   |
                     +-------------------+                   +-------------------+
                     |                                                           |
                     v                                                           v
       +-------------+-------------+                               +-------------+-------------+
       |   Prisma Client Extension |                               |     BullMQ Webhook Queue  |
       |  - Tenant orgId Injection |                               |  - Asynchronous Dispatch  |
       |  - Local RLS Transaction  |                               |  - SSRF Protection Guard  |
       |  - Strict Cascading Logic |                               |  - HMAC-SHA256 Signing    |
       +-------------+-------------+                               +-------------+-------------+
                     |                                                           |
                     v                                                           v
       +-------------+-------------+                               +-------------+-------------+
       |    PostgreSQL 16 Engine   |                               |       Redis 7 Store       |
       |  - Row-Level Security     |                               |  - Rate-limit timestamps  |
       |  - Composite Foreign Keys |                               |  - BullMQ Queue & States  |
       |  - Partitioned / Indexed  |                               |                           |
       +---------------------------+                               +---------------------------+
```

---

## Tech Stack

| Category            | Technology                                                                              | Description                                                              |
| :------------------ | :-------------------------------------------------------------------------------------- | :----------------------------------------------------------------------- |
| **Runtime**         | [Node.js 22 LTS](https://nodejs.org/)                                                   | Modern JavaScript runtime                                                |
| **Language**        | [TypeScript 5.7](https://www.typescriptlang.org/)                                       | Strict-mode static typing across the entire codebase                     |
| **Web Framework**   | [Express 4.21](https://expressjs.com/)                                                  | RESTful routing with dual `/api/v1` and direct aliases                   |
| **Database & ORM**  | [PostgreSQL 16](https://www.postgresql.org/) + [Prisma 5.22](https://www.prisma.io/)    | Relational database with Row-Level Security & custom Prisma extensions   |
| **Cache & Queue**   | [Redis 7](https://redis.io/) + [BullMQ 5.34](https://docs.bullmq.io/)                   | In-memory store for rate limiting and durable background task queues     |
| **Security & Auth** | `jsonwebtoken`, `bcrypt`, AES-256-GCM                                                   | Token signing, password hashing, and encrypted webhook secrets           |
| **Validation**      | [Zod 3.23](https://zod.dev/)                                                            | Strict request body, query parameter, and environment schema validation  |
| **Logging**         | [Pino 9.6](https://getpino.io/)                                                         | High-performance JSON structured logging with request correlation IDs    |
| **Testing**         | [Vitest 2.1](https://vitest.dev/) + [Supertest 7.0](https://github.com/ladjs/supertest) | Comprehensive unit, integration, and cross-tenant isolation suites       |
| **Documentation**   | [OpenAPI 3.1](https://www.openapis.org/) + [Swagger UI 5](https://swagger.io/)          | Interactive API explorer rendered directly from the server               |
| **DevOps & IaC**    | Docker, Nginx, [Terraform](https://www.terraform.io/)                                   | Containerized microservice, production reverse proxy, AWS infrastructure |

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) `>= 22.0.0`
- [npm](https://www.npmjs.com/) `>= 10.0.0`
- [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/)

---

### Option A: One-Command Docker Setup (Recommended)

To spin up the entire TaskFlow stack (PostgreSQL 16, Redis 7, and the compiled TaskFlow API) with pre-configured healthchecks:

```bash
docker compose up -d --build
```

The server will automatically start at **`http://localhost:3000`**.

Verify health:

```bash
curl http://localhost:3000/health
```

---

### Option B: Local Development Setup

1. **Clone the repository**:

   ```bash
   git clone https://github.com/taskflow/api.git
   cd "Multi tenant API"
   ```

2. **Install dependencies**:

   ```bash
   npm ci
   ```

3. **Configure Environment Variables**:
   Copy the example environment file and customize as needed:

   ```bash
   cp .env.example .env
   ```

   Key environment configuration:

   ```env
   NODE_ENV=development
   PORT=3000
   DATABASE_URL=postgresql://taskflow:taskflow_dev_secret@localhost:5432/taskflow_dev?schema=public
   REDIS_URL=redis://localhost:6379
   JWT_ACCESS_SECRET=your_jwt_access_secret_must_be_at_least_32_characters_long
   JWT_ACCESS_EXPIRATION=15m
   JWT_REFRESH_SECRET=your_jwt_refresh_secret_must_be_at_least_32_characters_long
   JWT_REFRESH_EXPIRATION_DAYS=7
   WEBHOOK_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
   LOG_LEVEL=info
   ```

4. **Start PostgreSQL & Redis dependencies**:

   ```bash
   docker compose up postgres redis -d
   ```

5. **Generate Prisma Client & Run Database Migrations**:

   ```bash
   npx prisma generate
   npx prisma db push
   ```

6. **Seed Test Data**:
   Populate organizations, users, projects, tasks, and API keys:

   ```bash
   npm run db:seed
   ```

7. **Start the Development Server**:

   ```bash
   npm run dev
   ```

   The server will reload automatically on file changes at `http://localhost:3000`.

---

## Demo Seed Data & Credentials

Running `npm run db:seed` automatically provisions isolated test organizations and users with default password: **`Password123!`**.

### Pre-Seeded Organizations & Users

| Organization           | ID                                     | User Email         | Role     |
| :--------------------- | :------------------------------------- | :----------------- | :------- |
| **Acme Technologies**  | `00000000-0000-4000-8000-000000000001` | `owner@acme.com`   | `owner`  |
| **Acme Technologies**  | `00000000-0000-4000-8000-000000000001` | `admin@acme.com`   | `admin`  |
| **Acme Technologies**  | `00000000-0000-4000-8000-000000000001` | `member@acme.com`  | `member` |
| **Globex Innovations** | `00000000-0000-4000-8000-000000000002` | `owner@globex.com` | `owner`  |

### Pre-Seeded API Keys (Acme Technologies)

| Key Name                      | Scope        | Key Secret                           |
| :---------------------------- | :----------- | :----------------------------------- |
| **CI/CD Pipeline Key**        | `read_write` | `tfk_live_acmedep1_secret1234567890` |
| **Prometheus Monitoring Key** | `read`       | `tfk_live_acmemo11_secret1234567890` |

### Pre-Seeded Projects & Tasks

- **Acme Technologies**:
  - `Marketing Web Portal` (`30000000-0000-4000-8000-000000000001`)
  - `Core API Platform` (`30000000-0000-4000-8000-000000000002`)
    - Task: _Set up Prisma schema and composite foreign keys_ (`done`)
    - Task: _Implement Redis sliding-window rate limiter_ (`in_progress`)
    - Task: _Configure BullMQ webhook queue worker_ (`todo`)
- **Globex Innovations**:
  - `Globex Enterprise Cloud` (`30000000-0000-4000-8000-000000000003`)
    - Task: _Architecture audit and tenant security verification_ (`in_progress`)

---

## API Documentation & Endpoints

### Interactive Swagger UI

TaskFlow provides a built-in, interactive documentation UI rendered via Swagger UI:

- **Swagger UI**: [`http://localhost:3000/docs`](http://localhost:3000/docs) (also mirrored at `/api/docs`)
- **OpenAPI 3.1.0 JSON Specification**: [`http://localhost:3000/docs/openapi.json`](http://localhost:3000/docs/openapi.json)
- **Postman Collection**: Located in [`docs/postman/TaskFlow_API.postman_collection.json`](docs/postman/TaskFlow_API.postman_collection.json) with accompanying environment settings.

---

### Core Endpoint Summary

All authenticated endpoints accept canonical `/api/v1/*` paths as well as root-level aliases (e.g., `/api/v1/projects` or `/projects`).

#### 1. Operations & Health

| Method | Endpoint             | Description                                                 | Auth Required |
| :----- | :------------------- | :---------------------------------------------------------- | :------------ |
| `GET`  | `/health`            | Liveness check (process uptime, status)                     | No            |
| `GET`  | `/ready`             | Readiness check (validates PostgreSQL & Redis connectivity) | No            |
| `GET`  | `/docs`              | Interactive Swagger UI documentation                        | No            |
| `GET`  | `/docs/openapi.json` | OpenAPI 3.1.0 schema specification                          | No            |

#### 2. Authentication & Session

| Method | Endpoint                       | Description                                                   | Auth Required       |
| :----- | :----------------------------- | :------------------------------------------------------------ | :------------------ |
| `POST` | `/api/v1/auth/signup`          | Register new user and provision an initial organization       | No (Per-IP limited) |
| `POST` | `/api/v1/auth/login`           | Authenticate user; returns Access Token (15m) & Refresh Token | No (Per-IP limited) |
| `POST` | `/api/v1/auth/refresh`         | Rotate refresh token; revokes family upon reuse detection     | No (Per-IP limited) |
| `POST` | `/api/v1/auth/logout`          | Revoke current refresh token family                           | No                  |
| `POST` | `/api/v1/auth/invite/accept`   | Accept an organization invitation using an invite token       | Bearer Token        |
| `POST` | `/api/v1/auth/password/forgot` | Generate password reset token                                 | No                  |
| `POST` | `/api/v1/auth/password/reset`  | Reset password using one-time token                           | No                  |
| `GET`  | `/api/v1/auth/me`              | Inspect current caller context, active organization, and role | Bearer / API Key    |

#### 3. Organization & Membership Management

| Method   | Endpoint                          | Description                                       | Required Role              |
| :------- | :-------------------------------- | :------------------------------------------------ | :------------------------- |
| `GET`    | `/api/v1/orgs/me`                 | Get active tenant organization details            | `member`, `admin`, `owner` |
| `POST`   | `/api/v1/orgs/transfer-ownership` | Transfer organization ownership to another member | `owner` only               |
| `GET`    | `/api/v1/orgs/members`            | List members of the active organization           | `member`, `admin`, `owner` |
| `PATCH`  | `/api/v1/orgs/members/:userId`    | Update member role (`admin`, `member`)            | `admin`, `owner`           |
| `DELETE` | `/api/v1/orgs/members/:userId`    | Remove member from organization                   | `admin`, `owner`           |
| `POST`   | `/api/v1/orgs/invitations`        | Invite a new user by email with assigned role     | `admin`, `owner`           |
| `GET`    | `/api/v1/orgs/invitations`        | List pending organization invitations             | `admin`, `owner`           |
| `DELETE` | `/api/v1/orgs/invitations/:id`    | Revoke pending invitation                         | `admin`, `owner`           |

#### 4. Projects & Tasks

| Method   | Endpoint                            | Description                                   | Required Role / Scope                     |
| :------- | :---------------------------------- | :-------------------------------------------- | :---------------------------------------- |
| `POST`   | `/api/v1/projects`                  | Create a new project within current tenant    | `member`, `admin`, `owner` / `read_write` |
| `GET`    | `/api/v1/projects`                  | Cursor-paginated list of tenant projects      | `member`, `admin`, `owner` / `read`       |
| `GET`    | `/api/v1/projects/:id`              | Retrieve project details                      | `member`, `admin`, `owner` / `read`       |
| `PATCH`  | `/api/v1/projects/:id`              | Update project name or description            | `member`, `admin`, `owner` / `read_write` |
| `DELETE` | `/api/v1/projects/:id`              | Cascading project deletion with audit log     | `admin`, `owner` / `read_write`           |
| `POST`   | `/api/v1/projects/:projectId/tasks` | Create task nested under project              | `member`, `admin`, `owner` / `read_write` |
| `GET`    | `/api/v1/projects/:projectId/tasks` | List tasks filtered by status/assignee        | `member`, `admin`, `owner` / `read`       |
| `GET`    | `/api/v1/tasks/:id`                 | Retrieve individual task details              | `member`, `admin`, `owner` / `read`       |
| `PATCH`  | `/api/v1/tasks/:id`                 | Update task (`status`, `title`, `assigneeId`) | `member`, `admin`, `owner` / `read_write` |
| `DELETE` | `/api/v1/tasks/:id`                 | Delete task                                   | `member`, `admin`, `owner` / `read_write` |

#### 5. Programmatic API Keys

| Method   | Endpoint               | Description                                              | Required Role    |
| :------- | :--------------------- | :------------------------------------------------------- | :--------------- |
| `POST`   | `/api/v1/api-keys`     | Generate new API key with `read` or `read_write` scope   | `admin`, `owner` |
| `GET`    | `/api/v1/api-keys`     | List organization API keys (prefix-only, secrets hidden) | `admin`, `owner` |
| `DELETE` | `/api/v1/api-keys/:id` | Revoke an active API key                                 | `admin`, `owner` |

#### 6. Webhooks & Delivery Logs

| Method   | Endpoint                          | Description                                            | Required Role    |
| :------- | :-------------------------------- | :----------------------------------------------------- | :--------------- |
| `POST`   | `/api/v1/webhooks`                | Register endpoint URL, subscribed events, and secret   | `admin`, `owner` |
| `GET`    | `/api/v1/webhooks`                | List registered webhooks                               | `admin`, `owner` |
| `GET`    | `/api/v1/webhooks/:id`            | Get webhook configuration details                      | `admin`, `owner` |
| `PATCH`  | `/api/v1/webhooks/:id`            | Update URL, events, or active toggle                   | `admin`, `owner` |
| `DELETE` | `/api/v1/webhooks/:id`            | Delete webhook endpoint                                | `admin`, `owner` |
| `GET`    | `/api/v1/webhooks/:id/deliveries` | Query cursor-paginated delivery history & status codes | `admin`, `owner` |

#### 7. Audit Log

| Method | Endpoint            | Description                                                         | Required Role    |
| :----- | :------------------ | :------------------------------------------------------------------ | :--------------- |
| `GET`  | `/api/v1/audit-log` | Query tenant audit logs with filtering (`action`, `actorId`, dates) | `admin`, `owner` |

---

### Response & Error Envelope

All responses adhere to a predictable JSON envelope format.

#### Successful Response (Resource / Paginated List)

```json
{
  "data": [
    {
      "id": "30000000-0000-4000-8000-000000000002",
      "orgId": "00000000-0000-4000-8000-000000000001",
      "name": "Core API Platform",
      "description": "Multi-tenant REST API infrastructure",
      "createdAt": "2026-11-09T22:45:00.000Z",
      "updatedAt": "2026-11-09T22:45:00.000Z"
    }
  ],
  "pagination": {
    "nextCursor": "30000000-0000-4000-8000-000000000002",
    "hasMore": false,
    "limit": 20
  }
}
```

#### Standard Error Response

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Project not found.",
    "details": [],
    "requestId": "req_a1b2c3d4e5f67890"
  }
}
```

Standard error codes include: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `RATE_LIMITED`, and `INTERNAL_ERROR`.

---

### Cursor-Based Pagination

All listing endpoints support deterministic cursor-based pagination:

- `?limit=20` (defaults to 20, max 100)
- `?cursor=<id>` (the `nextCursor` value returned in the prior page response)

Benefits over offset-based pagination:

- High performance on large datasets.
- Immune to duplicate/skipped records during concurrent additions or deletions.

---

## Security & Tenancy Model

### Multi-Layer Tenant Isolation

TaskFlow employs a three-tier isolation architecture:

1. **Application-Layer Scoping (Prisma Extension)**: Custom Prisma client extension automatically injects `where: { orgId }` into all database reads, writes, and updates.
2. **Database-Layer Row-Level Security (PostgreSQL RLS)**: In production transactions, PostgreSQL RLS policies evaluate `current_setting('app.current_org') = orgId`. Queries without matching tenant context are rejected by the database engine.
3. **Composite Foreign Key Integrity**: Relational tables enforce composite uniqueness, such as `Task(projectId, orgId) REFERENCES Project(id, orgId)`. A task cannot belong to a project in a different organization.

> **Zero Information Leakage Policy**: When a resource belongs to another tenant or does not exist, the API always responds with `404 NOT_FOUND` (never `403 FORBIDDEN`), mitigating tenant resource enumeration.

---

### Role-Based Access Control (RBAC)

TaskFlow implements an explicit role hierarchy:

```text
[Owner]
  └── Has all privileges, including organization deletion and ownership transfer.
  └── Exactly ONE Owner per organization.

[Admin]
  └── Can manage members, invitations, projects, tasks, API keys, webhooks, and audit logs.
  └── CANNOT manage other Admins or the Owner.
  └── CANNOT transfer ownership.

[Member]
  └── Can view organization resources, create/update projects, and create/update/assign tasks.
  └── CANNOT access API keys, webhooks, invitations, audit logs, or member role administration.
```

---

### API Key Authorization

Programmatic API keys allow machine-to-machine integration without human credentials:

- **Prefix-Indexed**: Formatted as `tfk_live_<prefix>_<secret>` (SHA-256 hashed in database, secret never stored).
- **Service Principal Scopes**:
  - `read`: Read-only access to projects and tasks.
  - `read_write`: Create, edit, and delete access for projects and tasks.
- **Administrative Restriction**: API keys are strictly forbidden from accessing user management, invitation handling, billing, ownership, or audit log endpoints.

Authentication header:

```http
Authorization: Bearer tfk_live_acmedep1_secret1234567890
```

_(Also accepts `x-api-key: tfk_...`)_

---

### Sliding-Window Rate Limiting

Rate limiting is powered by Redis sliding-window counters with graceful in-memory fallback:

| Limit Type          | Target Route              | Quota          | Window     | Headers Returned               |
| :------------------ | :------------------------ | :------------- | :--------- | :----------------------------- |
| **Auth Tier**       | `/api/v1/auth/*`          | 20 requests    | 15 minutes | `X-RateLimit-*`, `Retry-After` |
| **Tenant Tier**     | Authenticated User Routes | 1,000 requests | 1 minute   | `X-RateLimit-*`, `Retry-After` |
| **Credential Tier** | Scoped API Keys           | 100 requests   | 1 minute   | `X-RateLimit-*`, `Retry-After` |

---

### Event-Driven Webhook Engine & SSRF Protection

TaskFlow dispatches real-time event notifications with enterprise delivery guarantees:

- **Asynchronous Queue**: Managed by BullMQ with Redis backing and exponential backoff retry scheduling (`10s`, `30s`, `1m`, `5m`, `15m`).
- **Cryptographic Signatures**: Payloads are signed with HMAC-SHA256 and sent via the `X-TaskFlow-Signature` header:
  ```http
  X-TaskFlow-Signature: sha256=4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945
  X-TaskFlow-Event: task.status_changed
  X-TaskFlow-Delivery: del_8a2f4c91b3
  ```
- **Encrypted Secrets**: Destination signing secrets are encrypted at rest with AES-256-GCM.
- **SSRF Safeguards**: Destination URLs are resolved and validated against DNS rebinding, private RFC-1918 CIDR blocks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.1`), link-local, and cloud metadata services (`169.254.169.254`).
- **Circuit Breaker**: Webhook endpoints that produce 20 consecutive delivery failures are automatically marked inactive to protect system resources.

---

## Project Structure

```text
Multi tenant API/
├── .github/
│   └── workflows/
│       ├── ci.yml                 # Linting, formatting check, typecheck, Vitest suite
│       └── cd.yml                 # Multi-stage Docker build and deployment pipeline
├── docs/
│   ├── postman/                   # Postman collection & environment files
│   ├── DECISIONS.md               # Architecture Decision Records (ADRs 1–7)
│   ├── GIT_WORKFLOW_TaskFlow.md   # Branching and commit conventions
│   ├── PROJECT_PROGRESS.md        # Detailed phase completion history
│   └── SRS_TaskFlow_MultiTenant_API.md # Complete requirements specification
├── infra/
│   ├── monitoring/
│   │   └── prometheus.yml         # Prometheus scrape configuration
│   └── terraform/
│       ├── main.tf                # AWS ECS Fargate, RDS PostgreSQL, ElastiCache Redis
│       ├── outputs.tf             # VPC, ALB DNS, and Cluster outputs
│       └── variables.tf           # Terraform input variables
├── nginx/
│   └── nginx.conf                 # Production reverse proxy, caching, and SSL config
├── prisma/
│   ├── schema.prisma              # Database schema with composite keys & indexes
│   └── seed.ts                    # Database seed execution entrypoint
├── src/
│   ├── api-keys/                  # Programmatic API key controller, service & utils
│   ├── audit/                     # Append-only audit logger and query handlers
│   ├── auth/                      # JWT auth, refresh token rotation, password recovery
│   ├── common/                    # Error envelope, custom exceptions, request ID logger
│   ├── config/                    # Type-safe Zod environment validation
│   ├── db/                        # Prisma client factory, tenant extension, seed logic
│   ├── docs/                      # Embedded Swagger UI & OpenAPI 3.1.0 specifications
│   ├── middleware/                # Auth, TenantContext, Authorize, and Validation
│   ├── orgs/                      # Organization profile, memberships, invitations
│   ├── policies/                  # Role-Based Access Control matrix & enforcement
│   ├── projects/                  # Tenant-isolated projects CRUD
│   ├── rate-limit/                # Sliding-window rate limiter (Redis & In-Memory)
│   ├── tasks/                     # Task management, assignment, and status transitions
│   ├── webhooks/                  # BullMQ worker, crypto signing, SSRF guards
│   ├── app.ts                     # Express application factory & middleware setup
│   └── server.ts                  # Server bootstrap & graceful shutdown handler
├── tests/
│   ├── helpers/                   # Test fixtures (two-organization isolation setup)
│   ├── integration/               # API integration tests (Auth, Projects, RLS, Webhooks)
│   ├── load/                      # k6 load testing scripts
│   └── unit/                      # Unit test suites (Services, Crypto, Rate Limiting)
├── docker-compose.prod.yml        # Production multi-container composition
├── docker-compose.yml             # Local development services (Postgres, Redis, API)
├── Dockerfile                     # Multi-stage production container build (Node 22 Alpine)
├── package.json                   # Dependencies, scripts, and engine specifications
├── tsconfig.json                  # Strict TypeScript compiler options
└── vitest.config.ts               # Vitest runner configuration
```

---

## Testing & Quality Assurance

TaskFlow includes an exhaustive suite of **380+ automated unit, integration, and security tests** executed with [Vitest](https://vitest.dev/).

```bash
# Run full test suite once
npm test

# Run tests in watch mode
npm run test:watch

# Generate code coverage report
npm run test:coverage

# TypeScript strict type checking
npm run typecheck

# Code style and lint checks
npm run lint
npm run format:check
```

### Specialized Cross-Tenant Test Suite

The test suite includes dedicated cross-tenant validation ([`tests/integration/tenant-isolation.test.ts`](tests/integration/tenant-isolation.test.ts)) asserting:

- Users from Organization A cannot view, mutate, or delete resources belonging to Organization B.
- Non-existent and cross-tenant resource lookups consistently return `404 NOT_FOUND`.
- Composite primary and foreign keys prevent cross-tenant relational associations.

### Load Testing

A pre-configured [k6](https://k6.io/) load test script is available in [`tests/load/k6-load-test.js`](tests/load/k6-load-test.js) to benchmark rate limiting, Redis connection pooling, and endpoint latency under heavy concurrent request volumes.

---

## DevOps & Production Deployment

### Production Docker Container

The [`Dockerfile`](Dockerfile) is optimized for security and minimal image footprint:

- Multi-stage build (Builder stage compiles TypeScript, Runner stage includes production artifacts only).
- Runs as an **unprivileged non-root user** (`taskflow:taskflow` on Alpine Linux).
- Integrated container health check against `/health`.

Build and run production container locally:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### Infrastructure as Code (Terraform)

AWS production infrastructure files reside in [`infra/terraform`](infra/terraform/):

- **VPC & Subnets**: Multi-AZ public and private subnet architecture with NAT Gateways.
- **Application Load Balancer**: TLS termination and health probe routing.
- **ECS Fargate**: Auto-scaling containerized API tasks.
- **Amazon RDS (PostgreSQL 16)**: Multi-AZ relational storage.
- **Amazon ElastiCache (Redis 7)**: Clustered caching and queue backend.

---

## Documentation & Architectural Decisions

For deep dives into design rationale, security analysis, and specifications, refer to the documentation in `/docs`:

- [SRS — Software Requirements Specification](docs/SRS_TaskFlow_MultiTenant_API.md)
- [Architecture Decision Records (ADRs 1–7)](docs/DECISIONS.md)
- [Git Workflow & Branching Strategy](docs/GIT_WORKFLOW_TaskFlow.md)
- [Development Progress & Phase History](docs/PROJECT_PROGRESS.md)
- [Postman Workspace & Environment](docs/postman/)

---

## License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.
