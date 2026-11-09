import type Redis from "ioredis";
import { getRedisClient } from "../db/redis";
import { RateLimitResult, RateLimitStore } from "./types";

export const LUA_SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local clearBefore = now - window

-- Remove entries outside current sliding window
redis.call('ZREMRANGEBYSCORE', key, '-inf', clearBefore)

-- Count entries currently in the window
local currentCount = redis.call('ZCARD', key)

if currentCount < limit then
  -- Allowed: record current request and set TTL
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  local remaining = limit - currentCount - 1
  local resetAt = math.ceil((now + window) / 1000)
  return { 1, remaining, resetAt, 0 }
else
  -- Rate limited: find the oldest entry to calculate precise retry-after and reset timestamp
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfter = 1
  local resetAt = math.ceil((now + window) / 1000)
  if #oldest > 0 then
    local oldestScore = tonumber(oldest[2])
    retryAfter = math.max(1, math.ceil((oldestScore + window - now) / 1000))
    resetAt = math.ceil((oldestScore + window) / 1000)
  end
  return { 0, 0, resetAt, retryAfter }
end
`;

/**
 * Production Redis-backed sliding-window rate limiter using atomic Lua script.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private client: Redis;

  constructor(customClient?: Redis) {
    this.client = customClient || getRedisClient();
  }

  public async increment(
    key: string,
    windowMs: number,
    limit: number,
    nowMs: number = Date.now()
  ): Promise<RateLimitResult> {
    const member = `${nowMs}:${Math.random().toString(36).substring(2, 10)}`;

    const rawResult = (await this.client.eval(
      LUA_SLIDING_WINDOW_SCRIPT,
      1,
      key,
      String(nowMs),
      String(windowMs),
      String(limit),
      member
    )) as [number, number, number, number];

    const [allowedNum, remaining, resetAt, retryAfterSeconds] = rawResult;

    return {
      allowed: allowedNum === 1,
      limit,
      remaining: Math.max(0, Number(remaining)),
      resetAt: Number(resetAt),
      retryAfterSeconds: Number(retryAfterSeconds),
    };
  }

  public async reset(key: string): Promise<void> {
    await this.client.del(key);
  }

  public async clear(): Promise<void> {
    try {
      const keys = await this.client.keys("ratelimit:*");
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch {
      // In testing or when Redis is unavailable, swallow clear error
    }
  }
}

interface StoredEntry {
  timestamp: number;
  member: string;
}

/**
 * In-memory sliding-window rate limit store matching exact Lua script semantics.
 * Ideal for unit testing, integration tests, and local environments without Redis.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, StoredEntry[]>();

  public async increment(
    key: string,
    windowMs: number,
    limit: number,
    nowMs: number = Date.now()
  ): Promise<RateLimitResult> {
    const clearBefore = nowMs - windowMs;
    const member = `${nowMs}:${Math.random().toString(36).substring(2, 10)}`;

    const existing = this.store.get(key) || [];
    // Prune entries outside the sliding window
    const active = existing.filter((entry) => entry.timestamp > clearBefore);

    if (active.length < limit) {
      active.push({ timestamp: nowMs, member });
      this.store.set(key, active);
      const remaining = limit - active.length;
      const resetAt = Math.ceil((nowMs + windowMs) / 1000);
      return {
        allowed: true,
        limit,
        remaining,
        resetAt,
        retryAfterSeconds: 0,
      };
    }

    // Rate limited - persist active set to keep pruned entries clean
    this.store.set(key, active);
    const oldestTimestamp = active[0]?.timestamp ?? nowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestTimestamp + windowMs - nowMs) / 1000));
    const resetAt = Math.ceil((oldestTimestamp + windowMs) / 1000);

    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt,
      retryAfterSeconds,
    };
  }

  public async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  public async clear(): Promise<void> {
    this.store.clear();
  }

  public getActiveCount(key: string, windowMs: number, nowMs: number = Date.now()): number {
    const clearBefore = nowMs - windowMs;
    const existing = this.store.get(key) || [];
    return existing.filter((entry) => entry.timestamp > clearBefore).length;
  }
}

let activeRateLimitStore: RateLimitStore | null = null;

export function getRateLimitStore(): RateLimitStore {
  if (activeRateLimitStore) {
    return activeRateLimitStore;
  }
  if (process.env.NODE_ENV === "test") {
    activeRateLimitStore = new MemoryRateLimitStore();
    return activeRateLimitStore;
  }
  activeRateLimitStore = new RedisRateLimitStore();
  return activeRateLimitStore;
}

export function setRateLimitStore(store: RateLimitStore | null): void {
  activeRateLimitStore = store;
}
