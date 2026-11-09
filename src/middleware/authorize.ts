import { Request, Response, NextFunction } from "express";
import { Action, assertPermission, PolicyContext, Principal } from "../policies";
import { UnauthenticatedError } from "../common/errors";

export type ContextExtractor = (req: Request) => PolicyContext;

export function authorize(action: Action, contextExtractor?: ContextExtractor) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      return next(new UnauthenticatedError("Authentication required."));
    }

    if (!req.auth.isApiKey && (!req.auth.role || !req.auth.userId)) {
      return next(new UnauthenticatedError("Invalid authentication context."));
    }

    const principal: Principal = req.auth.isApiKey
      ? { type: "api_key", scope: req.auth.apiKeyScope || "read" }
      : { type: "user", role: req.auth.role!, userId: req.auth.userId! };

    const context = contextExtractor ? contextExtractor(req) : undefined;

    try {
      assertPermission(principal, action, context);
      next();
    } catch (err) {
      next(err);
    }
  };
}
