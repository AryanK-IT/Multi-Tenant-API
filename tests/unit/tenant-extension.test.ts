import { describe, it, expect } from "vitest";
import {
  createTenantClient,
  getTenantDb,
  TENANT_SCOPED_MODELS,
} from "../../src/db/tenant-extension";
import { prisma } from "../../src/db/client";

describe("Tenant Scoping Prisma Extension", () => {
  it("includes all expected tenant-scoped models in definition", () => {
    expect(TENANT_SCOPED_MODELS).toContain("refreshToken");
    expect(TENANT_SCOPED_MODELS).toContain("project");
    expect(TENANT_SCOPED_MODELS).toContain("task");
    expect(TENANT_SCOPED_MODELS).toContain("apiKey");
    expect(TENANT_SCOPED_MODELS).toContain("webhook");
    expect(TENANT_SCOPED_MODELS).toContain("auditLog");
  });

  it("creates extended client instance with bound tenant orgId", () => {
    const orgId = "org-test-uuid";
    const client = createTenantClient(orgId, prisma);

    expect(client).toBeDefined();
    expect(client.$tenantOrgId).toBe(orgId);
  });

  it("getTenantDb returns an extended client with matching orgId", () => {
    const orgId = "org-second-uuid";
    const client = getTenantDb(orgId);

    expect(client).toBeDefined();
    expect(client.$tenantOrgId).toBe(orgId);
  });
});
