import { Request, Response, NextFunction } from "express";
import { RATE_LIMIT_CONSTANTS } from "../config/constants";
import { RateLimitedError, ServiceUnavailableError } from "../common/errors";
import { logger } from "../common/logger";
import { getRateLimitStore } from "./sliding-window";
import {
  IpRateLimiterOptions,
  TenantRateLimiterOptions,
  OrgRateLimiterOptions,
  CredentialRateLimiterOptions,
  RateLimitResult,
} from "./types";

/**
 * Extracts and sanitizes the client IP address from the request.
 * Handles reverse-proxy headers (X-Forwarded-For) and strips IPv6 prefix.
 */
export function extractClientIp(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string") {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return sanitizeIp(firstIp);
    }
  } else if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    const firstIp = forwardedFor[0]?.split(",")[0]?.trim();
    if (firstIp) {
      return sanitizeIp(firstIp);
    }
  }

  if (req.ip) {
    return sanitizeIp(req.ip);
  }

  if (req.socket?.remoteAddress) {
    return sanitizeIp(req.socket.remoteAddress);
  }

  return "127.0.0.1";
}

function sanitizeIp(ip: string): string {
  return ip.replace(/^::ffff:/, "").trim();
}

/**
 * Factory for unauthenticated IP-based rate limiting (Tier 3 in SRS FR-22).
 * Applied to auth endpoints (login, signup, refresh, reset, invite/accept).
 * Fails closed if Redis is down for brute-force protection.
 */
export function createIpRateLimiter(options: IpRateLimiterOptions = {}) {
  const limit = options.limit ?? RATE_LIMIT_CONSTANTS.AUTH_PER_IP.LIMIT;
  const windowMs = options.windowMs ?? RATE_LIMIT_CONSTANTS.AUTH_PER_IP.WINDOW_MS;
  const keyPrefix = options.keyPrefix ?? "ratelimit:auth:ip:";
  const failClosed = options.failClosed ?? RATE_LIMIT_CONSTANTS.AUTH_PER_IP.FAIL_CLOSED;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const store = options.store ?? getRateLimitStore();
    const ip = extractClientIp(req);
    const key = `${keyPrefix}${ip}`;

    try {
      const result = await store.increment(key, windowMs, limit);

      if (!result.allowed) {
        res.setHeader("Retry-After", String(result.retryAfterSeconds));
        res.setHeader("X-RateLimit-Limit", String(result.limit));
        res.setHeader("X-RateLimit-Remaining", "0");
        res.setHeader("X-RateLimit-Reset", String(result.resetAt));

        const reqLog = req.log || logger;
        reqLog.warn(
          { ip, key, limit: result.limit, retryAfter: result.retryAfterSeconds },
          "Auth endpoint IP rate limit exceeded"
        );

        return next(
          new RateLimitedError(
            "Too many authentication requests. Please try again later.",
            result.retryAfterSeconds
          )
        );
      }

      res.setHeader("X-RateLimit-Limit", String(result.limit));
      res.setHeader("X-RateLimit-Remaining", String(result.remaining));
      res.setHeader("X-RateLimit-Reset", String(result.resetAt));
      return next();
    } catch (err) {
      const reqLog = req.log || logger;
      if (failClosed) {
        reqLog.error(
          { err: (err as Error).message, ip, key },
          "Rate limit store unavailable for auth endpoint; failing closed per SRS §3.6"
        );
        return next(
          new ServiceUnavailableError("Service temporarily unavailable. Please try again later.")
        );
      }

      reqLog.warn(
        { err: (err as Error).message, ip, key },
        "Rate limit store unavailable; failing open per configuration"
      );
      return next();
    }
  };
}

/**
 * Factory for combined Tenant rate limiting (Per-Org and Per-Credential tiers).
 * Enforces:
 *  1. Per-org budget across all credentials (1000 req/min default)
 *  2. Per-credential budget (user or API key, 200 req/min default)
 * Both tiers fail open if Redis is unavailable per SRS §3.6.
 */
