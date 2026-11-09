import { Router } from "express";
import { authenticate } from "../middleware/authenticate";
import { tenantContext } from "../middleware/tenant-context";
import { tenantRateLimiter } from "../rate-limit";
import { authorize } from "../middleware/authorize";
import { validate } from "../middleware/validate";
import { createTaskSchema, updateTaskSchema } from "./schemas";
import { tasksController } from "./tasks.controller";

/**
 * Router mounted at `/projects/:projectId/tasks`
 */
export const projectTasksRouter = Router({ mergeParams: true });

projectTasksRouter.post(
  "/",
  authenticate,
  tenantContext,
  tenantRateLimiter,
  authorize("tasks:create"),
  validate(createTaskSchema),
  (req, res, next) => tasksController.create(req, res, next)
);

projectTasksRouter.get(
  "/",
  authenticate,
  tenantContext,
  tenantRateLimiter,
  authorize("tasks:view"),
  (req, res, next) => tasksController.list(req, res, next)
);

/**
 * Router mounted at `/tasks`
 */
export const tasksRouter = Router();

tasksRouter.get(
  "/:id",
  authenticate,
  tenantContext,
  tenantRateLimiter,
  authorize("tasks:view"),
  (req, res, next) => tasksController.getById(req, res, next)
);

tasksRouter.patch(
  "/:id",
  authenticate,
  tenantContext,
  tenantRateLimiter,
  authorize("tasks:edit"),
  validate(updateTaskSchema),
  (req, res, next) => tasksController.update(req, res, next)
);

tasksRouter.delete("/:id", authenticate, tenantContext, tenantRateLimiter, (req, res, next) =>
  tasksController.delete(req, res, next)
);
