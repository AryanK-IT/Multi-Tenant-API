# TaskFlow — Multi-Tenant Project Management API

TaskFlow is a multi-tenant, GitHub-inspired project management backend REST API built with Node.js, Express, TypeScript, Prisma, PostgreSQL, and Redis.

## Status

Currently under active development according to the Software Requirements Specification ([SRS](docs/SRS_TaskFlow_MultiTenant_API.md)) and the [Git Workflow Guide](docs/GIT_WORKFLOW_TaskFlow.md).

## Core Principles

- Strict multi-tenant data isolation (Prisma extension + PostgreSQL Row-Level Security).
- Role-Based Access Control (RBAC: Owner, Admin, Member) and scoped API keys.
- Rotating JWT authentication with refresh token reuse detection.
- Event-driven webhook delivery with HMAC-SHA256 signatures and SSRF safeguards.
- Append-only audit logging and Redis-backed rate limiting.

# Multi-Tenant-API
