import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { authService } from "../../src/auth/auth.service";
import { projectsService } from "../../src/projects/projects.service";
import { apiKeysService } from "../../src/api-keys/api-keys.service";
import { createTwoOrgFixture } from "../helpers/two-org-fixture";
import { MemoryRateLimitStore, setRateLimitStore } from "../../src/rate-limit";

vi.mock("../../src/auth/auth.service");
vi.mock("../../src/projects/projects.service");
vi.mock("../../src/api-keys/api-keys.service");

describe("Rate Limiting HTTP Integration Suite (Phase 7 - FR-22)", () => {
  let memoryStore: MemoryRateLimitStore;
  const { orgA } = createTwoOrgFixture();

  beforeEach(() => {
    vi.clearAllMocks();
    memoryStore = new MemoryRateLimitStore();
    setRateLimitStore(memoryStore);
  });

  describe("Tier 3: Per-IP Rate Limiting on Auth Endpoints", () => {
    it("returns X-RateLimit-* headers on successful auth endpoint requests", async () => {
      vi.mocked(authService.login).mockResolvedValueOnce({
        user: { id: orgA.owner.id, email: orgA.owner.email },
        org: { id: orgA.id, name: orgA.name },
        role: "owner",
        tokens: {
          accessToken: "sample.access.token",
          refreshToken: "sample.refresh.token",
          expiresIn: 900,
        },
      });

      const app = createApp({ rateLimitStore: memoryStore });

      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", "198.51.100.10")
        .send({
          email: "owner@alpha.test",
          password: "LongSecurePassword123!",
        });

      expect(res.status).toBe(200);
      expect(res.headers).toHaveProperty("x-ratelimit-limit", "20");
      expect(res.headers).toHaveProperty("x-ratelimit-remaining", "19");
      expect(res.headers).toHaveProperty("x-ratelimit-reset");
    });

    it("returns 429 RATE_LIMITED with Retry-After when IP budget is exceeded", async () => {
      // Simulate exhausting the 20 requests/min quota for this IP
      const testIp = "198.51.100.99";
      for (let i = 0; i < 20; i++) {
        await memoryStore.increment(`ratelimit:auth:ip:${testIp}`, 60000, 20);
      }

      const app = createApp({ rateLimitStore: memoryStore });

      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", testIp)
        .send({
          email: "owner@alpha.test",
          password: "LongSecurePassword123!",
        });

      expect(res.status).toBe(429);
      expect(res.headers).toHaveProperty("retry-after");
      expect(res.headers).toHaveProperty("x-ratelimit-remaining", "0");
      expect(res.body.error).toMatchObject({
        code: "RATE_LIMITED",
        message: "Too many authentication requests. Please try again later.",
      });
      expect(authService.login).not.toHaveBeenCalled();
    });

    it("isolates quotas across distinct client IP addresses", async () => {
      const ipA = "198.51.100.1";
      const ipB = "198.51.100.2";

      // Exhaust IP A
      for (let i = 0; i < 20; i++) {
        await memoryStore.increment(`ratelimit:auth:ip:${ipA}`, 60000, 20);
      }

      vi.mocked(authService.login).mockResolvedValueOnce({
        user: { id: orgA.owner.id, email: orgA.owner.email },
        org: { id: orgA.id, name: orgA.name },
        role: "owner",
        tokens: {
          accessToken: "token-b",
          refreshToken: "refresh-b",
          expiresIn: 900,
        },
      });

      const app = createApp({ rateLimitStore: memoryStore });

      // IP A receives 429
      const resA = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", ipA)
        .send({ email: "test@example.com", password: "Password12345!" });
      expect(resA.status).toBe(429);

      // IP B succeeds with fresh quota
      const resB = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", ipB)
        .send({ email: "test@example.com", password: "Password12345!" });
      expect(resB.status).toBe(200);
      expect(resB.headers["x-ratelimit-remaining"]).toBe("19");
    });

    it("fails closed returning 503 SERVICE_UNAVAILABLE when rate store fails on auth routes (SRS §3.6)", async () => {
      const failingStore = {
        increment: vi.fn().mockRejectedValue(new Error("Redis connection refused")),
      };

      const app = createApp({ rateLimitStore: failingStore as unknown as MemoryRateLimitStore });

      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", "198.51.100.50")
        .send({
          email: "owner@alpha.test",
          password: "LongSecurePassword123!",
        });

      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        message: "Service temporarily unavailable. Please try again later.",
      });
    });
  });

  describe("Tiers 1 & 2: Per-Org and Per-Credential Rate Limiting on Authenticated Routes", () => {
    it("returns rate limit headers on successful authenticated requests", async () => {
      vi.mocked(projectsService.listProjects).mockResolvedValueOnce({
        data: [],
        nextCursor: null,
      });

      const app = createApp({ rateLimitStore: memoryStore });

      const res = await request(app)
        .get("/api/v1/projects")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(200);
      expect(res.headers).toHaveProperty("x-ratelimit-limit", "200"); // Credential quota is default bottleneck
      expect(res.headers).toHaveProperty("x-ratelimit-remaining", "199");
      expect(res.headers).toHaveProperty("x-ratelimit-reset");
    });

    it("blocks request with 429 when credential quota is exhausted", async () => {
      // Pre-fill user credential budget to limit (200)
      const credKey = `ratelimit:cred:user:${orgA.member.id}`;
      for (let i = 0; i < 200; i++) {
        await memoryStore.increment(credKey, 60000, 200);
      }

      const app = createApp({ rateLimitStore: memoryStore });

      const res = await request(app)
        .get("/api/v1/projects")
        .set("Authorization", `Bearer ${orgA.member.token}`);

      expect(res.status).toBe(429);
      expect(res.headers).toHaveProperty("retry-after");
      expect(res.headers).toHaveProperty("x-ratelimit-remaining", "0");
      expect(res.body.error).toMatchObject({
        code: "RATE_LIMITED",
        message: "Credential rate limit exceeded. Please try again later.",
      });
      expect(projectsService.listProjects).not.toHaveBeenCalled();
    });

    it("blocks request with 429 when organization quota is exhausted", async () => {
      // Pre-fill organization budget to limit (1000)
      const orgKey = `ratelimit:org:${orgA.id}`;
      for (let i = 0; i < 1000; i++) {
        await memoryStore.increment(orgKey, 60000, 1000);
      }

      const app = createApp({ rateLimitStore: memoryStore });

      const res = await request(app)
        .get("/api/v1/projects")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(429);
      expect(res.headers).toHaveProperty("retry-after");
      expect(res.headers).toHaveProperty("x-ratelimit-limit", "1000");
      expect(res.headers).toHaveProperty("x-ratelimit-remaining", "0");
      expect(res.body.error).toMatchObject({
        code: "RATE_LIMITED",
        message: "Organization rate limit exceeded. Please try again later.",
      });
      expect(projectsService.listProjects).not.toHaveBeenCalled();
    });

    it("applies per-credential limiting to API keys by apiKeyId", async () => {
      const apiKey = "tf_0123456789abcdef_secret999999999999999999999999999999999999";
      const apiKeyId = "key-integration-test-1";

      vi.mocked(apiKeysService.verifyAndAuthenticateKey).mockResolvedValue({
        apiKeyId,
        orgId: orgA.id,
        scope: "read",
        createdById: orgA.owner.id,
        name: "Test API Key",
        prefix: "0123456789abcdef",
      });

      // Pre-fill API key credential budget (200)
      const credKey = `ratelimit:cred:key:${apiKeyId}`;
      for (let i = 0; i < 200; i++) {
        await memoryStore.increment(credKey, 60000, 200);
      }

      const app = createApp({ rateLimitStore: memoryStore });

      const res = await request(app)
        .get("/api/v1/projects")
        .set("Authorization", `Bearer ${apiKey}`);

      expect(res.status).toBe(429);
      expect(res.body.error).toMatchObject({
        code: "RATE_LIMITED",
        message: "Credential rate limit exceeded. Please try again later.",
      });
    });

    it("fails open and allows authenticated requests through when rate limit store is down (SRS §3.6)", async () => {
      const failingStore = {
        increment: vi.fn().mockRejectedValue(new Error("Redis connection dropped")),
      };

      vi.mocked(projectsService.listProjects).mockResolvedValueOnce({
        data: [
          {
            id: "proj-1",
            name: "High Priority",
            description: null,
            orgId: orgA.id,
            createdById: orgA.owner.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        nextCursor: null,
      });

      const app = createApp({ rateLimitStore: failingStore as unknown as MemoryRateLimitStore });

      const res = await request(app)
        .get("/api/v1/projects")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      // General API endpoint fails open!
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(projectsService.listProjects).toHaveBeenCalled();
    });
  });
});
