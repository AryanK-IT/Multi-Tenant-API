export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: unknown[];

  constructor(statusCode: number, code: string, message: string, details: unknown[] = []) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details: unknown[] = []) {
    super(400, "VALIDATION_ERROR", message, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Authentication required") {
    super(401, "UNAUTHENTICATED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(403, "FORBIDDEN", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(404, "NOT_FOUND", message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource conflict") {
    super(409, "CONFLICT", message);
  }
}

export class InvalidStatusTransitionError extends AppError {
  constructor(message = "Invalid status transition", details: unknown[] = []) {
    super(422, "INVALID_STATUS_TRANSITION", message, details);
  }
}

export class RateLimitedError extends AppError {
  public readonly retryAfterSeconds?: number;

  constructor(
    message = "Rate limit exceeded. Please try again later.",
    retryAfterSeconds?: number
  ) {
    super(429, "RATE_LIMITED", message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class InternalServerError extends AppError {
  constructor(message = "An unexpected error occurred.") {
    super(500, "INTERNAL_SERVER_ERROR", message);
  }
}
