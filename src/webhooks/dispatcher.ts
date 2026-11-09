import crypto from "crypto";
import { prisma } from "../db/client";
import { WebhookEvent } from "../config/constants";
import { WebhookEventPayload } from "./types";
import { getWebhookQueue } from "./queue";
import { logger } from "../common/logger";

export class WebhookDispatcher {
  /**
   * Dispatches a domain event to all active webhooks subscribed in the given organization (SRS §3.5 FR-19).
   */
  async dispatch<T = unknown>(orgId: string, eventType: WebhookEvent, data: T): Promise<void> {
    try {
      if (!prisma.webhook || typeof prisma.webhook.findMany !== "function") {
        return;
      }

      // Find active webhooks for the tenant
      const webhooks = await prisma.webhook.findMany({
        where: {
          orgId,
          active: true,
        },
      });

      // Filter webhooks that subscribe to this event
      const matchingWebhooks = webhooks.filter(
        (wh) => wh.events.includes(eventType) || wh.events.includes("*" as unknown as WebhookEvent)
      );

      if (matchingWebhooks.length === 0) {
        return;
      }

      const queue = getWebhookQueue();

      for (const webhook of matchingWebhooks) {
        // Unique event ID for receiver deduplication (FR-19)
        const eventId = `evt_${crypto.randomUUID().replace(/-/g, "")}`;
        const payload: WebhookEventPayload<T> = {
          id: eventId,
          event: eventType,
          createdAt: new Date().toISOString(),
          orgId,
          data,
        };

        await queue.enqueue({
          webhookId: webhook.id,
          orgId,
          url: webhook.url,
          encryptedSecret: webhook.encryptedSecret,
          eventId,
          eventType,
          payload,
          attempt: 1,
        });
      }
    } catch (err) {
      logger.error({ orgId, eventType, err }, "Failed to dispatch webhook events to queue");
    }
  }
}

export const webhookDispatcher = new WebhookDispatcher();
