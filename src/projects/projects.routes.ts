import { Router } from "express";
import { authenticate } from "../middleware/authenticate";
import { tenantContext } from "../middleware/tenant-context";
import { tenantRateLimiter } from "../rate-limit";
import { authorize } from "../middleware/authorize";
import { validate } from "../middleware/validate";
import { createProjectSchema, updateProjectSchema } from "./schemas";
import { projectsController } from "./projects.controller";
import { projectTasksRouter } from "../tasks/tasks.routes";

export const projectsRouter = Router();

// Nested tasks router: /projects/:projectId/tasks
projectsRouter.use("/:projectId/tasks", projectTasksRouter);

projectsRouter.post(
  "/",
  authenticate,
  tenantContext,
  tenantRateLimiter,
  authorize("projects:create"),
  validate(createProjectSchema),
  (req, res, next) => projectsController.create(req, res, next)
);

projectsRouter.get(
  "/",
  authenticate,
  tenantContext,
  tenantRateLimiter,
  authorize("projects:view"),
  (req, res, next) => projectsController.list(req, res, next)
);

projectsRouter.get(
  "/:id",
  authenticate,
  tenantContext,
  tenantRateLimiter,
  authorize("projects:view"),
  (req, res, next) => projectsController.getById(req, res, next)
);

projectsRouter.patch(
  "/:id",
  authenticate,
  tenantContext,
  tenantRateLimiter,
  authorize("projects:edit"),
  validate(updateProjectSchema),
  (req, res, next) => projectsController.update(req, res, next)
);

projectsRouter.delete(
  "/:id",
  authenticate,
  tenantContext,
  tenantRateLimiter,
  authorize("projects:delete"),
  (req, res, next) => projectsController.delete(req, res, next)
);
