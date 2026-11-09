import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeDeliveryAttempt } from "../../src/webhooks/delivery";
import { encryptSecret, generateWebhookSecret } from "../../src/webhooks/crypto";
import { prisma } from "../../src/db/client";

vi.mock("../../src/db/client", () => ({
  prisma: {
    webhookDelivery: {
      create: vi.fn(),
    },
    webhook: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../src/webhooks/ssrf", () => ({
  validateWebhookUrl: vi.fn().mockImplementation(async (url: string) => {
    if (url.includes("blocked-ssrf.local")) {
      throw new Error("SSRF blocked");
    }
    return url;
  }),
}));

describe("Webhook Delivery Execution (SRS §3.5 FR-19, FR-20, FR-21)", () => {
  const orgId = "org-11111111-1111-4111-8111-111111111111";
  const webhookId = "wh-uuid-123";
  const rawSecret = generateWebhookSecret();
  const encryptedSecret = encryptSecret(rawSecret);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delivers signed payload successfully on HTTP 200 and resets consecutive failures", async () => {
    let capturedHeaders: HeadersInit | undefined;
    let capturedBody: string | undefined;

    const mockFetch = vi.fn().mockImplementation(async (url, init) => {
      capturedHeaders = init?.headers;
      capturedBody = init?.body;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
      };
    });

    vi.mocked(prisma.webhook.findUnique).mockResolvedValueOnce({
      id: webhookId,
      consecutiveFailures: 3,
      active: true,
    } as any);

    const result = await executeDeliveryAttempt({
      webhookId,
      orgId,
      url: "https://api.example.com/receiver",
      encryptedSecret,
      eventId: "evt_123456789",
      eventType: "task.created",
      payload: {
        id: "evt_123456789",
        event: "task.created",
        createdAt: new Date().toISOString(),
        orgId,
        data: { title: "New Task" },
      },
      attempt: 1,
      fetchFn: mockFetch as any,
    });

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.error).toBeNull();
    expect(result.durationMs).toBeGreaterThan(0);

    // Verify headers attached to request
    expect(capturedHeaders).toBeDefined();
    expect(capturedBody).toBeDefined();
    expect(JSON.parse(capturedBody as string)).toMatchObject({
      id: "evt_123456789",
      event: "task.created",
    });
    const headersObj = capturedHeaders as Record<string, string>;
    expect(headersObj["Content-Type"]).toBe("application/json");
    expect(headersObj["User-Agent"]).toBe("TaskFlow-Webhook/1.0");
    expect(headersObj["X-TaskFlow-Event-Id"]).toBe("evt_123456789");
    expect(headersObj["X-TaskFlow-Event-Type"]).toBe("task.created");
    expect(headersObj["X-TaskFlow-Timestamp"]).toBeDefined();
    expect(headersObj["X-TaskFlow-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);

    // Verify delivery record was created
    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith({
      data: {
        webhookId,
        orgId,
        eventId: "evt_123456789",
        eventType: "task.created",
        attempt: 1,
        statusCode: 200,
        durationMs: expect.any(Number),
        error: null,
      },
    });

    // Verify consecutive failures was reset to 0
    expect(prisma.webhook.update).toHaveBeenCalledWith({
      where: { id: webhookId },
      data: { consecutiveFailures: 0 },
    });
  });

  it("records delivery failure on HTTP 500 and increments consecutive failures", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    vi.mocked(prisma.webhook.findUnique).mockResolvedValueOnce({
      id: webhookId,
      consecutiveFailures: 2,
      active: true,
    } as any);

    const result = await executeDeliveryAttempt({
      webhookId,
      orgId,
      url: "https://api.example.com/receiver",
      encryptedSecret,
      eventId: "evt_fail_1",
      eventType: "project.created",
      payload: {
        id: "evt_fail_1",
        event: "project.created",
        createdAt: new Date().toISOString(),
        orgId,
        data: { name: "New Project" },
      },
      attempt: 1,
      fetchFn: mockFetch as any,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.error).toContain("HTTP status 500");

    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith({
      data: {
        webhookId,
        orgId,
        eventId: "evt_fail_1",
        eventType: "project.created",
        attempt: 1,
        statusCode: 500,
        durationMs: expect.any(Number),
        error: expect.stringContaining("500"),
      },
    });

    expect(prisma.webhook.update).toHaveBeenCalledWith({
      where: { id: webhookId },
      data: { consecutiveFailures: 3 },
    });
  });

  it("handles network timeout error gracefully", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    });

    vi.mocked(prisma.webhook.findUnique).mockResolvedValueOnce({
      id: webhookId,
      consecutiveFailures: 0,
      active: true,
    } as any);

    const result = await executeDeliveryAttempt({
      webhookId,
      orgId,
      url: "https://api.example.com/slow",
      encryptedSecret,
      eventId: "evt_timeout_1",
      eventType: "task.updated",
      payload: {
        id: "evt_timeout_1",
        event: "task.updated",
        createdAt: new Date().toISOString(),
        orgId,
        data: { title: "Updated" },
      },
      attempt: 1,
      timeoutMs: 100,
      fetchFn: mockFetch as any,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.error).toContain("timed out");
  });

  it("auto-disables webhook upon reaching 20 consecutive failures (SRS §3.5 FR-19)", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    // 19 prior failures; 20th will trigger auto-disable
    vi.mocked(prisma.webhook.findUnique).mockResolvedValueOnce({
      id: webhookId,
      consecutiveFailures: 19,
      active: true,
    } as any);

    const result = await executeDeliveryAttempt({
      webhookId,
      orgId,
      url: "https://api.example.com/receiver",
      encryptedSecret,
      eventId: "evt_auto_disable",
      eventType: "task.deleted",
      payload: {
        id: "evt_auto_disable",
        event: "task.deleted",
        createdAt: new Date().toISOString(),
        orgId,
        data: { id: "t1" },
      },
      attempt: 1,
      fetchFn: mockFetch as any,
    });

    expect(result.success).toBe(false);
    expect(result.autoDisabled).toBe(true);

    expect(prisma.webhook.update).toHaveBeenCalledWith({
      where: { id: webhookId },
      data: {
        consecutiveFailures: 20,
        active: false,
      },
    });
  });

  it("fails closed and records error when SSRF validation rejects target URL", async () => {
    vi.mocked(prisma.webhook.findUnique).mockResolvedValueOnce({
      id: webhookId,
      consecutiveFailures: 0,
      active: true,
    } as any);

    const result = await executeDeliveryAttempt({
      webhookId,
      orgId,
      url: "https://blocked-ssrf.local/webhook",
      encryptedSecret,
      eventId: "evt_ssrf_reject",
      eventType: "task.created",
      payload: {
        id: "evt_ssrf_reject",
        event: "task.created",
        createdAt: new Date().toISOString(),
        orgId,
        data: {},
      },
      attempt: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("SSRF blocked");
    expect(prisma.webhookDelivery.create).toHaveBeenCalled();
  });
});
