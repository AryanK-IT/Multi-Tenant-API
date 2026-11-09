import { describe, it, expect, vi, beforeEach } from "vitest";
import { webhooksService } from "../../src/webhooks/webhooks.service";
import { prisma } from "../../src/db/client";
import { auditService } from "../../src/audit/audit.service";
import { NotFoundError } from "../../src/common/errors";
import { AUDIT_ACTIONS, WEBHOOK_EVENTS } from "../../src/config/constants";

vi.mock("../../src/db/client", () => ({
  prisma: {
    webhook: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    webhookDelivery: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../src/audit/audit.service", () => ({
  auditService: {
    logAction: vi.fn(),
  },
}));

vi.mock("../../src/webhooks/ssrf", () => ({
  validateWebhookUrl: vi.fn().mockImplementation(async (url: string) => url),
}));

describe("WebhooksService Unit Tests (SRS §3.5 FR-18, FR-21)", () => {
  const orgId = "org-11111111-1111-4111-8111-111111111111";
  const userId = "usr-owner-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createWebhook", () => {
    it("creates a webhook, encrypts secret, logs audit event, and returns raw secret once", async () => {
      const mockCreated = {
        id: "wh-1",
        orgId,
        url: "https://api.example.com/events",
        encryptedSecret: "iv:tag:cipher",
        events: [WEBHOOK_EVENTS.TASK_CREATED, WEBHOOK_EVENTS.TASK_UPDATED],
        active: true,
        consecutiveFailures: 0,
        createdById: userId,
        createdAt: new Date("2026-11-09T12:00:00Z"),
        updatedAt: new Date("2026-11-09T12:00:00Z"),
      };

      vi.mocked(prisma.webhook.create).mockResolvedValueOnce(mockCreated as any);

      const result = await webhooksService.createWebhook(
        orgId,
        userId,
        {
          url: "https://api.example.com/events",
          events: [WEBHOOK_EVENTS.TASK_CREATED, WEBHOOK_EVENTS.TASK_UPDATED],
        },
        "198.51.100.1"
      );

      expect(result.id).toBe("wh-1");
      expect(result.url).toBe("https://api.example.com/events");
      expect(result.events).toEqual([WEBHOOK_EVENTS.TASK_CREATED, WEBHOOK_EVENTS.TASK_UPDATED]);
      expect(result.secret).toMatch(/^whsec_[0-9a-f]{64}$/);

      expect(prisma.webhook.create).toHaveBeenCalledWith({
        data: {
          orgId,
          url: "https://api.example.com/events",
          encryptedSecret: expect.any(String),
          events: [WEBHOOK_EVENTS.TASK_CREATED, WEBHOOK_EVENTS.TASK_UPDATED],
          createdById: userId,
          active: true,
          consecutiveFailures: 0,
        },
      });

      expect(auditService.logAction).toHaveBeenCalledWith({
        orgId,
        actorType: "user",
        actorId: userId,
        action: AUDIT_ACTIONS.WEBHOOK_CREATED,
        targetType: "webhook",
        targetId: "wh-1",
        metadata: {
          url: "https://api.example.com/events",
          events: [WEBHOOK_EVENTS.TASK_CREATED, WEBHOOK_EVENTS.TASK_UPDATED],
        },
        ip: "198.51.100.1",
      });
    });
  });

  describe("listWebhooks", () => {
    it("returns paginated webhooks without exposing secrets", async () => {
      const mockWebhooks = [
        {
          id: "wh-1",
          orgId,
          url: "https://api.example.com/1",
          encryptedSecret: "encrypted_1",
          events: ["task.created"],
          active: true,
          consecutiveFailures: 0,
          createdAt: new Date("2026-11-09T12:00:00Z"),
          updatedAt: new Date("2026-11-09T12:00:00Z"),
        },
      ];

      vi.mocked(prisma.webhook.findMany).mockResolvedValueOnce(mockWebhooks as any);

      const result = await webhooksService.listWebhooks(orgId, { limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe("wh-1");
      expect((result.data[0] as any).encryptedSecret).toBeUndefined();
      expect((result.data[0] as any).secret).toBeUndefined();
      expect(result.nextCursor).toBeNull();
    });
  });

  describe("getWebhook", () => {
    it("returns webhook summary by id", async () => {
      vi.mocked(prisma.webhook.findFirst).mockResolvedValueOnce({
        id: "wh-1",
        orgId,
        url: "https://api.example.com/1",
        events: ["task.created"],
        active: true,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await webhooksService.getWebhook(orgId, "wh-1");
      expect(result.id).toBe("wh-1");
    });

    it("throws NotFoundError when webhook does not exist", async () => {
      vi.mocked(prisma.webhook.findFirst).mockResolvedValueOnce(null);

      await expect(webhooksService.getWebhook(orgId, "non-existent")).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe("updateWebhook", () => {
    it("updates webhook fields and records audit log", async () => {
      vi.mocked(prisma.webhook.findFirst).mockResolvedValueOnce({
        id: "wh-1",
        orgId,
        url: "https://api.example.com/old",
      } as any);

      vi.mocked(prisma.webhook.update).mockResolvedValueOnce({
        id: "wh-1",
        url: "https://api.example.com/new",
        events: ["project.created"],
        active: false,
        consecutiveFailures: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await webhooksService.updateWebhook(
        orgId,
        "wh-1",
        userId,
        {
          url: "https://api.example.com/new",
          active: false,
        },
        "198.51.100.1"
      );

      expect(result.url).toBe("https://api.example.com/new");
      expect(result.active).toBe(false);

      expect(auditService.logAction).toHaveBeenCalledWith({
        orgId,
        actorType: "user",
        actorId: userId,
        action: AUDIT_ACTIONS.WEBHOOK_UPDATED,
        targetType: "webhook",
        targetId: "wh-1",
        metadata: {
          changes: {
            url: "https://api.example.com/new",
            active: false,
          },
        },
        ip: "198.51.100.1",
      });
    });
  });

  describe("deleteWebhook", () => {
    it("deletes webhook and records audit log", async () => {
      vi.mocked(prisma.webhook.findFirst).mockResolvedValueOnce({
        id: "wh-1",
        orgId,
        url: "https://api.example.com/wh",
      } as any);

      vi.mocked(prisma.webhook.delete).mockResolvedValueOnce({ id: "wh-1" } as any);

      const result = await webhooksService.deleteWebhook(orgId, "wh-1", userId, "198.51.100.1");

      expect(result.message).toBe("Webhook deleted successfully.");
      expect(prisma.webhook.delete).toHaveBeenCalledWith({ where: { id: "wh-1" } });
      expect(auditService.logAction).toHaveBeenCalledWith({
        orgId,
        actorType: "user",
        actorId: userId,
        action: AUDIT_ACTIONS.WEBHOOK_DELETED,
        targetType: "webhook",
        targetId: "wh-1",
        metadata: {
          url: "https://api.example.com/wh",
        },
        ip: "198.51.100.1",
      });
    });
  });

  describe("listDeliveries", () => {
    it("returns paginated delivery attempt logs for a webhook", async () => {
      vi.mocked(prisma.webhook.findFirst).mockResolvedValueOnce({
        id: "wh-1",
        orgId,
      } as any);

      vi.mocked(prisma.webhookDelivery.findMany).mockResolvedValueOnce([
        {
          id: "del-1",
          webhookId: "wh-1",
          orgId,
          eventId: "evt-1",
          eventType: "task.created",
          attempt: 1,
          statusCode: 200,
          durationMs: 45,
          error: null,
          createdAt: new Date("2026-11-09T12:00:00Z"),
        },
      ] as any);

      const result = await webhooksService.listDeliveries(orgId, "wh-1", { limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe("del-1");
      expect(result.data[0].statusCode).toBe(200);
      expect(result.nextCursor).toBeNull();
    });

    it("throws NotFoundError when webhook does not exist", async () => {
      vi.mocked(prisma.webhook.findFirst).mockResolvedValueOnce(null);

      await expect(webhooksService.listDeliveries(orgId, "non-existent", {})).rejects.toThrow(
        NotFoundError
      );
    });
  });
});
