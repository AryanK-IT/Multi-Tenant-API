import { Router } from "express";
import { apiKeysController } from "./api-keys.controller";
import { authenticate } from "../middleware/authenticate";
import { tenantContext } from "../middleware/tenant-context";
import { tenantRateLimiter } from "../rate-limit";
import { authorize } from "../middleware/authorize";
import { validateBody, validateQuery } from "../middleware/validate";
import { createApiKeySchema, listApiKeysQuerySchema } from "./schemas";

export const apiKeysRouter = Router();

apiKeysRouter.use(authenticate);
apiKeysRouter.use(tenantContext);
apiKeysRouter.use(tenantRateLimiter);

apiKeysRouter.post(
  "/",
  authorize("api_keys:manage"),
  validateBody(createApiKeySchema),
  (req, res, next) => apiKeysController.create(req, res, next)
);

apiKeysRouter.get(
  "/",
  authorize("api_keys:manage"),
  validateQuery(listApiKeysQuerySchema),
  (req, res, next) => apiKeysController.list(req, res, next)
);

apiKeysRouter.delete("/:id", authorize("api_keys:manage"), (req, res, next) =>
  apiKeysController.revoke(req, res, next)
);
