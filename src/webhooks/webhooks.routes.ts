import { Router } from "express";
import { webhooksController } from "./webhooks.controller";
import { authenticate } from "../middleware/authenticate";
import { tenantContext } from "../middleware/tenant-context";
import { tenantRateLimiter } from "../rate-limit";
import { authorize } from "../middleware/authorize";
import { validateBody, validateQuery } from "../middleware/validate";
import {
  createWebhookSchema,
  updateWebhookSchema,
  listWebhooksQuerySchema,
  listDeliveriesQuerySchema,
} from "./schemas";

export const webhooksRouter = Router();

webhooksRouter.use(authenticate);
webhooksRouter.use(tenantContext);
webhooksRouter.use(tenantRateLimiter);

webhooksRouter.post(
  "/",
  authorize("webhooks:manage"),
  validateBody(createWebhookSchema),
  (req, res, next) => webhooksController.create(req, res, next)
);

webhooksRouter.get(
  "/",
  authorize("webhooks:manage"),
  validateQuery(listWebhooksQuerySchema),
  (req, res, next) => webhooksController.list(req, res, next)
);

webhooksRouter.get("/:id", authorize("webhooks:manage"), (req, res, next) =>
  webhooksController.get(req, res, next)
);

webhooksRouter.patch(
  "/:id",
  authorize("webhooks:manage"),
  validateBody(updateWebhookSchema),
  (req, res, next) => webhooksController.update(req, res, next)
);

webhooksRouter.delete("/:id", authorize("webhooks:manage"), (req, res, next) =>
  webhooksController.delete(req, res, next)
);

webhooksRouter.get(
  "/:id/deliveries",
  authorize("webhooks:manage"),
  validateQuery(listDeliveriesQuerySchema),
  (req, res, next) => webhooksController.listDeliveries(req, res, next)
);
