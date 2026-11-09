import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response, NextFunction } from "express";
import {
  MemoryRateLimitStore,
  RedisRateLimitStore,
  createIpRateLimiter,
  createTenantRateLimiter,
  createOrgRateLimiter,
  createCredentialRateLimiter,
  extractClientIp,
} from "../../src/rate-limit";
import { RateLimitedError, ServiceUnavailableError } from "../../src/common/errors";

describe("Rate Limiting Unit Suite (Phase 7 - FR-22)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("MemoryRateLimitStore", () => {
    it("increments counters and computes remaining quota", async () => {
      const store = new MemoryRateLimitStore();
      const key = "test:org:org-1";
      const windowMs = 60000;
      const limit = 5;
      const now = 100000;

      const res1 = await store.increment(key, windowMs, limit, now);
      expect(res1.allowed).toBe(true);
      expect(res1.limit).toBe(5);
      expect(res1.remaining).toBe(4);
      expect(res1.resetAt).toBe(Math.ceil((now + windowMs) / 1000));
      expect(res1.retryAfterSeconds).toBe(0);

      const res2 = await store.increment(key, windowMs, limit, now + 1000);
      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(3);

      expect(store.getActiveCount(key, windowMs, now + 1000)).toBe(2);
    });

    it("blocks requests when limit is exhausted and returns retryAfterSeconds", async () => {
      const store = new MemoryRateLimitStore();
      const key = "test:cred:user-1";
      const windowMs = 60000;
      const limit = 2;
      const now = 100000;

      await store.increment(key, windowMs, limit, now);
      await store.increment(key, windowMs, limit, now + 500);

      const res3 = await store.increment(key, windowMs, limit, now + 1000);
      expect(res3.allowed).toBe(false);
      expect(res3.remaining).toBe(0);
      expect(res3.retryAfterSeconds).toBe(Math.ceil((now + windowMs - (now + 1000)) / 1000));
      expect(res3.resetAt).toBe(Math.ceil((now + windowMs) / 1000));
    });

    it("slides the window and prunes expired requests", async () => {
      const store = new MemoryRateLimitStore();
      const key = "test:sliding";
      const windowMs = 60000;
      const limit = 2;
      const now = 100000;

      // 2 requests in window
      await store.increment(key, windowMs, limit, now);
      await store.increment(key, windowMs, limit, now + 1000);

      // Immediately blocked
      const blocked = await store.increment(key, windowMs, limit, now + 2000);
      expect(blocked.allowed).toBe(false);

      // Fast forward past the first request's expiry (now + 60001)
      const afterFirstExpires = await store.increment(key, windowMs, limit, now + 60001);
      expect(afterFirstExpires.allowed).toBe(true);
      expect(afterFirstExpires.remaining).toBe(0); // 1 request still in window + this new one = 2

      // Fast forward past all prior requests
      const afterAllExpire = await store.increment(key, windowMs, limit, now + 130000);
      expect(afterAllExpire.allowed).toBe(true);
      expect(afterAllExpire.remaining).toBe(1);
    });

    it("resets and clears stored entries", async () => {
      const store = new MemoryRateLimitStore();
      await store.increment("key-1", 60000, 5);
      await store.increment("key-2", 60000, 5);

      await store.reset("key-1");
      expect(store.getActiveCount("key-1", 60000)).toBe(0);
      expect(store.getActiveCount("key-2", 60000)).toBe(1);

      await store.clear();
      expect(store.getActiveCount("key-2", 60000)).toBe(0);
    });
  });

  describe("RedisRateLimitStore", () => {
    it("delegates evaluation to Redis Lua script and parses result tuple", async () => {
      const mockEval = vi.fn().mockResolvedValue([1, 19, 1700000060, 0]);
      const mockDel = vi.fn().mockResolvedValue(1);
      const mockClient = { eval: mockEval, del: mockDel } as unknown as import("ioredis").default;

      const store = new RedisRateLimitStore(mockClient);
      const result = await store.increment("ratelimit:test", 60000, 20, 1700000000000);

      expect(mockEval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        "ratelimit:test",
        "1700000000000",
        "60000",
        "20",
        expect.any(String)
      );
      expect(result).toEqual({
        allowed: true,
        limit: 20,
        remaining: 19,
        resetAt: 1700000060,
        retryAfterSeconds: 0,
      });

      await store.reset("ratelimit:test");
      expect(mockDel).toHaveBeenCalledWith("ratelimit:test");
    });

    it("parses rate-limited responses from Redis correctly", async () => {
      const mockEval = vi.fn().mockResolvedValue([0, 0, 1700000060, 45]);
      const mockClient = { eval: mockEval } as unknown as import("ioredis").default;

      const store = new RedisRateLimitStore(mockClient);
      const result = await store.increment("ratelimit:test", 60000, 20);

      expect(result).toEqual({
        allowed: false,
        limit: 20,
        remaining: 0,
        resetAt: 1700000060,
        retryAfterSeconds: 45,
      });
    });

    it("propagates error when Redis client fails", async () => {
      const mockEval = vi.fn().mockRejectedValue(new Error("Redis connection lost"));
      const mockClient = { eval: mockEval } as unknown as import("ioredis").default;

      const store = new RedisRateLimitStore(mockClient);
      await expect(store.increment("ratelimit:test", 60000, 20)).rejects.toThrow(
        "Redis connection lost"
      );
    });
  });

  describe("extractClientIp helper", () => {
    it("extracts from x-forwarded-for string including proxies", () => {
      const req = {
        headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178" },
      } as unknown as Request;
      expect(extractClientIp(req)).toBe("203.0.113.195");
    });

    it("strips IPv6 ::ffff: prefix from mapped IPv4 addresses", () => {
      const req = {
        headers: {},
        ip: "::ffff:192.168.1.100",
      } as unknown as Request;
      expect(extractClientIp(req)).toBe("192.168.1.100");
    });

    it("falls back to socket remote address or 127.0.0.1", () => {
      const reqWithSocket = {
        headers: {},
        socket: { remoteAddress: "10.0.0.5" },
      } as unknown as Request;
      expect(extractClientIp(reqWithSocket)).toBe("10.0.0.5");

      const emptyReq = { headers: {} } as unknown as Request;
      expect(extractClientIp(emptyReq)).toBe("127.0.0.1");
    });
  });

  describe("createIpRateLimiter middleware", () => {
    const createMocks = (ip = "198.51.100.1") => {
      const req = {
        headers: { "x-forwarded-for": ip },
        log: { warn: vi.fn(), error: vi.fn() },
      } as unknown as Request;

      const headers: Record<string, string> = {};
      const res = {
        setHeader: vi.fn((k: string, v: string) => {
          headers[k] = v;
        }),
        getHeader: vi.fn((k: string) => headers[k]),
      } as unknown as Response;

      const next = vi.fn() as unknown as NextFunction;

      return { req, res, next, headers };
    };

    it("attaches rate limit headers and calls next() when under quota", async () => {
      const store = new MemoryRateLimitStore();
      const middleware = createIpRateLimiter({ store, limit: 3, windowMs: 60000 });
      const { req, res, next, headers } = createMocks();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(headers["X-RateLimit-Limit"]).toBe("3");
      expect(headers["X-RateLimit-Remaining"]).toBe("2");
      expect(headers["X-RateLimit-Reset"]).toBeDefined();
    });

    it("blocks request with RateLimitedError and Retry-After header when quota exceeded", async () => {
      const store = new MemoryRateLimitStore();
      const middleware = createIpRateLimiter({ store, limit: 1, windowMs: 60000 });
      const { req, res, next, headers } = createMocks();

      // First request passes
      await middleware(req, res, next);
      expect(next).toHaveBeenCalledWith();

      // Second request fails
      const nextFail = vi.fn();
      await middleware(req, res, nextFail);

      expect(nextFail).toHaveBeenCalledWith(expect.any(RateLimitedError));
      const err = nextFail.mock.calls[0][0] as RateLimitedError;
      expect(err.statusCode).toBe(429);
      expect(headers["Retry-After"]).toBeDefined();
      expect(headers["X-RateLimit-Remaining"]).toBe("0");
    });

    it("fails closed with 503 SERVICE_UNAVAILABLE when store fails on auth endpoint (SRS §3.6)", async () => {
      const failingStore = {
        increment: vi.fn().mockRejectedValue(new Error("Redis cluster offline")),
      };
      const middleware = createIpRateLimiter({
        store: failingStore,
        failClosed: true,
      });

      const { req, res, next } = createMocks();
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ServiceUnavailableError));
      const err = vi.mocked(next).mock.calls[0][0] as unknown as ServiceUnavailableError;
      expect(err.statusCode).toBe(503);
    });

    it("fails open and allows request through when failClosed is false", async () => {
      const failingStore = {
        increment: vi.fn().mockRejectedValue(new Error("Redis cluster offline")),
      };
      const middleware = createIpRateLimiter({
        store: failingStore,
        failClosed: false,
      });

      const { req, res, next } = createMocks();
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });
  });

  describe("createTenantRateLimiter middleware", () => {
    const createAuthMocks = (isApiKey = false) => {
      const req = {
        auth: {
          orgId: "org-alpha-123",
          userId: isApiKey ? undefined : "usr-bob-456",
          apiKeyId: isApiKey ? "key-secret-789" : undefined,
          isApiKey,
        },
        log: { warn: vi.fn(), error: vi.fn() },
      } as unknown as Request;

      const headers: Record<string, string> = {};
      const res = {
        setHeader: vi.fn((k: string, v: string) => {
          headers[k] = v;
        }),
        getHeader: vi.fn((k: string) => headers[k]),
      } as unknown as Response;

      const next = vi.fn() as unknown as NextFunction;

      return { req, res, next, headers };
    };

    it("skips rate limiting if request lacks auth context", async () => {
      const store = new MemoryRateLimitStore();
      const middleware = createTenantRateLimiter({ store });
      const req = { log: { warn: vi.fn() } } as unknown as Request;
      const res = { setHeader: vi.fn() } as unknown as Response;
      const next = vi.fn();

      await middleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(res.setHeader).not.toHaveBeenCalled();
    });

    it("enforces per-org rate limiting across all credentials", async () => {
      const store = new MemoryRateLimitStore();
      const middleware = createTenantRateLimiter({
        store,
        orgLimit: 2,
        credLimit: 10,
      });

      const user1 = createAuthMocks(false);
      user1.req.auth!.userId = "usr-1";

      const user2 = createAuthMocks(false);
      user2.req.auth!.userId = "usr-2";

      // User 1 uses 1 org budget
      await middleware(user1.req, user1.res, user1.next);
      expect(user1.next).toHaveBeenCalledWith();

      // User 2 uses 2nd org budget
      await middleware(user2.req, user2.res, user2.next);
      expect(user2.next).toHaveBeenCalledWith();

      // User 1 attempts 3rd request -> blocked by org budget
      const nextBlocked = vi.fn();
      await middleware(user1.req, user1.res, nextBlocked);

      expect(nextBlocked).toHaveBeenCalledWith(expect.any(RateLimitedError));
      const err = nextBlocked.mock.calls[0][0] as RateLimitedError;
      expect(err.message).toMatch(/Organization rate limit exceeded/);
    });

    it("enforces per-credential rate limiting preventing one user from hogging org quota", async () => {
      const store = new MemoryRateLimitStore();
      const middleware = createTenantRateLimiter({
        store,
        orgLimit: 100,
        credLimit: 2,
      });

      const userA = createAuthMocks(false);
      userA.req.auth!.userId = "usr-greedy";

      const userB = createAuthMocks(false);
      userB.req.auth!.userId = "usr-innocent";

      // User A uses up their 2 credential quota
      await middleware(userA.req, userA.res, userA.next);
      await middleware(userA.req, userA.res, userA.next);

      // User A is blocked on 3rd attempt
      const nextGreedy = vi.fn();
      await middleware(userA.req, userA.res, nextGreedy);
      expect(nextGreedy).toHaveBeenCalledWith(expect.any(RateLimitedError));
      const err = nextGreedy.mock.calls[0][0] as RateLimitedError;
      expect(err.message).toMatch(/Credential rate limit exceeded/);

      // User B in the same org can still make requests because org quota is not exhausted!
      await middleware(userB.req, userB.res, userB.next);
      expect(userB.next).toHaveBeenCalledWith();
    });

    it("tracks API keys independently by apiKeyId (FR-17, FR-22)", async () => {
      const store = new MemoryRateLimitStore();
      const middleware = createTenantRateLimiter({
        store,
        orgLimit: 50,
        credLimit: 1,
      });

      const keyA = createAuthMocks(true);
      keyA.req.auth!.apiKeyId = "key-alpha";

      const keyB = createAuthMocks(true);
      keyB.req.auth!.apiKeyId = "key-beta";

      // Key A uses its quota
      await middleware(keyA.req, keyA.res, keyA.next);
      expect(keyA.next).toHaveBeenCalledWith();

      // Key A blocked on 2nd attempt
      const nextKeyABlocked = vi.fn();
      await middleware(keyA.req, keyA.res, nextKeyABlocked);
      expect(nextKeyABlocked).toHaveBeenCalledWith(expect.any(RateLimitedError));

      // Key B has its own independent credential budget
      await middleware(keyB.req, keyB.res, keyB.next);
      expect(keyB.next).toHaveBeenCalledWith();
    });

    it("reports the most constrained quota in response headers", async () => {
      const store = new MemoryRateLimitStore();
      const middleware = createTenantRateLimiter({
        store,
        orgLimit: 1000,
        credLimit: 200,
      });

      const { req, res, next, headers } = createAuthMocks(false);
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
      // Credential limit (200) has remaining (199), which is lower than Org (1000 with remaining 999)
      expect(headers["X-RateLimit-Limit"]).toBe("200");
      expect(headers["X-RateLimit-Remaining"]).toBe("199");
    });

    it("fails open when store fails on general API endpoints per SRS §3.6", async () => {
      const failingStore = {
        increment: vi.fn().mockRejectedValue(new Error("Redis timeout")),
      };
      const middleware = createTenantRateLimiter({
        store: failingStore,
      });

      const { req, res, next } = createAuthMocks(false);
      await middleware(req, res, next);

      // Fails open: allows request through without throwing error
      expect(next).toHaveBeenCalledWith();
      expect(req.log.warn).toHaveBeenCalledTimes(2); // Warns for org tier and cred tier
    });
  });

  describe("createOrgRateLimiter and createCredentialRateLimiter standalone", () => {
    it("org rate limiter allows, blocks, and fails open", async () => {
      const store = new MemoryRateLimitStore();
      const middleware = createOrgRateLimiter({ store, limit: 1 });

      const req = {
        auth: { orgId: "org-1" },
        log: { warn: vi.fn() },
      } as unknown as Request;
      const res = { setHeader: vi.fn() } as unknown as Response;

      const next1 = vi.fn();
      await middleware(req, res, next1);
      expect(next1).toHaveBeenCalledWith();

      const next2 = vi.fn();
      await middleware(req, res, next2);
      expect(next2).toHaveBeenCalledWith(expect.any(RateLimitedError));

      // Fail open
      const failStore = { increment: vi.fn().mockRejectedValue(new Error("Down")) };
      const failMiddleware = createOrgRateLimiter({ store: failStore, failClosed: false });
      const next3 = vi.fn();
      await failMiddleware(req, res, next3);
      expect(next3).toHaveBeenCalledWith();
    });

    it("credential rate limiter allows, blocks, and fails open", async () => {
      const store = new MemoryRateLimitStore();
      const middleware = createCredentialRateLimiter({ store, limit: 1 });

      const req = {
        auth: { orgId: "org-1", userId: "u-1", isApiKey: false },
        log: { warn: vi.fn() },
      } as unknown as Request;
      const res = { setHeader: vi.fn() } as unknown as Response;

      const next1 = vi.fn();
      await middleware(req, res, next1);
      expect(next1).toHaveBeenCalledWith();

      const next2 = vi.fn();
      await middleware(req, res, next2);
      expect(next2).toHaveBeenCalledWith(expect.any(RateLimitedError));

      // Fail open
      const failStore = { increment: vi.fn().mockRejectedValue(new Error("Down")) };
      const failMiddleware = createCredentialRateLimiter({ store: failStore, failClosed: false });
      const next3 = vi.fn();
      await failMiddleware(req, res, next3);
      expect(next3).toHaveBeenCalledWith();
    });
  });
});
