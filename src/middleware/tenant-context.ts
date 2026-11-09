import { Request, Response, NextFunction } from "express";
import { UnauthenticatedError } from "../common/errors";

export interface TenantContext {
  orgId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: TenantContext;
    }
  }
}

export function tenantContext(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth || !req.auth.orgId) {
    return next(new UnauthenticatedError("Tenant context could not be resolved."));
  }

  req.tenant = {
    orgId: req.auth.orgId,
  };

  next();
}
