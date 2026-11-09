/**
 * OpenAPI 3.1.0 Specification for TaskFlow Multi-Tenant REST API
 * Conforms to SRS TaskFlow Multi-Tenant API specifications (§3, §4, §5)
 */

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "TaskFlow - Multi-Tenant Project Management API",
    version: "1.0.0",
    description:
      "Production-grade, multi-tenant project and task management REST API featuring strict tenant data isolation (Prisma extension + PostgreSQL Row-Level Security), JWT refresh token rotation, granular Role-Based Access Control (RBAC), prefix-indexed API keys, sliding-window rate limiting, and reliable SSRF-safe webhooks.",
    contact: {
      name: "TaskFlow Engineering Team",
      url: "https://github.com/taskflow/api",
    },
    license: {
      name: "MIT",
      url: "https://opensource.org/licenses/MIT",
    },
  },
  servers: [
    {
      url: "/api/v1",
      description: "Version 1 API base path",
    },
    {
      url: "/",
      description: "Root server path (Ops & legacy redirects)",
    },
  ],
  tags: [
    {
      name: "Ops",
      description: "Health, liveness, readiness, and API documentation",
    },
    {
      name: "Auth",
      description: "User authentication, JWT token rotation, invitations, and password recovery",
    },
    {
      name: "Orgs",
      description: "Organization profile, membership management, and ownership transfer",
    },
    {
      name: "Invitations",
      description: "Organization member invitation workflows and token acceptance",
    },
    {
      name: "Projects",
      description: "Tenant-scoped project creation, updates, and cursor-paginated retrieval",
    },
    {
      name: "Tasks",
      description: "Task lifecycle, state transitions (TODO -> IN_PROGRESS -> DONE), and assignment",
    },
    {
      name: "API Keys",
      description: "Organization API key management with scoped permissions (read / read_write)",
    },
    {
      name: "Webhooks",
      description: "Event notification registration, HMAC-SHA256 signatures, and delivery history",
    },
    {
      name: "Audit Log",
      description: "Tamper-evident, tenant-isolated audit log inspection with cursor pagination",
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "Standard JWT bearer token issued by `/auth/login` or `/auth/signup`. Pass in `Authorization: Bearer <token>` header.",
      },
      apiKeyAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "tfk_live_*",
        description:
          "TaskFlow API Key passed via `Authorization: Bearer tfk_...` or `x-api-key: tfk_...` header. Grants scoped access without user role.",
      },
    },
    schemas: {
      ErrorEnvelope: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "details", "requestId"],
            properties: {
              code: {
                type: "string",
                enum: [
                  "BAD_REQUEST",
                  "VALIDATION_ERROR",
                  "UNAUTHENTICATED",
                  "FORBIDDEN",
                  "NOT_FOUND",
                  "CONFLICT",
                  "INVALID_STATUS_TRANSITION",
                  "RATE_LIMITED",
                  "INTERNAL_SERVER_ERROR",
                ],
                example: "FORBIDDEN",
              },
              message: {
                type: "string",
                example: "You do not have permission to perform this action.",
              },
              details: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    field: { type: "string", example: "title" },
                    message: { type: "string", example: "Title is required" },
                  },
                },
                example: [],
              },
              requestId: {
                type: "string",
                example: "req_01H8ZXYZ1234567890ABCDEF",
              },
            },
          },
        },
      },
      Role: {
        type: "string",
        enum: ["owner", "admin", "member"],
        example: "admin",
      },
      TaskStatus: {
        type: "string",
        enum: ["todo", "in_progress", "done"],
        example: "todo",
      },
      ApiKeyScope: {
        type: "string",
        enum: ["read", "read_write"],
        example: "read_write",
      },
      CursorPaginationMeta: {
        type: "object",
        required: ["limit", "hasNextPage", "nextCursor"],
        properties: {
          limit: { type: "integer", example: 25 },
          hasNextPage: { type: "boolean", example: true },
          nextCursor: { type: "string", nullable: true, example: "cln1234567890abcdef" },
        },
      },
      HealthCheck: {
        type: "object",
        required: ["status", "uptime", "timestamp"],
        properties: {
          status: { type: "string", example: "ok" },
          uptime: { type: "number", example: 124.5 },
          timestamp: { type: "string", format: "date-time", example: "2026-11-09T18:00:00.000Z" },
        },
      },
      ReadyCheck: {
        type: "object",
        required: ["status", "checks", "timestamp"],
        properties: {
          status: { type: "string", enum: ["ready", "not_ready"], example: "ready" },
          checks: {
            type: "object",
            properties: {
              database: { type: "string", enum: ["ok", "failed", "not_configured"], example: "ok" },
              redis: { type: "string", enum: ["ok", "failed", "not_configured"], example: "ok" },
            },
          },
          timestamp: { type: "string", format: "date-time", example: "2026-11-09T18:00:00.000Z" },
        },
      },
      SignupRequest: {
        type: "object",
        required: ["orgName", "email", "password"],
        properties: {
          orgName: { type: "string", minLength: 2, maxLength: 100, example: "Acme Corp" },
          email: { type: "string", format: "email", example: "owner@acme.com" },
          password: { type: "string", minLength: 8, example: "SecretPassword123!" },
        },
      },
      AuthResponse: {
        type: "object",
        required: ["user", "org", "tokens"],
        properties: {
          user: {
            type: "object",
            required: ["id", "email", "role"],
            properties: {
              id: { type: "string", format: "uuid" },
              email: { type: "string", format: "email" },
              role: { $ref: "#/components/schemas/Role" },
            },
          },
          org: {
            type: "object",
            required: ["id", "name"],
            properties: {
              id: { type: "string", format: "uuid" },
              name: { type: "string" },
            },
          },
          tokens: {
            type: "object",
            required: ["accessToken", "refreshToken"],
            properties: {
              accessToken: { type: "string", example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
              refreshToken: { type: "string", example: "rft_01H8Z..." },
            },
          },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", example: "owner@acme.com" },
          password: { type: "string", example: "SecretPassword123!" },
        },
      },
      RefreshRequest: {
        type: "object",
        required: ["refreshToken"],
        properties: {
          refreshToken: { type: "string", example: "rft_01H8Z..." },
        },
      },
      RefreshResponse: {
        type: "object",
        required: ["accessToken", "refreshToken"],
        properties: {
          accessToken: { type: "string" },
          refreshToken: { type: "string" },
        },
      },
      Project: {
        type: "object",
        required: ["id", "orgId", "name", "createdById", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          orgId: { type: "string", format: "uuid" },
          name: { type: "string", example: "Website Redesign" },
          description: { type: "string", nullable: true, example: "Q4 Marketing portal rewrite" },
          createdById: { type: "string", format: "uuid" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      CreateProjectRequest: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100, example: "Website Redesign" },
          description: { type: "string", maxLength: 1000, nullable: true },
        },
      },
      Task: {
        type: "object",
        required: ["id", "projectId", "orgId", "title", "status", "createdById", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          projectId: { type: "string", format: "uuid" },
          orgId: { type: "string", format: "uuid" },
          title: { type: "string", example: "Implement authentication middleware" },
          description: { type: "string", nullable: true, example: "Support JWT bearer and refresh tokens" },
          status: { $ref: "#/components/schemas/TaskStatus" },
          assigneeId: { type: "string", format: "uuid", nullable: true },
          createdById: { type: "string", format: "uuid" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      CreateTaskRequest: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200, example: "Fix security audit vulnerability" },
          description: { type: "string", maxLength: 5000, nullable: true },
          status: { $ref: "#/components/schemas/TaskStatus" },
          assigneeId: { type: "string", format: "uuid", nullable: true },
        },
      },
      ApiKey: {
        type: "object",
        required: ["id", "orgId", "name", "prefix", "scope", "createdById", "createdAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          orgId: { type: "string", format: "uuid" },
          name: { type: "string", example: "CI/CD Deployment Key" },
          prefix: { type: "string", example: "tfk_live_a1b2c3d4" },
          scope: { $ref: "#/components/schemas/ApiKeyScope" },
          createdById: { type: "string", format: "uuid" },
          expiresAt: { type: "string", format: "date-time", nullable: true },
          revokedAt: { type: "string", format: "date-time", nullable: true },
          lastUsedAt: { type: "string", format: "date-time", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      CreateApiKeyRequest: {
        type: "object",
        required: ["name", "scope"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100, example: "CI/CD Integration" },
          scope: { $ref: "#/components/schemas/ApiKeyScope" },
          expiresAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      CreateApiKeyResponse: {
        type: "object",
        required: ["apiKey", "rawKey"],
        properties: {
          apiKey: { $ref: "#/components/schemas/ApiKey" },
          rawKey: {
            type: "string",
            description: "Plaintext API key. Only returned once upon creation.",
            example: "tfk_live_a1b2c3d4_8f7e6d5c4b3a2019...",
          },
        },
      },
      Webhook: {
        type: "object",
        required: ["id", "orgId", "url", "events", "active", "consecutiveFailures", "createdById", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          orgId: { type: "string", format: "uuid" },
          url: { type: "string", format: "uri", example: "https://api.partner.com/webhooks/taskflow" },
          events: {
            type: "array",
            items: { type: "string" },
            example: ["task.created", "task.status_changed"],
          },
          active: { type: "boolean", example: true },
          consecutiveFailures: { type: "integer", example: 0 },
          createdById: { type: "string", format: "uuid" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      CreateWebhookRequest: {
        type: "object",
        required: ["url", "events"],
        properties: {
          url: { type: "string", format: "uri", example: "https://api.partner.com/webhooks/taskflow" },
          events: {
            type: "array",
            items: { type: "string" },
            example: ["project.created", "task.created", "task.status_changed"],
          },
        },
      },
      CreateWebhookResponse: {
        type: "object",
        required: ["webhook", "secret"],
        properties: {
          webhook: { $ref: "#/components/schemas/Webhook" },
          secret: {
            type: "string",
            description: "HMAC signing secret. Displayed only once.",
            example: "whsec_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      },
      WebhookDelivery: {
        type: "object",
        required: ["id", "webhookId", "orgId", "eventId", "eventType", "attempt", "durationMs", "createdAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          webhookId: { type: "string", format: "uuid" },
          orgId: { type: "string", format: "uuid" },
          eventId: { type: "string", example: "evt_a1b2c3d4" },
          eventType: { type: "string", example: "task.created" },
          attempt: { type: "integer", example: 1 },
          statusCode: { type: "integer", nullable: true, example: 200 },
          durationMs: { type: "integer", example: 45 },
          error: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      AuditLog: {
        type: "object",
        required: ["id", "orgId", "actorType", "action", "targetType", "createdAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          orgId: { type: "string", format: "uuid" },
          actorType: { type: "string", enum: ["user", "api_key", "system"], example: "user" },
          actorId: { type: "string", nullable: true, format: "uuid" },
          action: { type: "string", example: "project.created" },
          targetType: { type: "string", example: "project" },
          targetId: { type: "string", nullable: true },
          metadata: { type: "object", nullable: true },
          ip: { type: "string", nullable: true, example: "192.0.2.1" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
    },
    responses: {
      UnauthorizedError: {
        description: "Authentication token is missing, expired, or invalid",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
      },
      ForbiddenError: {
        description: "Principal does not have authorization for this resource or operation",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
      },
      NotFoundError: {
        description: "The requested entity was not found in the current tenant scope",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
      },
      ValidationError: {
        description: "Invalid request body, query parameter, or payload schema",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
      },
      RateLimitedError: {
        description: "Too many requests. Sliding window limit exceeded.",
        headers: {
          "Retry-After": {
            schema: { type: "integer" },
            description: "Seconds until the rate limit window resets",
          },
          "X-RateLimit-Limit": {
            schema: { type: "integer" },
            description: "Configured request limit for the active tier",
          },
          "X-RateLimit-Remaining": {
            schema: { type: "integer" },
            description: "Remaining allowed requests in current window",
          },
          "X-RateLimit-Reset": {
            schema: { type: "integer" },
            description: "Unix epoch seconds when the limit resets",
          },
        },
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Ops"],
        summary: "Liveness probe",
        description: "Verifies the Express application process is running and responsive.",
        responses: {
          "200": {
            description: "Service is healthy",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthCheck" },
              },
            },
          },
        },
      },
    },
    "/ready": {
      get: {
        tags: ["Ops"],
        summary: "Readiness probe",
        description: "Verifies dependent backing services (PostgreSQL and Redis) are connected and ready to accept traffic.",
        responses: {
          "200": {
            description: "All services ready",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ReadyCheck" },
              },
            },
          },
          "503": {
            description: "One or more backing services failed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ReadyCheck" },
              },
            },
          },
        },
      },
    },
    "/auth/signup": {
      post: {
        tags: ["Auth"],
        summary: "Register new organization and owner account",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SignupRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Organization created and user signed up",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "409": { description: "Email already exists" },
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "User credential login",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LoginRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Authenticated successfully; returns JWT tokens",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/UnauthorizedError" },
        },
      },
    },
    "/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Rotate refresh token and obtain new access token",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RefreshRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "New token pair issued",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RefreshResponse" },
              },
            },
          },
          "401": { description: "Token expired, invalid, or reused" },
        },
      },
    },
    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Revoke refresh token session",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RefreshRequest" },
            },
          },
        },
        responses: {
          "200": { description: "Session logged out and token invalidated" },
        },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Get current authenticated caller session",
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        responses: {
          "200": { description: "Current caller authentication and tenant context" },
          "401": { $ref: "#/components/responses/UnauthorizedError" },
        },
      },
    },
    "/orgs/me": {
      get: {
        tags: ["Orgs"],
        summary: "Get current organization details",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Organization details and member count" },
          "401": { $ref: "#/components/responses/UnauthorizedError" },
        },
      },
    },
    "/orgs/transfer-ownership": {
      post: {
        tags: ["Orgs"],
        summary: "Transfer organization ownership to an existing member",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["newOwnerUserId"],
                properties: {
                  newOwnerUserId: { type: "string", format: "uuid" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Ownership transferred; previous owner converted to admin" },
          "403": { description: "Only current owner can transfer ownership" },
        },
      },
    },
    "/orgs/members": {
      get: {
        tags: ["Orgs"],
        summary: "List all organization members",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 25 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Paginated list of organization members" },
          "401": { $ref: "#/components/responses/UnauthorizedError" },
        },
      },
    },
    "/orgs/members/{userId}": {
      patch: {
        tags: ["Orgs"],
        summary: "Update member role (admin/owner only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["role"],
                properties: {
                  role: { type: "string", enum: ["admin", "member"] },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Member role updated" },
          "403": { $ref: "#/components/responses/ForbiddenError" },
          "404": { $ref: "#/components/responses/NotFoundError" },
        },
      },
      delete: {
        tags: ["Orgs"],
        summary: "Remove member from organization",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Member removed" },
          "403": { $ref: "#/components/responses/ForbiddenError" },
          "404": { $ref: "#/components/responses/NotFoundError" },
        },
      },
    },
    "/orgs/invitations": {
      post: {
        tags: ["Invitations"],
        summary: "Invite a new member via email",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "role"],
                properties: {
                  email: { type: "string", format: "email" },
                  role: { type: "string", enum: ["admin", "member"] },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Invitation dispatched" },
          "403": { $ref: "#/components/responses/ForbiddenError" },
        },
      },
      get: {
        tags: ["Invitations"],
        summary: "List pending invitations",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "List of pending invitations" },
        },
      },
    },
    "/projects": {
      get: {
        tags: ["Projects"],
        summary: "List projects with cursor pagination",
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 25, maximum: 100 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Projects list with pagination metadata",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/Project" } },
                    meta: { $ref: "#/components/schemas/CursorPaginationMeta" },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/UnauthorizedError" },
        },
      },
      post: {
        tags: ["Projects"],
        summary: "Create a new project",
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateProjectRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Project created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Project" },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "403": { $ref: "#/components/responses/ForbiddenError" },
        },
      },
    },
    "/projects/{id}": {
      get: {
        tags: ["Projects"],
        summary: "Get project by ID",
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            content: { "application/json": { schema: { $ref: "#/components/schemas/Project" } } },
          },
          "404": { $ref: "#/components/responses/NotFoundError" },
        },
      },
      patch: {
        tags: ["Projects"],
        summary: "Update project metadata",
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateProjectRequest" } } },
        },
        responses: {
          "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Project" } } } },
          "404": { $ref: "#/components/responses/NotFoundError" },
        },
      },
      delete: {
        tags: ["Projects"],
        summary: "Delete project and cascade its tasks",
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "204": { description: "Project deleted" },
          "404": { $ref: "#/components/responses/NotFoundError" },
        },
      },
    },
    "/projects/{id}/tasks": {
      get: {
        tags: ["Tasks"],
        summary: "List tasks within a project",
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "status", in: "query", schema: { $ref: "#/components/schemas/TaskStatus" } },
          { name: "assigneeId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 25 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/Task" } },
                    meta: { $ref: "#/components/schemas/CursorPaginationMeta" },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Tasks"],
        summary: "Create a task in project",
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateTaskRequest" } } },
        },
        responses: {
          "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Task" } } } },
        },
      },
    },
    "/tasks/{id}": {
      get: {
        tags: ["Tasks"],
        summary: "Get task by ID",
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Task" } } } },
          "404": { $ref: "#/components/responses/NotFoundError" },
        },
      },
      patch: {
        tags: ["Tasks"],
        summary: "Update task fields or progress status workflow",
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string", nullable: true },
                  status: { $ref: "#/components/schemas/TaskStatus" },
                  assigneeId: { type: "string", format: "uuid", nullable: true },
                },
              },
            },
          },
        },
        responses: {
          "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Task" } } } },
          "422": { description: "Invalid state transition (e.g. done to todo without in_progress)" },
        },
      },
      delete: {
        tags: ["Tasks"],
        summary: "Delete a task",
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "204": { description: "Task deleted" },
        },
      },
    },
    "/api-keys": {
      get: {
        tags: ["API Keys"],
        summary: "List organization API keys (admin/owner only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 25 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/ApiKey" } },
                    meta: { $ref: "#/components/schemas/CursorPaginationMeta" },
                  },
                },
              },
            },
          },
          "403": { $ref: "#/components/responses/ForbiddenError" },
        },
      },
      post: {
        tags: ["API Keys"],
        summary: "Generate a new API key with defined scope",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateApiKeyRequest" } } },
        },
        responses: {
          "201": {
            description: "API key generated; plaintext key returned once",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateApiKeyResponse" },
              },
            },
          },
        },
      },
    },
    "/api-keys/{id}": {
      delete: {
        tags: ["API Keys"],
        summary: "Revoke an API key",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "204": { description: "API key revoked" },
          "404": { $ref: "#/components/responses/NotFoundError" },
        },
      },
    },
    "/webhooks": {
      get: {
        tags: ["Webhooks"],
        summary: "List registered webhook endpoints",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 25 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/Webhook" } },
                    meta: { $ref: "#/components/schemas/CursorPaginationMeta" },
                  },
                },
              },
            },
          },
          "403": { $ref: "#/components/responses/ForbiddenError" },
        },
      },
      post: {
        tags: ["Webhooks"],
        summary: "Register an SSRF-validated webhook endpoint",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateWebhookRequest" } } },
        },
        responses: {
          "201": {
            description: "Webhook registered; secret returned once",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateWebhookResponse" },
              },
            },
          },
          "400": { description: "Invalid URL or disallowed SSRF destination" },
        },
      },
    },
    "/webhooks/{id}": {
      get: {
        tags: ["Webhooks"],
        summary: "Get webhook details",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Webhook" } } } },
          "404": { $ref: "#/components/responses/NotFoundError" },
        },
      },
      patch: {
        tags: ["Webhooks"],
        summary: "Update webhook URL, events, or active status",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: { type: "string", format: "uri" },
                  events: { type: "array", items: { type: "string" } },
                  active: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Webhook" } } } },
        },
      },
      delete: {
        tags: ["Webhooks"],
        summary: "Delete webhook registration and deliveries",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "204": { description: "Webhook deleted" },
        },
      },
    },
    "/webhooks/{id}/deliveries": {
      get: {
        tags: ["Webhooks"],
        summary: "Query webhook delivery log history",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 25 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/WebhookDelivery" } },
                    meta: { $ref: "#/components/schemas/CursorPaginationMeta" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/audit-log": {
      get: {
        tags: ["Audit Log"],
        summary: "Inspect tenant audit log trail",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "action", in: "query", schema: { type: "string" } },
          { name: "actorId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 25 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/AuditLog" } },
                    meta: { $ref: "#/components/schemas/CursorPaginationMeta" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
