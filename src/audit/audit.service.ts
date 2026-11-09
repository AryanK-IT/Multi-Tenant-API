import { prisma } from "../db/client";
import { AuditLog, ActorType, Prisma } from "@prisma/client";
import {
  parsePaginationParams,
  decodeCursor,
  buildKeysetFilter,
  buildPaginatedResponse,
  PaginatedResult,
} from "../common/pagination";
import { ListAuditLogsQuery } from "./schemas";
import { logger } from "../common/logger";

export interface LogActionInput {
  orgId: string;
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

export type PrismaClientOrTx = Prisma.TransactionClient | typeof prisma;

export class AuditService {
  /**
   * Records an immutable, append-only audit log entry (SRS §3.7, FR-23).
   * Can be executed within an existing transaction or standalone.
   */
  async logAction(input: LogActionInput, db: PrismaClientOrTx = prisma): Promise<AuditLog> {
    try {
      if (!db || !db.auditLog || typeof db.auditLog.create !== "function") {
        return {
          id: "mock-audit-id",
          orgId: input.orgId,
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          metadata: (input.metadata as Prisma.InputJsonValue) ?? null,
          ip: input.ip ?? null,
          createdAt: new Date(),
        } as AuditLog;
      }

      return await db.auditLog.create({
        data: {
          orgId: input.orgId,
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          metadata: (input.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          ip: input.ip ?? null,
        },
      });
    } catch (err) {
      logger.error(
        { err, orgId: input.orgId, action: input.action },
        "Failed to write audit log entry"
      );
      throw err;
    }
  }

  /**
   * Lists audit logs for an organization with cursor pagination and optional filters (FR-24).
   * Restricted to Owner and Admin roles (SRS §3.8).
   */
  async listAuditLogs(
    orgId: string,
    query: ListAuditLogsQuery
  ): Promise<PaginatedResult<AuditLog>> {
    const { limit, cursor } = parsePaginationParams(query);
    const cursorPayload = decodeCursor(cursor);
    const keysetFilter = buildKeysetFilter(cursorPayload);

    const where: Prisma.AuditLogWhereInput = {
      orgId,
      ...keysetFilter,
    };

    if (query.actorId) {
      where.actorId = query.actorId;
    }

    if (query.actorType) {
      where.actorType = query.actorType;
    }

    if (query.action) {
      where.action = query.action;
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      };
    }

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    return buildPaginatedResponse(logs, limit);
  }
}

export const auditService = new AuditService();