export function createTenantRateLimiter(options: TenantRateLimiterOptions = {}) {
  const orgLimit = options.orgLimit ?? RATE_LIMIT_CONSTANTS.PER_ORG.LIMIT;
  const credLimit = options.credLimit ?? RATE_LIMIT_CONSTANTS.PER_CREDENTIAL.LIMIT;
  const windowMs = options.windowMs ?? RATE_LIMIT_CONSTANTS.PER_ORG.WINDOW_MS;
  const orgKeyPrefix = options.orgKeyPrefix ?? "ratelimit:org:";
  const credKeyPrefix = options.credKeyPrefix ?? "ratelimit:cred:";

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // If auth or tenant context is not set, bypass
    if (!req.auth || !req.auth.orgId) {
      return next();
    }

    const store = options.store ?? getRateLimitStore();
    const reqLog = req.log || logger;
    const orgId = req.auth.orgId;

    // 1. Per-Org rate limit check
    const orgKey = `${orgKeyPrefix}${orgId}`;
    let orgResult: RateLimitResult;

    try {
      orgResult = await store.increment(orgKey, windowMs, orgLimit);
    } catch (err) {
      reqLog.warn(
        { err: (err as Error).message, orgId, key: orgKey },
        "Rate limit store unavailable for organization tier; failing open per SRS §3.6"
      );
      orgResult = {
        allowed: true,
        limit: orgLimit,
        remaining: orgLimit,
        resetAt: Math.ceil((Date.now() + windowMs) / 1000),
        retryAfterSeconds: 0,
      };
    }

    if (!orgResult.allowed) {
      res.setHeader("Retry-After", String(orgResult.retryAfterSeconds));
      res.setHeader("X-RateLimit-Limit", String(orgResult.limit));
      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader("X-RateLimit-Reset", String(orgResult.resetAt));

      reqLog.warn(
        { orgId, limit: orgResult.limit, retryAfter: orgResult.retryAfterSeconds },
        "Organization rate limit exceeded"
      );

      return next(
        new RateLimitedError(
          "Organization rate limit exceeded. Please try again later.",
          orgResult.retryAfterSeconds
        )
      );
    }

    // 2. Per-Credential rate limit check (distinguishing user vs API key)
    const credIdentifier = req.auth.isApiKey
      ? `key:${req.auth.apiKeyId ?? "unknown"}`
      : `user:${req.auth.userId ?? "unknown"}`;
    const credKey = `${credKeyPrefix}${credIdentifier}`;
    let credResult: RateLimitResult;

    try {
      credResult = await store.increment(credKey, windowMs, credLimit);
    } catch (err) {
      reqLog.warn(
        { err: (err as Error).message, credIdentifier, key: credKey },
        "Rate limit store unavailable for credential tier; failing open per SRS §3.6"
      );
      credResult = {
        allowed: true,
        limit: credLimit,
        remaining: credLimit,
        resetAt: Math.ceil((Date.now() + windowMs) / 1000),
        retryAfterSeconds: 0,
      };
    }

    if (!credResult.allowed) {
      res.setHeader("Retry-After", String(credResult.retryAfterSeconds));
      res.setHeader("X-RateLimit-Limit", String(credResult.limit));
      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader("X-RateLimit-Reset", String(credResult.resetAt));

      reqLog.warn(
        {
          credIdentifier,
          orgId,
          limit: credResult.limit,
          retryAfter: credResult.retryAfterSeconds,
        },
        "Credential rate limit exceeded"
      );

      return next(
        new RateLimitedError(
          "Credential rate limit exceeded. Please try again later.",
          credResult.retryAfterSeconds
        )
      );
    }

    // 3. Both tiers allowed - set rate limit headers based on the most constrained quota
    const bottleneck = credResult.remaining <= orgResult.remaining ? credResult : orgResult;
    res.setHeader("X-RateLimit-Limit", String(bottleneck.limit));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, bottleneck.remaining)));
    res.setHeader("X-RateLimit-Reset", String(bottleneck.resetAt));

    return next();
  };
}

/**
 * Factory for dedicated Per-Org rate limiting.
 */
