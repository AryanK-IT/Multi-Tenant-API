import { z } from "zod";
import { API_KEY_SCOPES } from "../config/constants";

export const createApiKeySchema = z.object({
  name: z
    .string({ required_error: "Name is required." })
    .trim()
    .min(1, "Name is required.")
    .max(100, "Name must not exceed 100 characters."),
  scope: z
    .enum([API_KEY_SCOPES.READ, API_KEY_SCOPES.READ_WRITE], {
      errorMap: () => ({ message: "Scope must be either 'read' or 'read_write'." }),
    })
    .default(API_KEY_SCOPES.READ),
  expiresAt: z
    .string()
    .datetime({ message: "expiresAt must be a valid ISO-8601 date string." })
    .refine((val) => new Date(val).getTime() > Date.now(), {
      message: "expiresAt must be a future date.",
    })
    .optional()
    .nullable(),
});

export const listApiKeysQuerySchema = z.object({
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

export const revokeApiKeyParamsSchema = z.object({
  id: z.string().min(1, "API key ID is required."),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type ListApiKeysQuery = z.infer<typeof listApiKeysQuerySchema>;
