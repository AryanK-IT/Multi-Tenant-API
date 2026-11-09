import { z } from "zod";
import { TASK_STATUSES, TaskStatus } from "../config/constants";

export const taskStatusEnum = z.enum([
  TASK_STATUSES.TODO,
  TASK_STATUSES.IN_PROGRESS,
  TASK_STATUSES.DONE,
]);

export const createTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Task title is required")
    .max(200, "Task title cannot exceed 200 characters"),
  description: z
    .string()
    .trim()
    .max(2000, "Description cannot exceed 2000 characters")
    .optional()
    .nullable(),
  status: taskStatusEnum.optional().default(TASK_STATUSES.TODO),
  assigneeId: z.string().uuid("Invalid assignee ID").optional().nullable(),
});

export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Task title cannot be empty")
      .max(200, "Task title cannot exceed 200 characters")
      .optional(),
    description: z
      .string()
      .trim()
      .max(2000, "Description cannot exceed 2000 characters")
      .optional()
      .nullable(),
    status: taskStatusEnum.optional(),
    assigneeId: z.string().uuid("Invalid assignee ID").optional().nullable(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.status !== undefined ||
      data.assigneeId !== undefined,
    "At least one field must be provided for update"
  );

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const listTasksQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
  status: taskStatusEnum.optional(),
  assigneeId: z.string().optional(),
});

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

/**
 * Validates status transitions according to SRS §3.3 FR-13:
 * Allowed:
 *  todo -> in_progress
 *  in_progress -> todo, done
 *  done -> in_progress (reopen)
 *  same -> same (no-op)
 */
export function isValidStatusTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;

  switch (from) {
    case TASK_STATUSES.TODO:
      return to === TASK_STATUSES.IN_PROGRESS;
    case TASK_STATUSES.IN_PROGRESS:
      return to === TASK_STATUSES.TODO || to === TASK_STATUSES.DONE;
    case TASK_STATUSES.DONE:
      return to === TASK_STATUSES.IN_PROGRESS;
    default:
      return false;
  }
}
