export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // Unix timestamp in seconds when the window resets
  retryAfterSeconds: number; // Seconds to wait before retrying (0 when allowed)
}

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
  keyPrefix?: string;
  failClosed?: boolean;
}

export interface RateLimitStore {
  increment(key: string, windowMs: number, limit: number, nowMs?: number): Promise<RateLimitResult>;
  reset?(key: string): Promise<void>;
  clear?(): Promise<void>;
}

export interface IpRateLimiterOptions {
  store?: RateLimitStore;
  limit?: number;
  windowMs?: number;
  keyPrefix?: string;
  failClosed?: boolean;
}

export interface TenantRateLimiterOptions {
  store?: RateLimitStore;
  orgLimit?: number;
  credLimit?: number;
  windowMs?: number;
  orgKeyPrefix?: string;
  credKeyPrefix?: string;
}

export interface OrgRateLimiterOptions {
  store?: RateLimitStore;
  limit?: number;
  windowMs?: number;
  keyPrefix?: string;
  failClosed?: boolean;
}

export interface CredentialRateLimiterOptions {
  store?: RateLimitStore;
  limit?: number;
  windowMs?: number;
  keyPrefix?: string;
  failClosed?: boolean;
}
