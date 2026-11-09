import { WebhookEvent } from "../config/constants";

export interface WebhookSummary {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatedWebhookResult extends WebhookSummary {
  secret: string;
}

export interface WebhookDeliverySummary {
  id: string;
  webhookId: string;
  orgId: string;
  eventId: string;
  eventType: string;
  attempt: number;
  statusCode: number | null;
  durationMs: number;
  error: string | null;
  createdAt: Date;
}

export interface WebhookEventPayload<T = unknown> {
  id: string;
  event: WebhookEvent;
  createdAt: string;
  orgId: string;
  data: T;
}

export interface WebhookDeliveryJobData {
  webhookId: string;
  orgId: string;
  url: string;
  encryptedSecret: string;
  eventId: string;
  eventType: WebhookEvent;
  payload: WebhookEventPayload;
  attempt: number;
}
