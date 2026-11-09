import { Router } from "express";
import { authenticate } from "../middleware/authenticate";
import { tenantContext } from "../middleware/tenant-context";
import { tenantRateLimiter } from "../rate-limit";
import { authorize } from "../middleware/authorize";
import { auditController } from "./audit.controller";

export const auditLogRouter = Router();

auditLogRouter.get(
  "/",
  authenticate,
  tenantContext,
  tenantRateLimiter,
  authorize("audit_log:view"),
  (req, res, next) => auditController.list(req, res, next)
);
