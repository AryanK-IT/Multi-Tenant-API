import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { tasksService } from "../../src/tasks/tasks.service";
import { createTwoOrgFixture } from "../helpers/two-org-fixture";
import {
  NotFoundError,
  ValidationError,
  ForbiddenError,
  InvalidStatusTransitionError,
} from "../../src/common/errors";

vi.mock("../../src/tasks/tasks.service");

describe("Tasks HTTP Endpoints Integration (Phase 4 - FR-12, 13, 14)", () => {
  const app = createApp();
  const { orgA } = createTwoOrgFixture();
  const projectId = "proj-alpha-1";
  const taskId = "task-alpha-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    it("returns 401 when Authorization header is missing", async () => {
      const res = await request(app).get(`/api/v1/projects/${projectId}/tasks`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("POST /api/v1/projects/:projectId/tasks (FR-12, FR-14)", () => {
    it("creates task and returns 201 for Member", async () => {
      const createdTask = {
        id: taskId,
        projectId,
        orgId: orgA.id,
        title: "Build endpoints",
        description: "Task desc",
        status: "todo",
        assigneeId: null,
        createdById: orgA.member.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(tasksService.createTask).mockResolvedValueOnce(createdTask as never);

      const res = await request(app)
        .post(`/api/v1/projects/${projectId}/tasks`)
        .set("Authorization", `Bearer ${orgA.member.token}`)
        .send({ title: "Build endpoints", description: "Task desc" });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe("Build endpoints");
      expect(tasksService.createTask).toHaveBeenCalledWith(
        orgA.id,
        orgA.member.id,
        projectId,
        expect.objectContaining({ title: "Build endpoints" })
      );
    });

    it("returns 400 when task title is missing", async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${projectId}/tasks`)
        .set("Authorization", `Bearer ${orgA.member.token}`)
        .send({ description: "No title provided" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(tasksService.createTask).not.toHaveBeenCalled();
    });

    it("returns 404 when project is not found", async () => {
      vi.mocked(tasksService.createTask).mockRejectedValueOnce(
        new NotFoundError("Project not found.")
      );

      const res = await request(app)
        .post("/api/v1/projects/non-existent-proj/tasks")
        .set("Authorization", `Bearer ${orgA.member.token}`)
        .send({ title: "Valid Title" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 400 when assignee is not an org member (FR-14)", async () => {
      vi.mocked(tasksService.createTask).mockRejectedValueOnce(
        new ValidationError("Assignee must be a member of the organization.")
      );

      const res = await request(app)
        .post(`/api/v1/projects/${projectId}/tasks`)
        .set("Authorization", `Bearer ${orgA.member.token}`)
        .send({
          title: "Task with outsider assignee",
          assigneeId: "00000000-0000-0000-0000-000000000099",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("GET /api/v1/projects/:projectId/tasks (FR-12, filters & pagination)", () => {
    it("returns 200 with tasks and filters by status", async () => {
      vi.mocked(tasksService.listTasks).mockResolvedValueOnce({
        data: [
          {
            id: taskId,
            projectId,
            orgId: orgA.id,
            title: "Task in progress",
            description: null,
            status: "in_progress",
            assigneeId: null,
            createdById: orgA.owner.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        nextCursor: null,
      });

      const res = await request(app)
        .get(`/api/v1/projects/${projectId}/tasks?status=in_progress`)
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(tasksService.listTasks).toHaveBeenCalledWith(
        orgA.id,
        projectId,
        expect.objectContaining({ status: "in_progress" })
      );
    });
  });

  describe("GET /api/v1/tasks/:id (FR-12)", () => {
    it("returns 200 with task details", async () => {
      vi.mocked(tasksService.getTask).mockResolvedValueOnce({
        id: taskId,
        projectId,
        orgId: orgA.id,
        title: "Individual Task",
        description: null,
        status: "todo",
        assigneeId: null,
        createdById: orgA.owner.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .get(`/api/v1/tasks/${taskId}`)
        .set("Authorization", `Bearer ${orgA.member.token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(taskId);
      expect(tasksService.getTask).toHaveBeenCalledWith(orgA.id, taskId);
    });

    it("returns 404 when task not found or belongs to another tenant", async () => {
      vi.mocked(tasksService.getTask).mockRejectedValueOnce(new NotFoundError("Task not found."));

      const res = await request(app)
        .get("/api/v1/tasks/unknown-task")
        .set("Authorization", `Bearer ${orgA.member.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("PATCH /api/v1/tasks/:id (FR-13 Status Workflow)", () => {
    it("updates task and returns 200 on valid status change", async () => {
      vi.mocked(tasksService.updateTask).mockResolvedValueOnce({
        id: taskId,
        projectId,
        orgId: orgA.id,
        title: "Task",
        description: null,
        status: "in_progress",
        assigneeId: null,
        createdById: orgA.owner.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .patch(`/api/v1/tasks/${taskId}`)
        .set("Authorization", `Bearer ${orgA.member.token}`)
        .send({ status: "in_progress" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("in_progress");
    });

    it("returns 422 INVALID_STATUS_TRANSITION on illegal transition (FR-13)", async () => {
      vi.mocked(tasksService.updateTask).mockRejectedValueOnce(
        new InvalidStatusTransitionError("Invalid status transition from 'todo' to 'done'.")
      );

      const res = await request(app)
        .patch(`/api/v1/tasks/${taskId}`)
        .set("Authorization", `Bearer ${orgA.member.token}`)
        .send({ status: "done" });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("INVALID_STATUS_TRANSITION");
    });
  });

  describe("DELETE /api/v1/tasks/:id (FR-12, SRS §3.8 RBAC)", () => {
    it("returns 200 when Owner deletes task", async () => {
      vi.mocked(tasksService.deleteTask).mockResolvedValueOnce({
        message: "Task deleted successfully.",
      });

      const res = await request(app)
        .delete(`/api/v1/tasks/${taskId}`)
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Task deleted successfully.");
      expect(tasksService.deleteTask).toHaveBeenCalledWith(
        orgA.id,
        expect.objectContaining({ userId: orgA.owner.id, role: "owner" }),
        taskId
      );
    });

    it("returns 403 when Member tries to delete task created by another user", async () => {
      vi.mocked(tasksService.deleteTask).mockRejectedValueOnce(
        new ForbiddenError("You do not have permission to delete this task.")
      );

      const res = await request(app)
        .delete(`/api/v1/tasks/${taskId}`)
        .set("Authorization", `Bearer ${orgA.member.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });
  });
});
