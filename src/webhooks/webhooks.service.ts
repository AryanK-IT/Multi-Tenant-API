import { prisma } from "../db/client";
import { NotFoundError } from "../common/errors";
import {
  parsePaginationParams,
  decodeCursor,
  buildKeysetFilter,
  buildPaginatedResponse,
  PaginatedResult,
} from "../common/pagination";
import {
  CreateWebhookInput,
  UpdateWebhookInput,
  ListWebhooksQuery,
  ListDeliveriesQuery,
} from "./schemas";
import { WebhookSummary, CreatedWebhookResult, WebhookDeliverySummary } from "./types";
import { generateWebhookSecret, encryptSecret } from "./crypto";
import { validateWebhookUrl } from "./ssrf";
import { AUDIT_ACTIONS, ACTOR_TYPES, WebhookEvent } from "../config/constants";
import { auditService } from "../audit/audit.service";

export class WebhooksService {
  /**
   * Registers a new webhook endpoint (SRS §3.5 FR-18).
   * Generates signing secret, stores it encrypted, and returns raw secret once.
   */
  async createWebhook(
    orgId: string,
    createdById: string,
    data: CreateWebhookInput,
    ip?: string
  ): Promise<CreatedWebhookResult> {
    // 1. SSRF validation at registration time (FR-18)
    await validateWebhookUrl(data.url);

    // 2. Secret generation & AES-256-GCM encryption
    const secret = generateWebhookSecret();
    const encryptedSecret = encryptSecret(secret);

    // 3. Database persistence
    const webhook = await prisma.webhook.create({
      data: {
        orgId,
        url: data.url,
        encryptedSecret,
        events: data.events,
        createdById,
        active: true,
        consecutiveFailures: 0,
      },
    });

    // 4. Audit log entry (SRS §3.7 FR-23)
    await auditService.logAction({
      orgId,
      actorType: ACTOR_TYPES.USER,
      actorId: createdById,
      action: AUDIT_ACTIONS.WEBHOOK_CREATED,
      targetType: "webhook",
      targetId: webhook.id,
      metadata: {
        url: webhook.url,
        events: webhook.events,
      },
      ip: ip ?? null,
    });

    return {
      id: webhook.id,
      url: webhook.url,
      events: webhook.events as WebhookEvent[],
      active: webhook.active,
      consecutiveFailures: webhook.consecutiveFailures,
      createdAt: webhook.createdAt,
      updatedAt: webhook.updatedAt,
      secret,
    };
  }

