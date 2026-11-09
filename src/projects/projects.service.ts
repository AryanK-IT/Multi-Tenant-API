import { prisma } from "../db/client";
import { NotFoundError, ConflictError } from "../common/errors";
import {
  parsePaginationParams,
  decodeCursor,
  buildKeysetFilter,
  buildPaginatedResponse,
  PaginatedResult,
} from "../common/pagination";
import { CreateProjectInput, UpdateProjectInput } from "./schemas";
import { Project } from "@prisma/client";
import { AUDIT_ACTIONS, WEBHOOK_EVENTS } from "../config/constants";
import { auditService } from "../audit/audit.service";
import { webhookDispatcher } from "../webhooks/dispatcher";

export class ProjectsService {
  async createProject(
    orgId: string,
    createdById: string,
    data: CreateProjectInput
  ): Promise<Project> {
    const existing = await prisma.project.findUnique({
      where: {
        orgId_name: {
          orgId,
          name: data.name,
        },
      },
    });

    if (existing) {
      throw new ConflictError("A project with this name already exists in this organization.");
    }

    const project = await prisma.project.create({
      data: {
        orgId,
        name: data.name,
        description: data.description ?? null,
        createdById,
      },
    });

    await webhookDispatcher.dispatch(orgId, WEBHOOK_EVENTS.PROJECT_CREATED, {
      id: project.id,
      name: project.name,
      description: project.description,
      createdById: project.createdById,
      createdAt: project.createdAt
        ? new Date(project.createdAt).toISOString()
        : new Date().toISOString(),
    });

    return project;
  }

  async listProjects(
    orgId: string,
    query: { limit?: unknown; cursor?: unknown }
  ): Promise<PaginatedResult<Project>> {
    const { limit, cursor } = parsePaginationParams(query);
    const cursorPayload = decodeCursor(cursor);
    const keysetFilter = buildKeysetFilter(cursorPayload);

    const projects = await prisma.project.findMany({
      where: {
        orgId,
        ...keysetFilter,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    return buildPaginatedResponse(projects, limit);
  }

  async getProject(orgId: string, projectId: string): Promise<Project> {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        orgId,
      },
    });

    if (!project) {
      throw new NotFoundError("Project not found.");
    }

    return project;
  }

  async updateProject(
    orgId: string,
    projectId: string,
    data: UpdateProjectInput
  ): Promise<Project> {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        orgId,
      },
    });

    if (!project) {
      throw new NotFoundError("Project not found.");
    }

    if (data.name && data.name !== project.name) {
      const duplicate = await prisma.project.findUnique({
        where: {
          orgId_name: {
            orgId,
            name: data.name,
          },
        },
      });

      if (duplicate && duplicate.id !== projectId) {
        throw new ConflictError("A project with this name already exists in this organization.");
      }
    }

    const updated = await prisma.project.update({
      where: {
        id: projectId,
      },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
      },
    });

    await webhookDispatcher.dispatch(orgId, WEBHOOK_EVENTS.PROJECT_UPDATED, {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      updatedAt: updated.updatedAt
        ? new Date(updated.updatedAt).toISOString()
        : new Date().toISOString(),
    });

    return updated;
  }

  async deleteProject(
    orgId: string,
    projectId: string,
    actorId?: string,
    ip?: string
  ): Promise<{ message: string }> {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        orgId,
      },
    });

    if (!project) {
      throw new NotFoundError("Project not found.");
    }

    // Cascade deletion of tasks is enforced by DB and Prisma schema
    if (actorId) {
      if (typeof prisma.$transaction === "function") {
        await prisma.$transaction(async (tx) => {
          await tx.project.delete({
            where: {
              id: projectId,
            },
          });

          await auditService.logAction(
            {
              orgId,
              actorType: "user",
              actorId,
              action: AUDIT_ACTIONS.PROJECT_DELETED,
              targetType: "project",
              targetId: projectId,
              metadata: { projectName: project.name },
              ip,
            },
            tx
          );
        });
      } else {
        await prisma.project.delete({
          where: {
            id: projectId,
          },
        });

        await auditService.logAction({
          orgId,
          actorType: "user",
          actorId,
          action: AUDIT_ACTIONS.PROJECT_DELETED,
          targetType: "project",
          targetId: projectId,
          metadata: { projectName: project.name },
          ip,
        });
      }
    } else {
      await prisma.project.delete({
        where: {
          id: projectId,
        },
      });
    }

    await webhookDispatcher.dispatch(orgId, WEBHOOK_EVENTS.PROJECT_DELETED, {
      id: projectId,
      name: project.name,
    });

    return { message: "Project deleted successfully." };
  }
}

export const projectsService = new ProjectsService();
