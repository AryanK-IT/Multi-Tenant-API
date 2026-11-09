import { describe, it, expect } from "vitest";
import { openApiSpec } from "../../src/docs/openapi";

describe("OpenAPI Specification (SRS §4.1, §4.2, Phase 9)", () => {
  it("conforms to OpenAPI 3.1.0 standard with title and version", () => {
    expect(openApiSpec.openapi).toBe("3.1.0");
    expect(openApiSpec.info.title).toContain("TaskFlow");
    expect(openApiSpec.info.version).toBe("1.0.0");
  });

  it("declares standard server base paths", () => {
    expect(openApiSpec.servers).toHaveLength(2);
    expect(openApiSpec.servers[0].url).toBe("/api/v1");
  });

  it("configures security schemes for Bearer JWT and Scoped API Keys", () => {
    const { securitySchemes } = openApiSpec.components;
    expect(securitySchemes).toBeDefined();
    expect(securitySchemes.bearerAuth).toBeDefined();
    expect(securitySchemes.bearerAuth.type).toBe("http");
    expect(securitySchemes.bearerAuth.scheme).toBe("bearer");
    expect(securitySchemes.bearerAuth.bearerFormat).toBe("JWT");

    expect(securitySchemes.apiKeyAuth).toBeDefined();
    expect(securitySchemes.apiKeyAuth.type).toBe("http");
    expect(securitySchemes.apiKeyAuth.scheme).toBe("bearer");
  });

  it("defines standard error envelope matching SRS §4.1", () => {
    const { ErrorEnvelope } = openApiSpec.components.schemas;
    expect(ErrorEnvelope).toBeDefined();
    expect(ErrorEnvelope.properties.error.required).toEqual(
      expect.arrayContaining(["code", "message", "details", "requestId"])
    );
  });

  it("covers all 10 core endpoint groups defined in SRS §4.2", () => {
    const paths = Object.keys(openApiSpec.paths);

    // 1. Ops
    expect(paths).toContain("/health");
    expect(paths).toContain("/ready");

    // 2. Auth
    expect(paths).toContain("/auth/signup");
    expect(paths).toContain("/auth/login");
    expect(paths).toContain("/auth/refresh");
    expect(paths).toContain("/auth/logout");
    expect(paths).toContain("/auth/me");

    // 3. Orgs & Members
    expect(paths).toContain("/orgs/me");
    expect(paths).toContain("/orgs/transfer-ownership");
    expect(paths).toContain("/orgs/members");
    expect(paths).toContain("/orgs/members/{userId}");

    // 4. Invitations
    expect(paths).toContain("/orgs/invitations");

    // 5. Projects
    expect(paths).toContain("/projects");
    expect(paths).toContain("/projects/{id}");

    // 6. Tasks
    expect(paths).toContain("/projects/{id}/tasks");
    expect(paths).toContain("/tasks/{id}");

    // 7. API Keys
    expect(paths).toContain("/api-keys");
    expect(paths).toContain("/api-keys/{id}");

    // 8. Webhooks
    expect(paths).toContain("/webhooks");
    expect(paths).toContain("/webhooks/{id}");
    expect(paths).toContain("/webhooks/{id}/deliveries");

    // 9. Audit Log
    expect(paths).toContain("/audit-log");
  });

  it("defines rate limiting error response with X-RateLimit headers (SRS §3.6, §4.1)", () => {
    const { RateLimitedError } = openApiSpec.components.responses;
    expect(RateLimitedError).toBeDefined();
    expect(RateLimitedError.headers).toBeDefined();
    expect(RateLimitedError.headers["Retry-After"]).toBeDefined();
    expect(RateLimitedError.headers["X-RateLimit-Limit"]).toBeDefined();
    expect(RateLimitedError.headers["X-RateLimit-Remaining"]).toBeDefined();
    expect(RateLimitedError.headers["X-RateLimit-Reset"]).toBeDefined();
  });
});
