import { describe, it, expect, vi, beforeEach } from "vitest";
import { auditService } from "../../src/audit/audit.service";
import { prisma } from "../../src/db/client";
import { AUDIT_ACTIONS } from "../../src/config/constants";

vi.mock("../../src/db/client", () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

describe("AuditService Unit Tests (SRS §3.7, FR-23, FR-24)", () => {
  const orgId = "org-11111111-1111-4111-8111-111111111111";
  const userId = "user-22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("logAction (FR-23)", () => {
    it("creates an audit log entry with actor, action, target, metadata, and IP", async () => {
      const mockAuditRecord = {
        id: "audit-1",
        orgId,
        actorType: "user" as const,
        actorId: userId,
        action: AUDIT_ACTIONS.MEMBER_ROLE_CHANGED,
        targetType: "member",
        targetId: "target-user-1",
        metadata: { previousRole: "member", newRole: "admin" },
        ip: "192.168.1.100",
        createdAt: new Date(),
      };

      vi.mocked(prisma.auditLog.create).mockResolvedValueOnce(mockAuditRecord as never);

      const result = await auditService.logAction({
        orgId,
        actorType: "user",
        actorId: userId,
        action: AUDIT_ACTIONS.MEMBER_ROLE_CHANGED,
        targetType: "member",
        targetId: "target-user-1",
        metadata: { previousRole: "member", newRole: "admin" },
        ip: "192.168.1.100",
      });

      expect(result).toEqual(mockAuditRecord);
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          orgId,
          actorType: "user",
          actorId: userId,
          action: AUDIT_ACTIONS.MEMBER_ROLE_CHANGED,
          targetType: "member",
          targetId: "target-user-1",
          metadata: { previousRole: "member", newRole: "admin" },
          ip: "192.168.1.100",
        },
      });
    });

    it("supports logging within a transaction client", async () => {
      const mockTx = {
        auditLog: {
          create: vi.fn().mockResolvedValueOnce({
            id: "audit-tx-1",
            orgId,
            actorType: "user",
            actorId: userId,
            action: AUDIT_ACTIONS.PROJECT_DELETED,
            targetType: "project",
            targetId: "proj-1",
            metadata: { projectName: "Old Project" },
            ip: null,
            createdAt: new Date(),
          }),
        },
      };

      const result = await auditService.logAction(
        {
          orgId,
          actorType: "user",
          actorId: userId,
          action: AUDIT_ACTIONS.PROJECT_DELETED,
          targetType: "project",
          targetId: "proj-1",
          metadata: { projectName: "Old Project" },
        },
        mockTx as never
      );

      expect(mockTx.auditLog.create).toHaveBeenCalled();
      expect(result.id).toBe("audit-tx-1");
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it("rethrows error when creation fails", async () => {
      vi.mocked(prisma.auditLog.create).mockRejectedValueOnce(
        new Error("Database connection lost")
      );

      await expect(
        auditService.logAction({
          orgId,
          actorType: "user",
          actorId: userId,
          action: AUDIT_ACTIONS.MEMBER_INVITED,
          targetType: "invitation",
          targetId: "inv-1",
        })
      ).rejects.toThrow("Database connection lost");
    });
  });

  describe("listAuditLogs (FR-24)", () => {
    it("lists audit logs with cursor pagination and default limits", async () => {
      const now = new Date();
      const mockLogs = [
        {
          id: "audit-2",
          orgId,
          actorType: "user",
          actorId: userId,
          action: AUDIT_ACTIONS.MEMBER_ROLE_CHANGED,
          targetType: "member",
          targetId: "user-3",
          metadata: null,
          ip: "127.0.0.1",
          createdAt: new Date(now.getTime() - 1000),
        },
        {
          id: "audit-1",
          orgId,
          actorType: "user",
          actorId: userId,
          action: AUDIT_ACTIONS.MEMBER_INVITED,
          targetType: "invitation",
          targetId: "inv-1",
          metadata: null,
          ip: "127.0.0.1",
          createdAt: new Date(now.getTime() - 2000),
        },
      ];

      vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce(mockLogs as never);

      const result = await auditService.listAuditLogs(orgId, {});

      expect(result.data).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { orgId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 26, // default 25 + 1
      });
    });

    it("filters by actorId, action, and date range", async () => {
      const startDate = "2026-11-01T00:00:00.000Z";
      const endDate = "2026-11-07T23:59:59.999Z";

      vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([] as never);

      await auditService.listAuditLogs(orgId, {
        actorId: userId,
        action: AUDIT_ACTIONS.PROJECT_DELETED,
        startDate,
        endDate,
        limit: 10,
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          orgId,
          actorId: userId,
          action: AUDIT_ACTIONS.PROJECT_DELETED,
          createdAt: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 11,
      });
    });

    it("generates nextCursor when results exceed requested limit", async () => {
      const logs = [
        { id: "log-3", orgId, createdAt: new Date("2026-11-07T12:00:00.000Z") },
        { id: "log-2", orgId, createdAt: new Date("2026-11-07T11:00:00.000Z") },
        { id: "log-1", orgId, createdAt: new Date("2026-11-07T10:00:00.000Z") },
      ];

      vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce(logs as never);

      const result = await auditService.listAuditLogs(orgId, { limit: 2 });

      expect(result.data).toHaveLength(2);
      expect(result.nextCursor).toBeTruthy();
    });
  });

  describe("Append-Only Guarantees (FR-23)", () => {
    it("enforces append-only design by not exposing update, patch, or delete methods", () => {
      const serviceMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(auditService));
      expect(serviceMethods).not.toContain("updateAuditLog");
      expect(serviceMethods).not.toContain("deleteAuditLog");
      expect(serviceMethods).not.toContain("deleteMany");
      expect(serviceMethods).not.toContain("patchAuditLog");
    });
  });
});
