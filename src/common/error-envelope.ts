import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { logger } from "./logger";

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: unknown[];
    requestId: string;
  };
}

export function formatErrorEnvelope(
  err: unknown,
  requestId: string
): { statusCode: number; envelope: ErrorEnvelope } {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      envelope: {
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
          requestId,
        },
      },
    };
  }

  if (err instanceof ZodError) {
    const formattedDetails = err.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));

    return {
      statusCode: 400,
      envelope: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: formattedDetails,
          requestId,
        },
      },
    };
  }

  // Generic or unexpected error
  return {
    statusCode: 500,
    envelope: {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected internal server error occurred.",
        details: [],
        requestId,
      },
    },
  };
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  const requestId = req.id || "req_unknown";
  const { statusCode, envelope } = formatErrorEnvelope(err, requestId);

  const reqLogger = req.log || logger;
  if (statusCode >= 500) {
    reqLogger.error({ err, statusCode, envelope }, "Unhandled error encountered");
  } else {
    reqLogger.warn({ statusCode, envelope }, "Handled client error response");
  }

  res.status(statusCode).json(envelope);
}
