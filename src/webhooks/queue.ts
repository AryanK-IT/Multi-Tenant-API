import { Queue, Worker, Job } from "bullmq";
import { env } from "../config/env";
import { WEBHOOK_CONSTANTS } from "../config/constants";
import { WebhookDeliveryJobData } from "./types";
import { executeDeliveryAttempt } from "./delivery";
import { logger } from "../common/logger";

export const WEBHOOK_QUEUE_NAME = "taskflow-webhook-deliveries";

export interface WebhookQueue {
  enqueue(jobData: WebhookDeliveryJobData): Promise<void>;
  close(): Promise<void>;
}

/**
 * BullMQ-backed webhook delivery queue for production and Redis environments (SRS §3.5 FR-19, FR-20).
 * Implements exponential backoff and up to 3 delivery attempts.
 */
export class BullMQWebhookQueue implements WebhookQueue {
  private queue: Queue<WebhookDeliveryJobData>;
  private worker: Worker<WebhookDeliveryJobData> | null = null;

  constructor(redisUrl: string = env.REDIS_URL) {
    // BullMQ requires maxRetriesPerRequest to be null on Redis connections
    const connection = {
      url: redisUrl,
      maxRetriesPerRequest: null,
    };

    this.queue = new Queue<WebhookDeliveryJobData>(WEBHOOK_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: WEBHOOK_CONSTANTS.MAX_ATTEMPTS, // 3 attempts total
        backoff: {
          type: "exponential",
          delay: 5000, // 5s initial backoff, then 10s, 20s...
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });

    try {
      this.worker = new Worker<WebhookDeliveryJobData>(
        WEBHOOK_QUEUE_NAME,
        async (job: Job<WebhookDeliveryJobData>) => {
          const attempt = job.attemptsMade + 1;
          const result = await executeDeliveryAttempt({
            ...job.data,
            attempt,
          });

          if (!result.success) {
            throw new Error(result.error ?? `Webhook delivery attempt ${attempt} failed.`);
          }

          return result;
        },
        {
          connection,
          concurrency: 5,
        }
      );

      this.worker.on("failed", (job, err) => {
        logger.warn(
          {
            jobId: job?.id,
            webhookId: job?.data.webhookId,
            eventId: job?.data.eventId,
            attemptsMade: job?.attemptsMade,
            err: err.message,
          },
          "Webhook delivery job attempt failed"
        );
      });
    } catch (workerErr) {
      logger.error({ err: workerErr }, "Failed to initialize BullMQ worker");
    }
  }

  async enqueue(jobData: WebhookDeliveryJobData): Promise<void> {
    await this.queue.add(`${jobData.eventType}:${jobData.eventId}`, jobData, {
      jobId: `${jobData.webhookId}:${jobData.eventId}`,
    });
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }
}

/**
 * In-memory fallback queue for testing or environments without a running Redis daemon.
 */
export class MemoryWebhookQueue implements WebhookQueue {
  public jobs: WebhookDeliveryJobData[] = [];
  public executeImmediately: boolean;

  constructor(executeImmediately = true) {
    this.executeImmediately = executeImmediately;
  }

  async enqueue(jobData: WebhookDeliveryJobData): Promise<void> {
    this.jobs.push(jobData);

    if (this.executeImmediately) {
      for (let attempt = 1; attempt <= WEBHOOK_CONSTANTS.MAX_ATTEMPTS; attempt++) {
        const result = await executeDeliveryAttempt({
          ...jobData,
          attempt,
        });

        if (result.success || result.autoDisabled) {
          break;
        }
      }
    }
  }

  async close(): Promise<void> {
    this.jobs = [];
  }
}

let activeQueue: WebhookQueue | null = null;

export function getWebhookQueue(): WebhookQueue {
  if (!activeQueue) {
    // In test environment, default to MemoryWebhookQueue for deterministic tests
    if (env.NODE_ENV === "test") {
      activeQueue = new MemoryWebhookQueue(true);
    } else {
      activeQueue = new BullMQWebhookQueue();
    }
  }
  return activeQueue;
}

export function setWebhookQueue(queue: WebhookQueue | null): void {
  activeQueue = queue;
}
