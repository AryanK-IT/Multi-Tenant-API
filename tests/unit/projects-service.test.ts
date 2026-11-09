import { describe, it, expect, vi, beforeEach } from "vitest";
import { projectsService } from "../../src/projects/projects.service";
import { prisma } from "../../src/db/client";
import { NotFoundError, ConflictError } from "../../src/common/errors";

vi.mock("../../src/db/client", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

describe("ProjectsService Unit Tests (Phase 4 - FR-8, 9, 10, 11)", () => {
  const orgId = "org-alpha-123";
  const userId = "usr-alpha-owner";
  const projectId = "proj-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createProject (FR-8)", () => {
    it("creates a new project successfully", async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(null);
      const createdProject = {
        id: projectId,
        orgId,
        name: "Backend Revamp",
        description: "Rewrite backend to Express + Prisma",
        createdById: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(prisma.project.create).mockResolvedValueOnce(createdProject as never);

      const result = await projectsService.createProject(orgId, userId, {
        name: "Backend Revamp",
        description: "Rewrite backend to Express + Prisma",
      });

      expect(result).toEqual(createdProject);
      expect(prisma.project.findUnique).toHaveBeenCalledWith({
        where: { orgId_name: { orgId, name: "Backend Revamp" } },
      });
      expect(prisma.project.create).toHaveBeenCalledWith({
        data: {
          orgId,
          name: "Backend Revamp",
          description: "Rewrite backend to Express + Prisma",
          createdById: userId,
        },
      });
    });

    it("throws ConflictError when project name already exists in org", async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({
        id: "existing-proj",
        orgId,
        name: "Duplicate Name",
      } as never);

      await expect(
        projectsService.createProject(orgId, userId, { name: "Duplicate Name" })
      ).rejects.toThrow(ConflictError);
      expect(prisma.project.create).not.toHaveBeenCalled();
    });
  });

  describe("listProjects (FR-9, ADR 6)", () => {
    it("returns paginated list of projects with nextCursor when exceeding limit", async () => {
      const now = new Date();
      const mockProjects = [
        { id: "proj-1", orgId, name: "P1", createdAt: new Date(now.getTime() - 1000) },
        { id: "proj-2", orgId, name: "P2", createdAt: new Date(now.getTime() - 2000) },
        { id: "proj-3", orgId, name: "P3", createdAt: new Date(now.getTime() - 3000) },
      ];
      vi.mocked(prisma.project.findMany).mockResolvedValueOnce(mockProjects as never);

      const result = await projectsService.listProjects(orgId, { limit: 2 });

      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe("proj-1");
      expect(result.data[1].id).toBe("proj-2");
      expect(result.nextCursor).not.toBeNull();
    });
  });

  describe("getProject (FR-9, ADR 2)", () => {
    it("returns project when found within tenant org", async () => {
      const project = { id: projectId, orgId, name: "Alpha Project" };
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(project as never);

      const result = await projectsService.getProject(orgId, projectId);
      expect(result).toEqual(project);
      expect(prisma.project.findFirst).toHaveBeenCalledWith({
        where: { id: projectId, orgId },
      });
    });

    it("throws NotFoundError when project does not exist or belongs to another org", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(null);

      await expect(projectsService.getProject(orgId, "non-existent")).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe("updateProject (FR-10)", () => {
    it("updates project name and description successfully", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce({
        id: projectId,
        orgId,
        name: "Old Name",
        description: "Old Desc",
      } as never);
      vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.project.update).mockResolvedValueOnce({
        id: projectId,
        orgId,
        name: "New Name",
        description: "New Desc",
      } as never);

      const result = await projectsService.updateProject(orgId, projectId, {
        name: "New Name",
        description: "New Desc",
      });

      expect(result.name).toBe("New Name");
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: projectId },
        data: { name: "New Name", description: "New Desc" },
      });
    });

    it("throws ConflictError if updated name collides with another project in org", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce({
        id: projectId,
        orgId,
        name: "Original Name",
      } as never);
      vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({
        id: "other-proj-id",
        orgId,
        name: "Collision Name",
      } as never);

      await expect(
        projectsService.updateProject(orgId, projectId, { name: "Collision Name" })
      ).rejects.toThrow(ConflictError);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it("throws NotFoundError if project does not exist in org", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(null);

      await expect(
        projectsService.updateProject(orgId, "missing", { name: "Test" })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("deleteProject (FR-11, ADR 7)", () => {
    it("deletes project when found in org", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce({
        id: projectId,
        orgId,
        name: "Delete Me",
      } as never);
      vi.mocked(prisma.project.delete).mockResolvedValueOnce({} as never);

      const result = await projectsService.deleteProject(orgId, projectId);
      expect(result.message).toBe("Project deleted successfully.");
      expect(prisma.project.delete).toHaveBeenCalledWith({
        where: { id: projectId },
      });
    });

    it("throws NotFoundError when trying to delete non-existent or other org project", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(null);

      await expect(projectsService.deleteProject(orgId, "missing-id")).rejects.toThrow(
        NotFoundError
      );
      expect(prisma.project.delete).not.toHaveBeenCalled();
    });
  });
});