export function createOrgRateLimiter(options: OrgRateLimiterOptions = {}) {
  const limit = options.limit ?? RATE_LIMIT_CONSTANTS.PER_ORG.LIMIT;
  const windowMs = options.windowMs ?? RATE_LIMIT_CONSTANTS.PER_ORG.WINDOW_MS;
  const keyPrefix = options.keyPrefix ?? "ratelimit:org:";
  const failClosed = options.failClosed ?? RATE_LIMIT_CONSTANTS.PER_ORG.FAIL_CLOSED;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.auth || !req.auth.orgId) {
      return next();
    }

    const store = options.store ?? getRateLimitStore();
    const reqLog = req.log || logger;
    const orgId = req.auth.orgId;
    const key = `${keyPrefix}${orgId}`;

    try {
      const result = await store.increment(key, windowMs, limit);

      if (!result.allowed) {
        res.setHeader("Retry-After", String(result.retryAfterSeconds));
        res.setHeader("X-RateLimit-Limit", String(result.limit));
        res.setHeader("X-RateLimit-Remaining", "0");
        res.setHeader("X-RateLimit-Reset", String(result.resetAt));

        return next(
          new RateLimitedError(
            "Organization rate limit exceeded. Please try again later.",
            result.retryAfterSeconds
          )
        );
      }

      res.setHeader("X-RateLimit-Limit", String(result.limit));
      res.setHeader("X-RateLimit-Remaining", String(result.remaining));
      res.setHeader("X-RateLimit-Reset", String(result.resetAt));
      return next();
    } catch (err) {
      if (failClosed) {
        reqLog.error({ err, key }, "Rate limit store unavailable; failing closed");
        return next(
          new ServiceUnavailableError("Service temporarily unavailable. Please try again later.")
        );
      }

      reqLog.warn({ err, key }, "Rate limit store unavailable; failing open per SRS §3.6");
      return next();
    }
  };
}

/**
 * Factory for dedicated Per-Credential rate limiting.
 */
export function createCredentialRateLimiter(options: CredentialRateLimiterOptions = {}) {
  const limit = options.limit ?? RATE_LIMIT_CONSTANTS.PER_CREDENTIAL.LIMIT;
  const windowMs = options.windowMs ?? RATE_LIMIT_CONSTANTS.PER_CREDENTIAL.WINDOW_MS;
  const keyPrefix = options.keyPrefix ?? "ratelimit:cred:";
  const failClosed = options.failClosed ?? RATE_LIMIT_CONSTANTS.PER_CREDENTIAL.FAIL_CLOSED;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.auth) {
      return next();
    }

    const store = options.store ?? getRateLimitStore();
    const reqLog = req.log || logger;
    const credIdentifier = req.auth.isApiKey
      ? `key:${req.auth.apiKeyId ?? "unknown"}`
      : `user:${req.auth.userId ?? "unknown"}`;
    const key = `${keyPrefix}${credIdentifier}`;

    try {
      const result = await store.increment(key, windowMs, limit);

      if (!result.allowed) {
        res.setHeader("Retry-After", String(result.retryAfterSeconds));
        res.setHeader("X-RateLimit-Limit", String(result.limit));
        res.setHeader("X-RateLimit-Remaining", "0");
        res.setHeader("X-RateLimit-Reset", String(result.resetAt));

        return next(
          new RateLimitedError(
            "Credential rate limit exceeded. Please try again later.",
            result.retryAfterSeconds
          )
        );
      }

      res.setHeader("X-RateLimit-Limit", String(result.limit));
      res.setHeader("X-RateLimit-Remaining", String(result.remaining));
      res.setHeader("X-RateLimit-Reset", String(result.resetAt));
      return next();
    } catch (err) {
      if (failClosed) {
        reqLog.error({ err, key }, "Rate limit store unavailable; failing closed");
        return next(
          new ServiceUnavailableError("Service temporarily unavailable. Please try again later.")
        );
      }

      reqLog.warn({ err, key }, "Rate limit store unavailable; failing open per SRS §3.6");
      return next();
    }
  };
}

/**
 * Singleton rate limiter middlewares with production defaults.
 */
export const authRateLimiter = createIpRateLimiter();
export const tenantRateLimiter = createTenantRateLimiter();
export const orgRateLimiter = createOrgRateLimiter();
export const credentialRateLimiter = createCredentialRateLimiter();
