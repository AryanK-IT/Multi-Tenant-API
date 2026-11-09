import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { createTwoOrgFixture } from "../helpers/two-org-fixture";
import { createTenantClient, TENANT_SCOPED_MODELS } from "../../src/db/tenant-extension";
import { prisma } from "../../src/db/client";
import { orgsService } from "../../src/orgs/orgs.service";
import { projectsService } from "../../src/projects/projects.service";
import { tasksService } from "../../src/tasks/tasks.service";
import { auditService } from "../../src/audit/audit.service";
import { apiKeysService } from "../../src/api-keys/api-keys.service";
import { NotFoundError } from "../../src/common/errors";

vi.mock("../../src/orgs/orgs.service");
vi.mock("../../src/projects/projects.service");
vi.mock("../../src/tasks/tasks.service");
vi.mock("../../src/audit/audit.service");
vi.mock("../../src/api-keys/api-keys.service");

describe("Comprehensive Cross-Tenant Isolation Test Suite (SRS §5.1, ADR 1, ADR 2, Phase 5)", () => {
  const app = createApp();
  const { orgA, orgB } = createTwoOrgFixture();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication and Session Isolation", () => {
    it("guarantees Org A user token never maps to Org B tenant context", async () => {
      const resA = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(resA.status).toBe(200);
      expect(resA.body.tenant.orgId).toBe(orgA.id);
      expect(resA.body.tenant.orgId).not.toBe(orgB.id);
    });

    it("guarantees Org B user token never maps to Org A tenant context", async () => {
      const resB = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${orgB.admin.token}`);

      expect(resB.status).toBe(200);
      expect(resB.body.tenant.orgId).toBe(orgB.id);
      expect(resB.body.tenant.orgId).not.toBe(orgA.id);
    });
  });

  describe("Prisma Tenant Client Extension Isolation", () => {
    it("binds distinct org IDs to distinct client extensions", () => {
      const clientA = createTenantClient(orgA.id, prisma);
      const clientB = createTenantClient(orgB.id, prisma);

      expect(clientA.$tenantOrgId).toBe(orgA.id);
      expect(clientB.$tenantOrgId).toBe(orgB.id);
      expect(clientA.$tenantOrgId).not.toBe(clientB.$tenantOrgId);
    });

    it("includes all core models in TENANT_SCOPED_MODELS including auditLog", () => {
      expect(TENANT_SCOPED_MODELS).toContain("refreshToken");
      expect(TENANT_SCOPED_MODELS).toContain("invitation");
      expect(TENANT_SCOPED_MODELS).toContain("project");
      expect(TENANT_SCOPED_MODELS).toContain("task");
      expect(TENANT_SCOPED_MODELS).toContain("apiKey");
      expect(TENANT_SCOPED_MODELS).toContain("webhook");
      expect(TENANT_SCOPED_MODELS).toContain("webhookDelivery");
      expect(TENANT_SCOPED_MODELS).toContain("auditLog");
    });
  });

  describe("Org and Membership Cross-Tenant Boundaries (ADR 2, FR-6)", () => {
    it("GET /api/v1/orgs/me correctly scopes tenant to token org", async () => {
      vi.mocked(orgsService.getOrg).mockImplementationOnce(async (orgId) => ({
        id: orgId,
        name: orgId === orgA.id ? orgA.name : orgB.name,
        createdAt: new Date(),
      }));

      const resA = await request(app)
        .get("/api/v1/orgs/me")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(resA.status).toBe(200);
      expect(resA.body.id).toBe(orgA.id);
      expect(resA.body.id).not.toBe(orgB.id);
    });

    it("returns 404 when Org B attempts to update role of Org A's member (ADR 2)", async () => {
      vi.mocked(orgsService.updateMemberRole).mockRejectedValueOnce(
        new NotFoundError("Member not found in this organization.")
      );

      const res = await request(app)
        .patch(`/api/v1/orgs/members/${orgA.member.id}`)
        .set("Authorization", `Bearer ${orgB.owner.token}`)
        .send({ role: "admin" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 when Org B attempts to remove Org A's member (ADR 2)", async () => {
      vi.mocked(orgsService.removeMember).mockRejectedValueOnce(
        new NotFoundError("Member not found in this organization.")
      );

      const res = await request(app)
        .delete(`/api/v1/orgs/members/${orgA.member.id}`)
        .set("Authorization", `Bearer ${orgB.owner.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 when Org B attempts to revoke Org A's invitation (ADR 2)", async () => {
      vi.mocked(orgsService.revokeInvitation).mockRejectedValueOnce(
        new NotFoundError("Invitation not found.")
      );

      const res = await request(app)
        .delete("/api/v1/orgs/invitations/inv-org-a")
        .set("Authorization", `Bearer ${orgB.admin.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("Project Cross-Tenant Boundaries (ADR 2, FR-9, FR-10, FR-11)", () => {
    it("returns 404 when Org B attempts to read Org A's project (ADR 2, FR-9)", async () => {
      vi.mocked(projectsService.getProject).mockRejectedValueOnce(
        new NotFoundError("Project not found.")
      );

      const resB = await request(app)
        .get("/api/v1/projects/proj-alpha")
        .set("Authorization", `Bearer ${orgB.owner.token}`);

      expect(resB.status).toBe(404);
      expect(resB.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 when Org B attempts to update Org A's project (ADR 2, FR-10)", async () => {
      vi.mocked(projectsService.updateProject).mockRejectedValueOnce(
        new NotFoundError("Project not found.")
      );

      const resB = await request(app)
        .patch("/api/v1/projects/proj-alpha")
        .set("Authorization", `Bearer ${orgB.owner.token}`)
        .send({ name: "Renamed by Org B" });

      expect(resB.status).toBe(404);
      expect(resB.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 when Org B attempts to delete Org A's project (ADR 2, FR-11)", async () => {
      vi.mocked(projectsService.deleteProject).mockRejectedValueOnce(
        new NotFoundError("Project not found.")
      );

      const resB = await request(app)
        .delete("/api/v1/projects/proj-alpha")
        .set("Authorization", `Bearer ${orgB.owner.token}`);

      expect(resB.status).toBe(404);
      expect(resB.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("Task Cross-Tenant Boundaries (ADR 2, FR-12, FR-13, FR-14)", () => {
    it("returns 404 when Org B attempts to read Org A's task (ADR 2, FR-12)", async () => {
      vi.mocked(tasksService.getTask).mockRejectedValueOnce(new NotFoundError("Task not found."));

      const resB = await request(app)
        .get("/api/v1/tasks/task-alpha")
        .set("Authorization", `Bearer ${orgB.admin.token}`);

      expect(resB.status).toBe(404);
      expect(resB.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 when Org B attempts to create a task in Org A's project (ADR 2, FR-12)", async () => {
      vi.mocked(tasksService.createTask).mockRejectedValueOnce(
        new NotFoundError("Project not found.")
      );

      const resB = await request(app)
        .post("/api/v1/projects/proj-alpha/tasks")
        .set("Authorization", `Bearer ${orgB.member.token}`)
        .send({ title: "Cross-Tenant Task" });

      expect(resB.status).toBe(404);
      expect(resB.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 when Org B attempts to update Org A's task (ADR 2, FR-12)", async () => {
      vi.mocked(tasksService.updateTask).mockRejectedValueOnce(
        new NotFoundError("Task not found.")
      );

      const resB = await request(app)
        .patch("/api/v1/tasks/task-alpha")
        .set("Authorization", `Bearer ${orgB.member.token}`)
        .send({ title: "Updated by Org B" });

      expect(resB.status).toBe(404);
      expect(resB.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 when Org B attempts to delete Org A's task (ADR 2, FR-12)", async () => {
      vi.mocked(tasksService.deleteTask).mockRejectedValueOnce(
        new NotFoundError("Task not found.")
      );

      const resB = await request(app)
        .delete("/api/v1/tasks/task-alpha")
        .set("Authorization", `Bearer ${orgB.owner.token}`);

      expect(resB.status).toBe(404);
      expect(resB.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("Audit Log Cross-Tenant Boundaries (ADR 2, SRS §3.7, FR-24)", () => {
    it("ensures Org B querying audit-log never sees Org A's audit entries", async () => {
      vi.mocked(auditService.listAuditLogs).mockImplementation(async (targetOrgId) => {
        if (targetOrgId === orgB.id) {
          return {
            data: [
              {
                id: "audit-b-1",
                orgId: orgB.id,
                actorType: "user",
                actorId: orgB.owner.id,
                action: "project.deleted",
                targetType: "project",
                targetId: "proj-b-1",
                metadata: null,
                ip: "127.0.0.1",
                createdAt: new Date(),
              },
            ],
            nextCursor: null,
          };
        }
        throw new Error("Cross-tenant leakage: Org B accessed Org A audit logs");
      });

      const resB = await request(app)
        .get("/api/v1/audit-log")
        .set("Authorization", `Bearer ${orgB.owner.token}`);

      expect(resB.status).toBe(200);
      expect(resB.body.data).toHaveLength(1);
      expect(resB.body.data[0].orgId).toBe(orgB.id);
      expect(resB.body.data[0].orgId).not.toBe(orgA.id);
      expect(auditService.listAuditLogs).toHaveBeenCalledWith(orgB.id, expect.any(Object));
      expect(auditService.listAuditLogs).not.toHaveBeenCalledWith(orgA.id, expect.any(Object));
    });
  });

  describe("API Keys Cross-Tenant Boundaries (ADR 2, SRS §3.4, FR-16, FR-17, Phase 6)", () => {
    it("returns 404 NOT_FOUND when Org B attempts to revoke Org A's API key (ADR 2)", async () => {
      vi.mocked(apiKeysService.revokeApiKey).mockRejectedValueOnce(
        new NotFoundError("API key not found.")
      );

      const res = await request(app)
        .delete("/api/v1/api-keys/key-org-a-1")
        .set("Authorization", `Bearer ${orgB.owner.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
      expect(apiKeysService.revokeApiKey).toHaveBeenCalledWith(
        orgB.id,
        "key-org-a-1",
        orgB.owner.id,
        expect.any(String)
      );
    });

    it("ensures Org B listing API keys never queries or receives Org A's keys", async () => {
      vi.mocked(apiKeysService.listApiKeys).mockImplementation(async (targetOrgId) => {
        if (targetOrgId === orgB.id) {
          return {
            data: [
              {
                id: "key-b-1",
                name: "Beta Key",
                prefix: "beta123456789012",
                scope: "read",
                createdById: orgB.owner.id,
                expiresAt: null,
                revokedAt: null,
                lastUsedAt: null,
                createdAt: new Date(),
              },
            ],
            nextCursor: null,
          };
        }
        throw new Error("Cross-tenant leakage: Org B accessed Org A API keys");
      });

      const res = await request(app)
        .get("/api/v1/api-keys")
        .set("Authorization", `Bearer ${orgB.admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].prefix).toBe("beta123456789012");
      expect(apiKeysService.listApiKeys).toHaveBeenCalledWith(orgB.id, expect.any(Object));
      expect(apiKeysService.listApiKeys).not.toHaveBeenCalledWith(orgA.id, expect.any(Object));
    });

    it("returns 404 NOT_FOUND when Org A API key queries Org B project (ADR 2)", async () => {
      vi.mocked(apiKeysService.verifyAndAuthenticateKey).mockResolvedValueOnce({
        apiKeyId: "key-org-a-read",
        orgId: orgA.id,
        scope: "read",
        createdById: orgA.owner.id,
        name: "Alpha Key",
        prefix: "alpha12345678901",
      });

      vi.mocked(projectsService.getProject).mockRejectedValueOnce(
        new NotFoundError("Project not found.")
      );

      const res = await request(app)
        .get("/api/v1/projects/proj-beta-1")
        .set(
          "Authorization",
          "Bearer tf_alpha12345678901_00112233445566778899aabbccddeeff0011223344556677"
        );

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
      expect(projectsService.getProject).toHaveBeenCalledWith(orgA.id, "proj-beta-1");
    });
  });
});
