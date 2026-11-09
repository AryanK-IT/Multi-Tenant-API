import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { createTwoOrgFixture } from "../helpers/two-org-fixture";
import { webhooksService } from "../../src/webhooks/webhooks.service";
import { apiKeysService } from "../../src/api-keys/api-keys.service";
import { NotFoundError } from "../../src/common/errors";

vi.mock("../../src/webhooks/webhooks.service");
vi.mock("../../src/api-keys/api-keys.service");

describe("Webhooks Management Endpoints (SRS §3.5 FR-18, FR-21, §3.8, Phase 8)", () => {
  const app = createApp();
  const { orgA } = createTwoOrgFixture();

  const apiKeyBearer = "tf_0123456789abcdef_111111111111111111111111111111111111111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication & RBAC guards", () => {
    it("returns 401 UNAUTHENTICATED when Authorization header is missing", async () => {
      const res = await request(app)
        .post("/api/v1/webhooks")
        .send({ url: "https://api.example.com/webhook", events: ["task.created"] });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 403 FORBIDDEN when a Member attempts to create a webhook (SRS §3.8)", async () => {
      const res = await request(app)
        .post("/api/v1/webhooks")
        .set("Authorization", `Bearer ${orgA.member.token}`)
        .send({ url: "https://api.example.com/webhook", events: ["task.created"] });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
      expect(webhooksService.createWebhook).not.toHaveBeenCalled();
    });

    it("returns 403 FORBIDDEN when an API Key attempts to create a webhook (SRS §3.8 ADR 4)", async () => {
      vi.mocked(apiKeysService.verifyAndAuthenticateKey).mockResolvedValueOnce({
        apiKeyId: "key-1",
        orgId: orgA.id,
        scope: "read_write",
        createdById: orgA.owner.id,
        name: "Service Key",
        prefix: "0123456789abcdef",
      });

      const res = await request(app)
        .post("/api/v1/webhooks")
        .set("Authorization", `Bearer ${apiKeyBearer}`)
        .send({ url: "https://api.example.com/webhook", events: ["task.created"] });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
      expect(webhooksService.createWebhook).not.toHaveBeenCalled();
    });

    it("returns 403 FORBIDDEN when a Member attempts to list webhooks", async () => {
      const res = await request(app)
        .get("/api/v1/webhooks")
        .set("Authorization", `Bearer ${orgA.member.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
      expect(webhooksService.listWebhooks).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/v1/webhooks (FR-18)", () => {
    it("allows Owner to create a webhook and returns 201 with raw secret", async () => {
      vi.mocked(webhooksService.createWebhook).mockResolvedValueOnce({
        id: "wh-uuid-1",
        url: "https://api.example.com/webhook",
        events: ["task.created", "task.updated"],
        active: true,
        consecutiveFailures: 0,
        createdAt: new Date("2026-11-09T10:00:00.000Z"),
        updatedAt: new Date("2026-11-09T10:00:00.000Z"),
        secret: "whsec_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      });

      const res = await request(app)
        .post("/api/v1/webhooks")
        .set("Authorization", `Bearer ${orgA.owner.token}`)
        .send({
          url: "https://api.example.com/webhook",
          events: ["task.created", "task.updated"],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe("wh-uuid-1");
      expect(res.body.url).toBe("https://api.example.com/webhook");
      expect(res.body.events).toEqual(["task.created", "task.updated"]);
      expect(res.body.secret).toMatch(/^whsec_/);
      expect(webhooksService.createWebhook).toHaveBeenCalledWith(
        orgA.id,
        orgA.owner.id,
        {
          url: "https://api.example.com/webhook",
          events: ["task.created", "task.updated"],
        },
        expect.any(String)
      );
    });

    it("allows Admin to create a webhook (SRS §3.8)", async () => {
      vi.mocked(webhooksService.createWebhook).mockResolvedValueOnce({
        id: "wh-uuid-2",
        url: "https://api.example.com/admin-hook",
        events: ["project.created"],
        active: true,
        consecutiveFailures: 0,
        createdAt: new Date("2026-11-09T10:00:00.000Z"),
        updatedAt: new Date("2026-11-09T10:00:00.000Z"),
        secret: "whsec_admin_secret_0123456789abcdef0123456789abcdef",
      });

      const res = await request(app)
        .post("/api/v1/webhooks")
        .set("Authorization", `Bearer ${orgA.admin.token}`)
        .send({
          url: "https://api.example.com/admin-hook",
          events: ["project.created"],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe("wh-uuid-2");
    });

    it("returns 400 VALIDATION_ERROR when events array is empty", async () => {
      const res = await request(app)
        .post("/api/v1/webhooks")
        .set("Authorization", `Bearer ${orgA.owner.token}`)
        .send({
          url: "https://api.example.com/webhook",
          events: [],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(webhooksService.createWebhook).not.toHaveBeenCalled();
    });

    it("returns 400 VALIDATION_ERROR when event type is invalid", async () => {
      const res = await request(app)
        .post("/api/v1/webhooks")
        .set("Authorization", `Bearer ${orgA.owner.token}`)
        .send({
          url: "https://api.example.com/webhook",
          events: ["invalid.event.name"],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("GET /api/v1/webhooks (FR-18)", () => {
    it("returns 200 with paginated webhooks for Admin", async () => {
      vi.mocked(webhooksService.listWebhooks).mockResolvedValueOnce({
        data: [
          {
            id: "wh-uuid-1",
            url: "https://api.example.com/hook",
            events: ["task.created"],
            active: true,
            consecutiveFailures: 0,
            createdAt: new Date("2026-11-09T10:00:00.000Z"),
            updatedAt: new Date("2026-11-09T10:00:00.000Z"),
          },
        ],
        nextCursor: null,
      });

      const res = await request(app)
        .get("/api/v1/webhooks")
        .set("Authorization", `Bearer ${orgA.admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe("wh-uuid-1");
      expect(res.body.data[0].secret).toBeUndefined();
    });
  });

  describe("GET /api/v1/webhooks/:id (FR-18)", () => {
    it("returns 200 with webhook details for Owner", async () => {
      vi.mocked(webhooksService.getWebhook).mockResolvedValueOnce({
        id: "wh-uuid-1",
        url: "https://api.example.com/hook",
        events: ["task.created"],
        active: true,
        consecutiveFailures: 0,
        createdAt: new Date("2026-11-09T10:00:00.000Z"),
        updatedAt: new Date("2026-11-09T10:00:00.000Z"),
      });

      const res = await request(app)
        .get("/api/v1/webhooks/wh-uuid-1")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe("wh-uuid-1");
      expect(res.body.secret).toBeUndefined();
    });

    it("returns 404 NOT_FOUND on cross-tenant webhook access attempt (ADR 2)", async () => {
      vi.mocked(webhooksService.getWebhook).mockRejectedValueOnce(
        new NotFoundError("Webhook not found.")
      );

      const res = await request(app)
        .get("/api/v1/webhooks/wh-orgB-1")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("PATCH /api/v1/webhooks/:id (FR-18)", () => {
    it("allows Admin to update webhook URL and active status", async () => {
      vi.mocked(webhooksService.updateWebhook).mockResolvedValueOnce({
        id: "wh-uuid-1",
        url: "https://api.example.com/updated",
        events: ["task.created"],
        active: false,
        consecutiveFailures: 0,
        createdAt: new Date("2026-11-09T10:00:00.000Z"),
        updatedAt: new Date("2026-11-09T11:00:00.000Z"),
      });

      const res = await request(app)
        .patch("/api/v1/webhooks/wh-uuid-1")
        .set("Authorization", `Bearer ${orgA.admin.token}`)
        .send({
          url: "https://api.example.com/updated",
          active: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.url).toBe("https://api.example.com/updated");
      expect(res.body.active).toBe(false);
    });

    it("returns 404 NOT_FOUND when updating another tenant's webhook", async () => {
      vi.mocked(webhooksService.updateWebhook).mockRejectedValueOnce(
        new NotFoundError("Webhook not found.")
      );

      const res = await request(app)
        .patch("/api/v1/webhooks/wh-orgB-1")
        .set("Authorization", `Bearer ${orgA.admin.token}`)
        .send({ active: false });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("DELETE /api/v1/webhooks/:id (FR-18)", () => {
    it("allows Owner to delete webhook and returns 200", async () => {
      vi.mocked(webhooksService.deleteWebhook).mockResolvedValueOnce({
        message: "Webhook deleted successfully.",
      });

      const res = await request(app)
        .delete("/api/v1/webhooks/wh-uuid-1")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Webhook deleted successfully.");
    });

    it("returns 404 NOT_FOUND when deleting another tenant's webhook (ADR 2)", async () => {
      vi.mocked(webhooksService.deleteWebhook).mockRejectedValueOnce(
        new NotFoundError("Webhook not found.")
      );

      const res = await request(app)
        .delete("/api/v1/webhooks/wh-orgB-1")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("GET /api/v1/webhooks/:id/deliveries (FR-21)", () => {
    it("allows Owner to list recent delivery logs for a webhook", async () => {
      vi.mocked(webhooksService.listDeliveries).mockResolvedValueOnce({
        data: [
          {
            id: "del-uuid-1",
            webhookId: "wh-uuid-1",
            orgId: orgA.id,
            eventId: "evt-123",
            eventType: "task.created",
            attempt: 1,
            statusCode: 200,
            durationMs: 50,
            error: null,
            createdAt: new Date("2026-11-09T10:05:00.000Z"),
          },
        ],
        nextCursor: null,
      });

      const res = await request(app)
        .get("/api/v1/webhooks/wh-uuid-1/deliveries")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].statusCode).toBe(200);
      expect(res.body.data[0].attempt).toBe(1);
    });

    it("returns 404 NOT_FOUND when fetching deliveries of another tenant's webhook", async () => {
      vi.mocked(webhooksService.listDeliveries).mockRejectedValueOnce(
        new NotFoundError("Webhook not found.")
      );

      const res = await request(app)
        .get("/api/v1/webhooks/wh-orgB-1/deliveries")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });
});
