import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { projectsService } from "../../src/projects/projects.service";
import { createTwoOrgFixture } from "../helpers/two-org-fixture";
import { ConflictError, NotFoundError } from "../../src/common/errors";

vi.mock("../../src/projects/projects.service");

describe("Projects HTTP Endpoints Integration (Phase 4 - FR-8, 9, 10, 11)", () => {
  const app = createApp();
  const { orgA } = createTwoOrgFixture();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication & RBAC guards", () => {
    it("returns 401 when Authorization header is missing", async () => {
      const res = await request(app).get("/api/v1/projects");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 403 when Member attempts to delete a project (SRS §3.8 FR-11)", async () => {
      const res = await request(app)
        .delete("/api/v1/projects/proj-123")
        .set("Authorization", `Bearer ${orgA.member.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
      expect(projectsService.deleteProject).not.toHaveBeenCalled();
    });

    it("allows Owner or Admin to delete a project (SRS §3.8 FR-11)", async () => {
      vi.mocked(projectsService.deleteProject).mockResolvedValueOnce({
        message: "Project deleted successfully.",
      });

      const res = await request(app)
        .delete("/api/v1/projects/proj-123")
        .set("Authorization", `Bearer ${orgA.admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Project deleted successfully.");
      expect(projectsService.deleteProject).toHaveBeenCalledWith(
        orgA.id,
        "proj-123",
        orgA.admin.id,
        expect.any(String)
      );
    });
  });

  describe("POST /api/v1/projects (FR-8)", () => {
    it("creates a new project and returns 201 for Member", async () => {
      const newProject = {
        id: "proj-abc",
        orgId: orgA.id,
        name: "Website Redesign",
        description: "New marketing site",
        createdById: orgA.member.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(projectsService.createProject).mockResolvedValueOnce(newProject as never);

      const res = await request(app)
        .post("/api/v1/projects")
        .set("Authorization", `Bearer ${orgA.member.token}`)
        .send({
          name: "Website Redesign",
          description: "New marketing site",
        });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Website Redesign");
      expect(projectsService.createProject).toHaveBeenCalledWith(
        orgA.id,
        orgA.member.id,
        expect.objectContaining({ name: "Website Redesign" })
      );
    });

    it("returns 400 when project name is missing or empty", async () => {
      const res = await request(app)
        .post("/api/v1/projects")
        .set("Authorization", `Bearer ${orgA.owner.token}`)
        .send({ name: "   " });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(projectsService.createProject).not.toHaveBeenCalled();
    });

    it("returns 409 Conflict when project name already exists in org (FR-8)", async () => {
      vi.mocked(projectsService.createProject).mockRejectedValueOnce(
        new ConflictError("A project with this name already exists in this organization.")
      );

      const res = await request(app)
        .post("/api/v1/projects")
        .set("Authorization", `Bearer ${orgA.owner.token}`)
        .send({ name: "Duplicate Name" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
    });
  });

  describe("GET /api/v1/projects (FR-9)", () => {
    it("returns 200 with paginated projects list", async () => {
      vi.mocked(projectsService.listProjects).mockResolvedValueOnce({
        data: [
          {
            id: "proj-1",
            orgId: orgA.id,
            name: "Project One",
            description: null,
            createdById: orgA.owner.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        nextCursor: null,
      });

      const res = await request(app)
        .get("/api/v1/projects?limit=10")
        .set("Authorization", `Bearer ${orgA.member.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.nextCursor).toBeNull();
      expect(projectsService.listProjects).toHaveBeenCalledWith(
        orgA.id,
        expect.objectContaining({ limit: "10" })
      );
    });
  });

  describe("GET /api/v1/projects/:id (FR-9, ADR 2)", () => {
    it("returns 200 with project details", async () => {
      vi.mocked(projectsService.getProject).mockResolvedValueOnce({
        id: "proj-1",
        orgId: orgA.id,
        name: "Project One",
        description: "Details",
        createdById: orgA.owner.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .get("/api/v1/projects/proj-1")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe("proj-1");
    });

    it("returns 404 when project does not exist or belongs to another org (ADR 2)", async () => {
      vi.mocked(projectsService.getProject).mockRejectedValueOnce(
        new NotFoundError("Project not found.")
      );

      const res = await request(app)
        .get("/api/v1/projects/unknown-proj")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("PATCH /api/v1/projects/:id (FR-10)", () => {
    it("updates project details and returns 200", async () => {
      vi.mocked(projectsService.updateProject).mockResolvedValueOnce({
        id: "proj-1",
        orgId: orgA.id,
        name: "Updated Project",
        description: "New description",
        createdById: orgA.owner.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .patch("/api/v1/projects/proj-1")
        .set("Authorization", `Bearer ${orgA.member.token}`)
        .send({ name: "Updated Project", description: "New description" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated Project");
    });
  });
});
