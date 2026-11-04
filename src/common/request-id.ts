import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import pino from "pino";
import { logger } from "./logger";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      log: pino.Logger;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existingId = req.headers["x-request-id"];
  const requestId =
    typeof existingId === "string" && existingId.trim().length > 0
      ? existingId
      : `req_${uuidv4().replace(/-/g, "")}`;

  req.id = requestId;
  req.log = logger.child({ requestId });

  res.setHeader("X-Request-Id", requestId);
  next();
}
