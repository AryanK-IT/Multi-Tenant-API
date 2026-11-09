import { prisma } from "../db/client";
import { Role, WEBHOOK_EVENTS } from "../config/constants";
import { webhookDispatcher } from "../webhooks/dispatcher";
import {
  NotFoundError,
  ValidationError,
  ForbiddenError,
  InvalidStatusTransitionError,
} from "../common/errors";
import {
  parsePaginationParams,
  decodeCursor,
  buildKeysetFilter,
  buildPaginatedResponse,
  PaginatedResult,
} from "../common/pagination";
import {
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksQuery,
  isValidStatusTransition,
} from "./schemas";
import { Task, TaskStatus, Prisma } from "@prisma/client";

export interface RequesterContext {
  userId?: string;
  role?: Role;
  isApiKey?: boolean;
}

export class TasksService {
  async createTask(
    orgId: string,
    userId: string,
    projectId: string,
    data: CreateTaskInput
  ): Promise<Task> {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        orgId,
      },
    });

    if (!project) {
      throw new NotFoundError("Project not found.");
    }

    if (data.assigneeId) {
      const membership = await prisma.orgMembership.findUnique({
        where: {
          userId_orgId: {
            userId: data.assigneeId,
            orgId,
          },
        },
      });

      if (!membership) {
        throw new ValidationError("Assignee must be a member of the organization.");
      }
    }

    const task = await prisma.task.create({
      data: {
        title: data.title,
        description: data.description ?? null,
        status: (data.status as TaskStatus) ?? "todo",
        assigneeId: data.assigneeId ?? null,
        projectId,
        orgId,
        createdById: userId,
      },
    });

    await webhookDispatcher.dispatch(orgId, WEBHOOK_EVENTS.TASK_CREATED, {
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      status: task.status,
      assigneeId: task.assigneeId,
      createdById: task.createdById,
      createdAt: task.createdAt ? new Date(task.createdAt).toISOString() : new Date().toISOString(),
    });

    return task;
  }

  async listTasks(
    orgId: string,
    projectId: string,
    query: ListTasksQuery
  ): Promise<PaginatedResult<Task>> {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        orgId,
      },
    });

    if (!project) {
      throw new NotFoundError("Project not found.");
    }

    const { limit, cursor } = parsePaginationParams(query);
    const cursorPayload = decodeCursor(cursor);
    const keysetFilter = buildKeysetFilter(cursorPayload);

    const where: Prisma.TaskWhereInput = {
      orgId,
      projectId,
      ...(query.status ? { status: query.status as TaskStatus } : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      ...keysetFilter,
    };

    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    return buildPaginatedResponse(tasks, limit);
  }

  async getTask(orgId: string, taskId: string): Promise<Task> {
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        orgId,
      },
    });

    if (!task) {
      throw new NotFoundError("Task not found.");
    }

    return task;
  }

  async updateTask(orgId: string, taskId: string, data: UpdateTaskInput): Promise<Task> {
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        orgId,
      },
    });

    if (!task) {
      throw new NotFoundError("Task not found.");
    }

    if (data.status && data.status !== task.status) {
      if (!isValidStatusTransition(task.status, data.status as TaskStatus)) {
        throw new InvalidStatusTransitionError(
          `Invalid status transition from '${task.status}' to '${data.status}'.`
        );
      }
    }

    if (data.assigneeId !== undefined && data.assigneeId !== null) {
      const membership = await prisma.orgMembership.findUnique({
        where: {
          userId_orgId: {
            userId: data.assigneeId,
            orgId,
          },
        },
      });

      if (!membership) {
        throw new ValidationError("Assignee must be a member of the organization.");
      }
    }

    const oldStatus = task.status;

    const updated = await prisma.task.update({
      where: {
        id: taskId,
      },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.status !== undefined ? { status: data.status as TaskStatus } : {}),
        ...(data.assigneeId !== undefined ? { assigneeId: data.assigneeId } : {}),
      },
    });

    await webhookDispatcher.dispatch(orgId, WEBHOOK_EVENTS.TASK_UPDATED, {
      id: updated.id,
      projectId: updated.projectId,
      title: updated.title,
      description: updated.description,
      status: updated.status,
      assigneeId: updated.assigneeId,
      updatedAt: updated.updatedAt
        ? new Date(updated.updatedAt).toISOString()
        : new Date().toISOString(),
    });

    if (data.status && data.status !== oldStatus) {
      await webhookDispatcher.dispatch(orgId, WEBHOOK_EVENTS.TASK_STATUS_CHANGED, {
        id: updated.id,
        projectId: updated.projectId,
        oldStatus,
        newStatus: updated.status,
        updatedAt: updated.updatedAt
          ? new Date(updated.updatedAt).toISOString()
          : new Date().toISOString(),
      });
    }

    return updated;
  }

  async deleteTask(
    orgId: string,
    requester: RequesterContext,
    taskId: string
  ): Promise<{ message: string }> {
    if (requester.isApiKey) {
      throw new ForbiddenError("You do not have permission to delete this task.");
    }

    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        orgId,
      },
    });

    if (!task) {
      throw new NotFoundError("Task not found.");
    }

    // Member can only delete tasks they created; Owner and Admin can delete any task
    if (requester.role === "member" && task.createdById !== requester.userId) {
      throw new ForbiddenError("You do not have permission to delete this task.");
    }

    await prisma.task.delete({
      where: {
        id: taskId,
      },
    });

    await webhookDispatcher.dispatch(orgId, WEBHOOK_EVENTS.TASK_DELETED, {
      id: taskId,
      projectId: task.projectId,
      title: task.title,
    });

    return { message: "Task deleted successfully." };
  }
}

export const tasksService = new TasksService();
