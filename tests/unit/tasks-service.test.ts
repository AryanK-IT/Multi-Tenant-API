import { describe, it, expect, vi, beforeEach } from "vitest";
import { tasksService } from "../../src/tasks/tasks.service";
import { prisma } from "../../src/db/client";
import {
  NotFoundError,
  ValidationError,
  ForbiddenError,
  InvalidStatusTransitionError,
} from "../../src/common/errors";

vi.mock("../../src/db/client", () => ({
  prisma: {
    project: {
      findFirst: vi.fn(),
    },
    orgMembership: {
      findUnique: vi.fn(),
    },
    task: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

describe("TasksService Unit Tests (Phase 4 - FR-12, 13, 14)", () => {
  const orgId = "org-alpha-123";
  const userId = "usr-alpha-member-1";
  const projectId = "proj-alpha-1";
  const taskId = "task-alpha-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createTask (FR-12, FR-14)", () => {
    it("creates a task when project exists and assignee is in the same org", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce({
        id: projectId,
        orgId,
        name: "Project A",
      } as never);
      vi.mocked(prisma.orgMembership.findUnique).mockResolvedValueOnce({
        userId: "usr-assignee",
        orgId,
        role: "member",
      } as never);

      const createdTask = {
        id: taskId,
        projectId,
        orgId,
        title: "Implement feature",
        description: "Task desc",
        status: "todo",
        assigneeId: "usr-assignee",
        createdById: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(prisma.task.create).mockResolvedValueOnce(createdTask as never);

      const result = await tasksService.createTask(orgId, userId, projectId, {
        title: "Implement feature",
        description: "Task desc",
        assigneeId: "usr-assignee",
      });

      expect(result).toEqual(createdTask);
      expect(prisma.task.create).toHaveBeenCalledWith({
        data: {
          title: "Implement feature",
          description: "Task desc",
          status: "todo",
          assigneeId: "usr-assignee",
          projectId,
          orgId,
          createdById: userId,
        },
      });
    });

    it("throws NotFoundError if project does not exist in org", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(null);

      await expect(
        tasksService.createTask(orgId, userId, "missing-proj", { title: "Test" })
      ).rejects.toThrow(NotFoundError);
      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it("throws ValidationError if assignee is not a member of the org (FR-14)", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce({
        id: projectId,
        orgId,
      } as never);
      vi.mocked(prisma.orgMembership.findUnique).mockResolvedValueOnce(null);

      await expect(
        tasksService.createTask(orgId, userId, projectId, {
          title: "Task",
          assigneeId: "outsider-user-id",
        })
      ).rejects.toThrow(ValidationError);
      expect(prisma.task.create).not.toHaveBeenCalled();
    });
  });

  describe("listTasks (FR-12, filters & pagination)", () => {
    it("filters tasks by status and assigneeId", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce({
        id: projectId,
        orgId,
      } as never);

      const mockTasks = [
        {
          id: "task-1",
          projectId,
          orgId,
          title: "Task 1",
          status: "in_progress",
          assigneeId: "usr-1",
          createdAt: new Date(),
        },
      ];
      vi.mocked(prisma.task.findMany).mockResolvedValueOnce(mockTasks as never);

      const result = await tasksService.listTasks(orgId, projectId, {
        status: "in_progress",
        assigneeId: "usr-1",
        limit: 10,
      });

      expect(result.data).toHaveLength(1);
      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgId,
            projectId,
            status: "in_progress",
            assigneeId: "usr-1",
          }),
        })
      );
    });
  });

  describe("updateTask & Status Workflow (FR-13)", () => {
    it("allows valid status transition: todo -> in_progress", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValueOnce({
        id: taskId,
        orgId,
        status: "todo",
      } as never);
      vi.mocked(prisma.task.update).mockResolvedValueOnce({
        id: taskId,
        status: "in_progress",
      } as never);

      const result = await tasksService.updateTask(orgId, taskId, {
        status: "in_progress",
      });

      expect(result.status).toBe("in_progress");
    });

    it("allows valid status transition: in_progress -> done", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValueOnce({
        id: taskId,
        orgId,
        status: "in_progress",
      } as never);
      vi.mocked(prisma.task.update).mockResolvedValueOnce({
        id: taskId,
        status: "done",
      } as never);

      const result = await tasksService.updateTask(orgId, taskId, { status: "done" });
      expect(result.status).toBe("done");
    });

    it("allows valid status transition: in_progress -> todo", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValueOnce({
        id: taskId,
        orgId,
        status: "in_progress",
      } as never);
      vi.mocked(prisma.task.update).mockResolvedValueOnce({
        id: taskId,
        status: "todo",
      } as never);

      const result = await tasksService.updateTask(orgId, taskId, { status: "todo" });
      expect(result.status).toBe("todo");
    });

    it("allows valid status transition: done -> in_progress (reopen)", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValueOnce({
        id: taskId,
        orgId,
        status: "done",
      } as never);
      vi.mocked(prisma.task.update).mockResolvedValueOnce({
        id: taskId,
        status: "in_progress",
      } as never);

      const result = await tasksService.updateTask(orgId, taskId, {
        status: "in_progress",
      });
      expect(result.status).toBe("in_progress");
    });

    it("rejects invalid status transition: todo -> done with 422 InvalidStatusTransitionError", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValueOnce({
        id: taskId,
        orgId,
        status: "todo",
      } as never);

      await expect(tasksService.updateTask(orgId, taskId, { status: "done" })).rejects.toThrow(
        InvalidStatusTransitionError
      );
      expect(prisma.task.update).not.toHaveBeenCalled();
    });

    it("rejects invalid status transition: done -> todo with 422 InvalidStatusTransitionError", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValueOnce({
        id: taskId,
        orgId,
        status: "done",
      } as never);

      await expect(tasksService.updateTask(orgId, taskId, { status: "todo" })).rejects.toThrow(
        InvalidStatusTransitionError
      );
      expect(prisma.task.update).not.toHaveBeenCalled();
    });

    it("rejects assigning to non-member on update (FR-14)", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValueOnce({
        id: taskId,
        orgId,
        status: "todo",
      } as never);
      vi.mocked(prisma.orgMembership.findUnique).mockResolvedValueOnce(null);

      await expect(
        tasksService.updateTask(orgId, taskId, { assigneeId: "non-member-id" })
      ).rejects.toThrow(ValidationError);
      expect(prisma.task.update).not.toHaveBeenCalled();
    });
  });

  describe("deleteTask Permissions (FR-12, SRS §3.8)", () => {
    it("allows Owner to delete any task", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValueOnce({
        id: taskId,
        orgId,
        createdById: "someone-else",
      } as never);
      vi.mocked(prisma.task.delete).mockResolvedValueOnce({} as never);

      const result = await tasksService.deleteTask(
        orgId,
        { userId: "owner-id", role: "owner" },
        taskId
      );
      expect(result.message).toBe("Task deleted successfully.");
      expect(prisma.task.delete).toHaveBeenCalledWith({ where: { id: taskId } });
    });

    it("allows Admin to delete any task", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValueOnce({
        id: taskId,
        orgId,
        createdById: "someone-else",
      } as never);
      vi.mocked(prisma.task.delete).mockResolvedValueOnce({} as never);

      const result = await tasksService.deleteTask(
        orgId,
        { userId: "admin-id", role: "admin" },
        taskId
      );
      expect(result.message).toBe("Task deleted successfully.");
    });

    it("allows Member to delete a task they created", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValueOnce({
        id: taskId,
        orgId,
        createdById: "my-user-id",
      } as never);
      vi.mocked(prisma.task.delete).mockResolvedValueOnce({} as never);

      const result = await tasksService.deleteTask(
        orgId,
        { userId: "my-user-id", role: "member" },
        taskId
      );
      expect(result.message).toBe("Task deleted successfully.");
    });

    it("prevents Member from deleting a task created by someone else (403 Forbidden)", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValueOnce({
        id: taskId,
        orgId,
        createdById: "other-user-id",
      } as never);

      await expect(
        tasksService.deleteTask(orgId, { userId: "my-user-id", role: "member" }, taskId)
      ).rejects.toThrow(ForbiddenError);
      expect(prisma.task.delete).not.toHaveBeenCalled();
    });

    it("prevents API key from deleting tasks (403 Forbidden)", async () => {
      await expect(
        tasksService.deleteTask(
          orgId,
          { userId: "api-key", role: "member", isApiKey: true },
          taskId
        )
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