  /**
   * Lists webhooks for an organization with cursor pagination (SRS §3.5 FR-18).
   * Secrets are never exposed.
   */
  async listWebhooks(
    orgId: string,
    query: ListWebhooksQuery
  ): Promise<PaginatedResult<WebhookSummary>> {
    const { limit, cursor } = parsePaginationParams(query);
    const cursorPayload = decodeCursor(cursor);
    const keysetFilter = buildKeysetFilter(cursorPayload);

    const webhooks = await prisma.webhook.findMany({
      where: {
        orgId,
        ...keysetFilter,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const paginated = buildPaginatedResponse(webhooks, limit);

    return {
      data: paginated.data.map((wh) => ({
        id: wh.id,
        url: wh.url,
        events: wh.events as WebhookEvent[],
        active: wh.active,
        consecutiveFailures: wh.consecutiveFailures,
        createdAt: wh.createdAt,
        updatedAt: wh.updatedAt,
      })),
      nextCursor: paginated.nextCursor,
    };
  }

  /**
   * Retrieves a single webhook by ID (SRS §3.5 FR-18).
   * Cross-tenant requests return 404 NOT_FOUND.
   */
  async getWebhook(orgId: string, webhookId: string): Promise<WebhookSummary> {
    const webhook = await prisma.webhook.findFirst({
      where: {
        id: webhookId,
        orgId,
      },
    });

    if (!webhook) {
      throw new NotFoundError("Webhook not found.");
    }

    return {
      id: webhook.id,
      url: webhook.url,
      events: webhook.events as WebhookEvent[],
      active: webhook.active,
      consecutiveFailures: webhook.consecutiveFailures,
      createdAt: webhook.createdAt,
      updatedAt: webhook.updatedAt,
    };
  }

  /**
   * Updates an existing webhook (SRS §3.5 FR-18).
   */
  async updateWebhook(
    orgId: string,
    webhookId: string,
    actorId: string,
    data: UpdateWebhookInput,
    ip?: string
  ): Promise<WebhookSummary> {
    const existing = await prisma.webhook.findFirst({
      where: {
        id: webhookId,
        orgId,
      },
    });

    if (!existing) {
      throw new NotFoundError("Webhook not found.");
    }

    // SSRF validation if URL is being updated
    if (data.url && data.url !== existing.url) {
      await validateWebhookUrl(data.url);
    }

    const updated = await prisma.webhook.update({
      where: { id: webhookId },
      data: {
        ...(data.url !== undefined ? { url: data.url } : {}),
        ...(data.events !== undefined ? { events: data.events } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
    });

    // Audit log entry
    await auditService.logAction({
      orgId,
      actorType: ACTOR_TYPES.USER,
      actorId,
      action: AUDIT_ACTIONS.WEBHOOK_UPDATED,
      targetType: "webhook",
      targetId: webhookId,
      metadata: {
        changes: data,
      },
      ip: ip ?? null,
    });

    return {
      id: updated.id,
      url: updated.url,
      events: updated.events as WebhookEvent[],
      active: updated.active,
      consecutiveFailures: updated.consecutiveFailures,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Deletes a webhook and its delivery logs (SRS §3.5 FR-18).
   */
  async deleteWebhook(
    orgId: string,
    webhookId: string,
    actorId: string,
    ip?: string
  ): Promise<{ message: string }> {
    const existing = await prisma.webhook.findFirst({
      where: {
        id: webhookId,
        orgId,
      },
    });

    if (!existing) {
      throw new NotFoundError("Webhook not found.");
    }

    await prisma.webhook.delete({
      where: { id: webhookId },
    });

    await auditService.logAction({
      orgId,
      actorType: ACTOR_TYPES.USER,
      actorId,
      action: AUDIT_ACTIONS.WEBHOOK_DELETED,
      targetType: "webhook",
      targetId: webhookId,
      metadata: {
        url: existing.url,
      },
      ip: ip ?? null,
    });

    return { message: "Webhook deleted successfully." };
  }

  /**
   * Retrieves delivery attempt logs for a webhook with cursor pagination (SRS §3.5 FR-21).
   */
  async listDeliveries(
    orgId: string,
    webhookId: string,
    query: ListDeliveriesQuery
  ): Promise<PaginatedResult<WebhookDeliverySummary>> {
    const webhook = await prisma.webhook.findFirst({
      where: {
        id: webhookId,
        orgId,
      },
    });

    if (!webhook) {
      throw new NotFoundError("Webhook not found.");
    }

    const { limit, cursor } = parsePaginationParams(query);
    const cursorPayload = decodeCursor(cursor);
    const keysetFilter = buildKeysetFilter(cursorPayload);

    const deliveries = await prisma.webhookDelivery.findMany({
      where: {
        webhookId,
        orgId,
        ...keysetFilter,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const paginated = buildPaginatedResponse(deliveries, limit);

    return {
      data: paginated.data.map((d) => ({
        id: d.id,
        webhookId: d.webhookId,
        orgId: d.orgId,
        eventId: d.eventId,
        eventType: d.eventType,
        attempt: d.attempt,
        statusCode: d.statusCode,
        durationMs: d.durationMs,
        error: d.error,
        createdAt: d.createdAt,
      })),
      nextCursor: paginated.nextCursor,
    };
  }
}

export const webhooksService = new WebhooksService();
