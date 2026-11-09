import { z } from "zod";
import { ACTOR_TYPES } from "../config/constants";

export const actorTypeEnum = z.enum([ACTOR_TYPES.USER, ACTOR_TYPES.API_KEY, ACTOR_TYPES.SYSTEM]);

export const listAuditLogsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
  actorId: z.string().optional(),
  actorType: actorTypeEnum.optional(),
  action: z.string().optional(),
  startDate: z
    .string()
    .refine((val) => !Number.isNaN(Date.parse(val)), {
      message: "startDate must be a valid ISO-8601 date string",
    })
    .optional(),
  endDate: z
    .string()
    .refine((val) => !Number.isNaN(Date.parse(val)), {
      message: "endDate must be a valid ISO-8601 date string",
    })
    .optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
