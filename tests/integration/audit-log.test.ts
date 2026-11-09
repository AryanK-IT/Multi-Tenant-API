import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { createTwoOrgFixture } from "../helpers/two-org-fixture";
import { auditService } from "../../src/audit/audit.service";
import { AUDIT_ACTIONS } from "../../src/config/constants";

vi.mock("../../src/audit/audit.service");

describe("Audit Log HTTP Endpoints Integration (Phase 5 - FR-23, FR-24)", () => {
  const app = createApp();
  const { orgA, orgB } = createTwoOrgFixture();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication & RBAC Guards (SRS §3.8, FR-24)", () => {
    it("returns 401 UNAUTHENTICATED when request lacks Authorization header", async () => {
      const res = await request(app).get("/api/v1/audit-log");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 403 FORBIDDEN when Member role attempts to view audit logs", async () => {
      const res = await request(app)
        .get("/api/v1/audit-log")
        .set("Authorization", `Bearer ${orgA.member.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
      expect(auditService.listAuditLogs).not.toHaveBeenCalled();
    });

    it("allows Owner to view audit logs (200 OK)", async () => {
      vi.mocked(auditService.listAuditLogs).mockResolvedValueOnce({
        data: [],
        nextCursor: null,
      });

      const res = await request(app)
        .get("/api/v1/audit-log")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [], nextCursor: null });
      expect(auditService.listAuditLogs).toHaveBeenCalledWith(orgA.id, expect.any(Object));
    });

    it("allows Admin to view audit logs (200 OK)", async () => {
      vi.mocked(auditService.listAuditLogs).mockResolvedValueOnce({
        data: [],
        nextCursor: null,
      });

      const res = await request(app)
        .get("/api/v1/audit-log")
        .set("Authorization", `Bearer ${orgA.admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [], nextCursor: null });
      expect(auditService.listAuditLogs).toHaveBeenCalledWith(orgA.id, expect.any(Object));
    });
  });

  describe("GET /api/v1/audit-log Query Filters & Pagination (FR-24)", () => {
    it("passes query filters (actorId, action, dates, limit, cursor) to auditService", async () => {
      vi.mocked(auditService.listAuditLogs).mockResolvedValueOnce({
        data: [
          {
            id: "audit-1",
            orgId: orgA.id,
            actorType: "user",
            actorId: orgA.owner.id,
            action: AUDIT_ACTIONS.MEMBER_INVITED,
            targetType: "invitation",
            targetId: "inv-1",
            metadata: { email: "invited@example.com", role: "member" },
            ip: "127.0.0.1",
            createdAt: new Date(),
          },
        ],
        nextCursor: "cursor_xyz",
      });

      const res = await request(app)
        .get(
          `/api/v1/audit-log?action=${AUDIT_ACTIONS.MEMBER_INVITED}&actorId=${orgA.owner.id}&startDate=2026-11-01T00:00:00.000Z&endDate=2026-11-08T23:59:59.000Z&limit=10`
        )
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.nextCursor).toBe("cursor_xyz");
      expect(auditService.listAuditLogs).toHaveBeenCalledWith(
        orgA.id,
        expect.objectContaining({
          action: AUDIT_ACTIONS.MEMBER_INVITED,
          actorId: orgA.owner.id,
          startDate: "2026-11-01T00:00:00.000Z",
          endDate: "2026-11-08T23:59:59.000Z",
          limit: 10,
        })
      );
    });

    it("returns 400 VALIDATION_ERROR when date format is invalid", async () => {
      const res = await request(app)
        .get("/api/v1/audit-log?startDate=invalid-date")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(auditService.listAuditLogs).not.toHaveBeenCalled();
    });

    it("supports top-level route alias /audit-log", async () => {
      vi.mocked(auditService.listAuditLogs).mockResolvedValueOnce({
        data: [],
        nextCursor: null,
      });

      const res = await request(app)
        .get("/audit-log")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(200);
      expect(auditService.listAuditLogs).toHaveBeenCalledWith(orgA.id, expect.any(Object));
    });
  });

  describe("Tenant Isolation on Audit Log (ADR 2, SRS §5.1)", () => {
    it("ensures Org B cannot view Org A's audit log", async () => {
      vi.mocked(auditService.listAuditLogs).mockImplementation(async (targetOrgId) => {
        if (targetOrgId === orgB.id) {
          return { data: [], nextCursor: null };
        }
        throw new Error("Cross-tenant leakage detected");
      });

      const resB = await request(app)
        .get("/api/v1/audit-log")
        .set("Authorization", `Bearer ${orgB.owner.token}`);

      expect(resB.status).toBe(200);
      expect(auditService.listAuditLogs).toHaveBeenCalledWith(orgB.id, expect.any(Object));
      expect(auditService.listAuditLogs).not.toHaveBeenCalledWith(orgA.id, expect.any(Object));
    });
  });
});
