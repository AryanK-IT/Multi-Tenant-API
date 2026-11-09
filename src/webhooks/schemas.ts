import { z } from "zod";
import { ALL_WEBHOOK_EVENTS, WebhookEvent } from "../config/constants";

export const webhookEventEnum = z.enum(ALL_WEBHOOK_EVENTS as [WebhookEvent, ...WebhookEvent[]]);

export const createWebhookSchema = z.object({
  url: z
    .string()
    .url("Invalid URL format.")
    .max(2048, "Webhook URL cannot exceed 2048 characters."),
  events: z
    .array(webhookEventEnum)
    .min(1, "At least one event must be selected.")
    .refine((items) => new Set(items).size === items.length, {
      message: "Duplicate events are not allowed in subscription.",
    }),
});

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = z
  .object({
    url: z
      .string()
      .url("Invalid URL format.")
      .max(2048, "Webhook URL cannot exceed 2048 characters.")
      .optional(),
    events: z
      .array(webhookEventEnum)
      .min(1, "At least one event must be selected.")
      .refine((items) => new Set(items).size === items.length, {
        message: "Duplicate events are not allowed in subscription.",
      })
      .optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (data) => data.url !== undefined || data.events !== undefined || data.active !== undefined,
    {
      message: "At least one field (url, events, or active) must be provided for update.",
    }
  );

export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;

export const listWebhooksQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});

export type ListWebhooksQuery = z.infer<typeof listWebhooksQuerySchema>;

export const listDeliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});

export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuerySchema>;
