import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { createTwoOrgFixture } from "../helpers/two-org-fixture";
import { apiKeysService } from "../../src/api-keys/api-keys.service";
import { projectsService } from "../../src/projects/projects.service";
import { tasksService } from "../../src/tasks/tasks.service";
import { UnauthenticatedError } from "../../src/common/errors";

vi.mock("../../src/api-keys/api-keys.service");
vi.mock("../../src/projects/projects.service");
vi.mock("../../src/tasks/tasks.service");

describe("API Key Authentication & Permission Matrix (SRS §3.4 FR-17, §3.8, ADR 4, Phase 6)", () => {
  const app = createApp();
  const { orgA } = createTwoOrgFixture();

  const readKey = "tf_0123456789abcdef_111111111111111111111111111111111111111111111111";
  const readWriteKey = "tf_fedcba9876543210_222222222222222222222222222222222222222222222222";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("API Key with 'read' scope", () => {
    beforeEach(() => {
      vi.mocked(apiKeysService.verifyAndAuthenticateKey).mockResolvedValue({
        apiKeyId: "key-read-id",
        orgId: orgA.id,
        scope: "read",
        createdById: orgA.owner.id,
        name: "Read-Only Key",
        prefix: "0123456789abcdef",
      });
    });

    it("allows viewing projects (GET /api/v1/projects)", async () => {
      vi.mocked(projectsService.listProjects).mockResolvedValueOnce({
        data: [],
        nextCursor: null,
      });

      const res = await request(app)
        .get("/api/v1/projects")
        .set("Authorization", `Bearer ${readKey}`);

      expect(res.status).toBe(200);
      expect(projectsService.listProjects).toHaveBeenCalledWith(orgA.id, expect.any(Object));
    });

    it("allows viewing tasks (GET /api/v1/projects/:projectId/tasks)", async () => {
      vi.mocked(tasksService.listTasks).mockResolvedValueOnce({
        data: [],
        nextCursor: null,
      });

      const res = await request(app)
        .get("/api/v1/projects/proj-1/tasks")
        .set("Authorization", `Bearer ${readKey}`);

      expect(res.status).toBe(200);
      expect(tasksService.listTasks).toHaveBeenCalledWith(orgA.id, "proj-1", expect.any(Object));
    });

    it("denies creating projects (POST /api/v1/projects) with 403 FORBIDDEN", async () => {
      const res = await request(app)
        .post("/api/v1/projects")
        .set("Authorization", `Bearer ${readKey}`)
        .send({ name: "New Project" });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
      expect(projectsService.createProject).not.toHaveBeenCalled();
    });

    it("denies creating tasks (POST /api/v1/projects/:projectId/tasks) with 403 FORBIDDEN", async () => {
      const res = await request(app)
        .post("/api/v1/projects/proj-1/tasks")
        .set("Authorization", `Bearer ${readKey}`)
        .send({ title: "New Task" });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
      expect(tasksService.createTask).not.toHaveBeenCalled();
    });

    it("denies deleting projects with 403 FORBIDDEN", async () => {
      const res = await request(app)
        .delete("/api/v1/projects/proj-1")
        .set("Authorization", `Bearer ${readKey}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("denies deleting tasks with 403 FORBIDDEN", async () => {
      const res = await request(app)
        .delete("/api/v1/tasks/task-1")
        .set("Authorization", `Bearer ${readKey}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("strictly denies administrative endpoints (members, invitations, api-keys, audit-log)", async () => {
      const resMembers = await request(app)
        .get("/api/v1/orgs/members")
        .set("Authorization", `Bearer ${readKey}`);
      expect(resMembers.status).toBe(403);

      const resAudit = await request(app)
        .get("/api/v1/audit-log")
        .set("Authorization", `Bearer ${readKey}`);
      expect(resAudit.status).toBe(403);

      const resApiKeys = await request(app)
        .get("/api/v1/api-keys")
        .set("Authorization", `Bearer ${readKey}`);
      expect(resApiKeys.status).toBe(403);

      const resTransfer = await request(app)
        .post("/api/v1/orgs/transfer-ownership")
        .set("Authorization", `Bearer ${readKey}`)
        .send({ newOwnerUserId: "usr-2" });
      expect(resTransfer.status).toBe(403);
    });
  });

  describe("API Key with 'read_write' scope", () => {
    beforeEach(() => {
      vi.mocked(apiKeysService.verifyAndAuthenticateKey).mockResolvedValue({
        apiKeyId: "key-rw-id",
        orgId: orgA.id,
        scope: "read_write",
        createdById: orgA.owner.id,
        name: "Read-Write Key",
        prefix: "fedcba9876543210",
      });
    });

    it("allows creating a project (POST /api/v1/projects)", async () => {
      vi.mocked(projectsService.createProject).mockResolvedValueOnce({
        id: "proj-from-key",
        orgId: orgA.id,
        name: "Project via Key",
        description: null,
        createdById: orgA.owner.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post("/api/v1/projects")
        .set("Authorization", `Bearer ${readWriteKey}`)
        .send({ name: "Project via Key" });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe("proj-from-key");
      expect(projectsService.createProject).toHaveBeenCalledWith(
        orgA.id,
        orgA.owner.id,
        expect.objectContaining({ name: "Project via Key" })
      );
    });

    it("allows updating a project (PATCH /api/v1/projects/:id)", async () => {
      vi.mocked(projectsService.updateProject).mockResolvedValueOnce({
        id: "proj-1",
        orgId: orgA.id,
        name: "Updated Name",
        description: "Updated Desc",
        createdById: orgA.owner.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .patch("/api/v1/projects/proj-1")
        .set("Authorization", `Bearer ${readWriteKey}`)
        .send({ name: "Updated Name" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated Name");
    });

    it("allows creating a task (POST /api/v1/projects/:projectId/tasks)", async () => {
      vi.mocked(tasksService.createTask).mockResolvedValueOnce({
        id: "task-from-key",
        projectId: "proj-1",
        orgId: orgA.id,
        title: "Task via Key",
        description: null,
        status: "todo",
        assigneeId: null,
        createdById: orgA.owner.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post("/api/v1/projects/proj-1/tasks")
        .set("Authorization", `Bearer ${readWriteKey}`)
        .send({ title: "Task via Key" });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe("task-from-key");
    });

    it("denies deleting a project even with read_write scope (ADR 4, SRS §3.8)", async () => {
      const res = await request(app)
        .delete("/api/v1/projects/proj-1")
        .set("Authorization", `Bearer ${readWriteKey}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
      expect(projectsService.deleteProject).not.toHaveBeenCalled();
    });

    it("denies deleting a task even with read_write scope (ADR 4, SRS §3.8)", async () => {
      const res = await request(app)
        .delete("/api/v1/tasks/task-1")
        .set("Authorization", `Bearer ${readWriteKey}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
      expect(tasksService.deleteTask).not.toHaveBeenCalled();
    });

    it("strictly denies administrative endpoints even with read_write scope", async () => {
      const resMembers = await request(app)
        .get("/api/v1/orgs/members")
        .set("Authorization", `Bearer ${readWriteKey}`);
      expect(resMembers.status).toBe(403);

      const resAudit = await request(app)
        .get("/api/v1/audit-log")
        .set("Authorization", `Bearer ${readWriteKey}`);
      expect(resAudit.status).toBe(403);

      const resApiKeys = await request(app)
        .get("/api/v1/api-keys")
        .set("Authorization", `Bearer ${readWriteKey}`);
      expect(resApiKeys.status).toBe(403);
    });
  });

  describe("API Key Authentication Failures", () => {
    it("returns 401 UNAUTHENTICATED when key format is invalid", async () => {
      vi.mocked(apiKeysService.verifyAndAuthenticateKey).mockRejectedValueOnce(
        new UnauthenticatedError("Invalid API key format.")
      );

      const res = await request(app)
        .get("/api/v1/projects")
        .set("Authorization", "Bearer tf_invalid_key");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 401 UNAUTHENTICATED when key is revoked", async () => {
      vi.mocked(apiKeysService.verifyAndAuthenticateKey).mockRejectedValueOnce(
        new UnauthenticatedError("API key has been revoked.")
      );

      const res = await request(app)
        .get("/api/v1/projects")
        .set("Authorization", `Bearer ${readKey}`);

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe("API key has been revoked.");
    });

    it("returns 401 UNAUTHENTICATED when key is expired", async () => {
      vi.mocked(apiKeysService.verifyAndAuthenticateKey).mockRejectedValueOnce(
        new UnauthenticatedError("API key has expired.")
      );

      const res = await request(app)
        .get("/api/v1/projects")
        .set("Authorization", `Bearer ${readKey}`);

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe("API key has expired.");
    });
  });
});
