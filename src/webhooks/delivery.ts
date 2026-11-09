import { prisma } from "../db/client";
import { WEBHOOK_CONSTANTS, WebhookEvent } from "../config/constants";
import { decryptSecret, signWebhookPayload } from "./crypto";
import { validateWebhookUrl } from "./ssrf";
import { WebhookEventPayload } from "./types";
import { logger } from "../common/logger";

export interface DeliveryAttemptParams {
  webhookId: string;
  orgId: string;
  url: string;
  encryptedSecret: string;
  eventId: string;
  eventType: WebhookEvent;
  payload: WebhookEventPayload;
  attempt: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface DeliveryAttemptResult {
  success: boolean;
  statusCode: number | null;
  durationMs: number;
  error: string | null;
  autoDisabled?: boolean;
}

/**
 * Executes a single signed HTTP webhook delivery attempt (SRS §3.5 FR-19, FR-20, FR-21).
 * Features:
 * - Runtime SSRF validation before dispatch (DNS rebinding defense).
 * - Redirects not followed (redirect: "manual").
 * - 10-second timeout enforcement.
 * - HMAC-SHA256 signature and event headers.
 * - Append-only delivery attempt logging.
 * - Auto-disable upon reaching 20 consecutive failures.
 */
export async function executeDeliveryAttempt({
  webhookId,
  orgId,
  url,
  encryptedSecret,
  eventId,
  eventType,
  payload,
  attempt,
  timeoutMs = WEBHOOK_CONSTANTS.TIMEOUT_MS,
  fetchFn = fetch,
}: DeliveryAttemptParams): Promise<DeliveryAttemptResult> {
  const start = Date.now();
  let statusCode: number | null = null;
  let errorMsg: string | null = null;
  let isSuccess = false;

  try {
    // 1. Runtime SSRF validation (protects against DNS rebinding / internal routing changes)
    await validateWebhookUrl(url);

    // 2. Decrypt signing secret
    const secret = decryptSecret(encryptedSecret);

    // 3. Prepare payload and signature
    const bodyString = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload(secret, timestamp, bodyString);

    // 4. HTTP POST delivery with timeout and manual redirects
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "TaskFlow-Webhook/1.0",
          "X-TaskFlow-Event-Id": eventId,
          "X-TaskFlow-Event-Type": eventType,
          "X-TaskFlow-Timestamp": timestamp.toString(),
          "X-TaskFlow-Signature": signature,
        },
        body: bodyString,
        redirect: "manual",
        signal: controller.signal,
      });

      statusCode = response.status;
      // HTTP 2xx is considered a successful delivery
      if (response.ok) {
        isSuccess = true;
      } else {
        errorMsg = `Endpoint returned HTTP status ${response.status} ${response.statusText}`;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.name === "AbortError") {
        errorMsg = `Delivery timed out after ${timeoutMs}ms`;
      } else {
        errorMsg = err.message;
      }
    } else {
      errorMsg = "Unknown network error during webhook delivery.";
    }
  }

  const durationMs = Math.max(1, Date.now() - start);

  // 5. Append-only delivery attempt log (SRS §3.5 FR-21)
  try {
    await prisma.webhookDelivery.create({
      data: {
        webhookId,
        orgId,
        eventId,
        eventType,
        attempt,
        statusCode,
        durationMs,
        error: errorMsg,
      },
    });
  } catch (logErr) {
    logger.error(
      { webhookId, eventId, err: logErr },
      "Failed to record webhook delivery attempt log"
    );
  }

  // 6. Update webhook health / failure counter and auto-disable if needed (FR-19)
  let autoDisabled = false;
  try {
    const webhook = await prisma.webhook.findUnique({
      where: { id: webhookId },
      select: { consecutiveFailures: true, active: true },
    });

    if (webhook) {
      if (isSuccess) {
        // Reset consecutive failures on success
        if (webhook.consecutiveFailures > 0) {
          await prisma.webhook.update({
            where: { id: webhookId },
            data: { consecutiveFailures: 0 },
          });
        }
      } else {
        // Increment failure counter
        const nextFailures = webhook.consecutiveFailures + 1;
        const shouldDisable = nextFailures >= WEBHOOK_CONSTANTS.MAX_CONSECUTIVE_FAILURES;

        await prisma.webhook.update({
          where: { id: webhookId },
          data: {
            consecutiveFailures: nextFailures,
            ...(shouldDisable ? { active: false } : {}),
          },
        });

        if (shouldDisable) {
          autoDisabled = true;
          logger.warn(
            {
              webhookId,
              orgId,
              consecutiveFailures: nextFailures,
            },
            `Webhook auto-disabled after ${nextFailures} consecutive failed deliveries.`
          );
        }
      }
    }
  } catch (updateErr) {
    logger.error({ webhookId, err: updateErr }, "Failed to update webhook failure status");
  }

  return {
    success: isSuccess,
    statusCode,
    durationMs,
    error: errorMsg,
    autoDisabled,
  };
}
