import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { Request, Response, NextFunction } from "express";
import {
  ValidationError,
  UnauthenticatedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InvalidStatusTransitionError,
  RateLimitedError,
  InternalServerError,
} from "../../src/common/errors";
import { formatErrorEnvelope, errorHandler } from "../../src/common/error-envelope";
import { requestIdMiddleware } from "../../src/common/request-id";

describe("Common Error Classes", () => {
  it("creates ValidationError with 400 status and details", () => {
    const error = new ValidationError("Invalid payload", [{ field: "name" }]);
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("Invalid payload");
    expect(error.details).toEqual([{ field: "name" }]);
  });

  it("creates UnauthenticatedError with 401 status", () => {
    const error = new UnauthenticatedError();
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe("UNAUTHENTICATED");
  });

  it("creates ForbiddenError with 403 status", () => {
    const error = new ForbiddenError();
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe("FORBIDDEN");
  });

  it("creates NotFoundError with 404 status", () => {
    const error = new NotFoundError("Project not found");
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Project not found");
  });

  it("creates ConflictError with 409 status", () => {
    const error = new ConflictError("Project name already exists");
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe("CONFLICT");
  });

  it("creates InvalidStatusTransitionError with 422 status", () => {
    const error = new InvalidStatusTransitionError("Cannot move directly from todo to done");
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("creates RateLimitedError with 429 status and retryAfter", () => {
    const error = new RateLimitedError("Too many requests", 30);
    expect(error.statusCode).toBe(429);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAfterSeconds).toBe(30);
  });

  it("creates InternalServerError with 500 status", () => {
    const error = new InternalServerError();
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});

describe("Error Envelope Formatter", () => {
  const reqId = "req_test123";

  it("formats AppError into the SRS error envelope specification", () => {
    const appErr = new ForbiddenError("You do not have permission to perform this action.");
    const { statusCode, envelope } = formatErrorEnvelope(appErr, reqId);

    expect(statusCode).toBe(403);
    expect(envelope).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "You do not have permission to perform this action.",
        details: [],
        requestId: reqId,
      },
    });
  });

  it("formats ZodError into VALIDATION_ERROR envelope with field details", () => {
    const schema = z.object({ email: z.string().email() });
    const parsed = schema.safeParse({ email: "invalid-email" });
    if (parsed.success) throw new Error("Expected parse failure");

    const { statusCode, envelope } = formatErrorEnvelope(parsed.error, reqId);
    expect(statusCode).toBe(400);
    expect(envelope.error.code).toBe("VALIDATION_ERROR");
    expect(envelope.error.requestId).toBe(reqId);
    expect(envelope.error.details.length).toBeGreaterThan(0);
  });

  it("formats generic unknown error as 500 INTERNAL_SERVER_ERROR", () => {
    const genericErr = new Error("Database crashed");
    const { statusCode, envelope } = formatErrorEnvelope(genericErr, reqId);

    expect(statusCode).toBe(500);
    expect(envelope.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(envelope.error.requestId).toBe(reqId);
  });
});

describe("Request ID Middleware", () => {
  it("generates a new request id and sets X-Request-Id header when missing", () => {
    const req = { headers: {} } as unknown as Request;
    const res = {
      setHeader: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    requestIdMiddleware(req, res, next);

    expect(req.id).toMatch(/^req_/);
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-Id", req.id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("preserves incoming X-Request-Id header", () => {
    const req = {
      headers: { "x-request-id": "client_req_999" },
    } as unknown as Request;
    const res = {
      setHeader: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    requestIdMiddleware(req, res, next);

    expect(req.id).toBe("client_req_999");
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-Id", "client_req_999");
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("Express Error Handler Middleware", () => {
  it("sends JSON error envelope and status code to client", () => {
    const req = {
      id: "req_handler_test",
      log: { warn: vi.fn(), error: vi.fn() },
    } as unknown as Request;
    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    const res = { status: statusMock } as unknown as Response;
    const next = vi.fn() as NextFunction;

    const notFoundErr = new NotFoundError("Task not found");
    errorHandler(notFoundErr, req, res, next);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({
      error: {
        code: "NOT_FOUND",
        message: "Task not found",
        details: [],
        requestId: "req_handler_test",
      },
    });
  });
});
