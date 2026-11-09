import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { createTwoOrgFixture } from "../helpers/two-org-fixture";
import { apiKeysService } from "../../src/api-keys/api-keys.service";
import { NotFoundError } from "../../src/common/errors";

vi.mock("../../src/api-keys/api-keys.service");

describe("API Keys Management Endpoints (SRS §3.4 FR-15, FR-16, §3.8, Phase 6)", () => {
  const app = createApp();
  const { orgA } = createTwoOrgFixture();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/v1/api-keys (FR-15)", () => {
    it("returns 401 UNAUTHENTICATED when Authorization header is missing", async () => {
      const res = await request(app)
        .post("/api/v1/api-keys")
        .send({ name: "My Key", scope: "read" });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 403 FORBIDDEN when a Member attempts to create an API key", async () => {
      const res = await request(app)
        .post("/api/v1/api-keys")
        .set("Authorization", `Bearer ${orgA.member.token}`)
        .send({ name: "Member Key", scope: "read" });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("returns 201 CREATED when Owner creates an API key with raw key returned", async () => {
      vi.mocked(apiKeysService.createApiKey).mockResolvedValueOnce({
        id: "key-uuid-1",
        name: "Owner Production Key",
        prefix: "0123456789abcdef",
        scope: "read_write",
        createdById: orgA.owner.id,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date("2026-11-08T10:00:00.000Z"),
        key: "tf_0123456789abcdef_00112233445566778899aabbccddeeff0011223344556677",
      });

      const res = await request(app)
        .post("/api/v1/api-keys")
        .set("Authorization", `Bearer ${orgA.owner.token}`)
        .send({ name: "Owner Production Key", scope: "read_write" });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe("key-uuid-1");
      expect(res.body.name).toBe("Owner Production Key");
      expect(res.body.scope).toBe("read_write");
      expect(res.body.key).toMatch(/^tf_[a-f0-9]{16}_[a-f0-9]{48}$/);
      expect(apiKeysService.createApiKey).toHaveBeenCalledWith(
        orgA.id,
        orgA.owner.id,
        expect.objectContaining({ name: "Owner Production Key", scope: "read_write" }),
        expect.any(String)
      );
    });

    it("returns 201 CREATED when Admin creates an API key", async () => {
      vi.mocked(apiKeysService.createApiKey).mockResolvedValueOnce({
        id: "key-uuid-2",
        name: "Admin Read Key",
        prefix: "abcdef0123456789",
        scope: "read",
        createdById: orgA.admin.id,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date("2026-11-08T10:00:00.000Z"),
        key: "tf_abcdef0123456789_00112233445566778899aabbccddeeff0011223344556677",
      });

      const res = await request(app)
        .post("/api/v1/api-keys")
        .set("Authorization", `Bearer ${orgA.admin.token}`)
        .send({ name: "Admin Read Key", scope: "read" });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe("key-uuid-2");
      expect(res.body.scope).toBe("read");
    });

    it("returns 400 VALIDATION_ERROR when name is empty", async () => {
      const res = await request(app)
        .post("/api/v1/api-keys")
        .set("Authorization", `Bearer ${orgA.owner.token}`)
        .send({ name: "", scope: "read" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: "name" })])
      );
    });

    it("returns 400 VALIDATION_ERROR when scope is invalid", async () => {
      const res = await request(app)
        .post("/api/v1/api-keys")
        .set("Authorization", `Bearer ${orgA.owner.token}`)
        .send({ name: "Valid Name", scope: "superadmin" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 VALIDATION_ERROR when expiresAt is in the past", async () => {
      const res = await request(app)
        .post("/api/v1/api-keys")
        .set("Authorization", `Bearer ${orgA.owner.token}`)
        .send({
          name: "Expired Key",
          scope: "read",
          expiresAt: "2020-01-01T00:00:00.000Z",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("GET /api/v1/api-keys (FR-16)", () => {
    it("returns 401 UNAUTHENTICATED when Authorization header is missing", async () => {
      const res = await request(app).get("/api/v1/api-keys");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 403 FORBIDDEN when a Member attempts to list API keys", async () => {
      const res = await request(app)
        .get("/api/v1/api-keys")
        .set("Authorization", `Bearer ${orgA.member.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("returns 200 OK allowing Owner to list API keys", async () => {
      vi.mocked(apiKeysService.listApiKeys).mockResolvedValueOnce({
        data: [
          {
            id: "key-1",
            name: "Key 1",
            prefix: "pref1",
            scope: "read",
            createdById: orgA.owner.id,
            expiresAt: null,
            revokedAt: null,
            lastUsedAt: null,
            createdAt: new Date("2026-11-08T10:00:00.000Z"),
          },
        ],
        nextCursor: null,
      });

      const res = await request(app)
        .get("/api/v1/api-keys")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].prefix).toBe("pref1");
      expect(res.body.data[0].hashedSecret).toBeUndefined();
    });

    it("returns 200 OK via alias /api-keys", async () => {
      vi.mocked(apiKeysService.listApiKeys).mockResolvedValueOnce({
        data: [],
        nextCursor: null,
      });

      const res = await request(app)
        .get("/api-keys")
        .set("Authorization", `Bearer ${orgA.admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe("DELETE /api/v1/api-keys/:id (FR-16)", () => {
    it("returns 401 UNAUTHENTICATED when Authorization header is missing", async () => {
      const res = await request(app).delete("/api/v1/api-keys/key-1");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 403 FORBIDDEN when a Member attempts to revoke an API key", async () => {
      const res = await request(app)
        .delete("/api/v1/api-keys/key-1")
        .set("Authorization", `Bearer ${orgA.member.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("returns 404 NOT_FOUND when API key is not found (ADR 2)", async () => {
      vi.mocked(apiKeysService.revokeApiKey).mockRejectedValueOnce(
        new NotFoundError("API key not found.")
      );

      const res = await request(app)
        .delete("/api/v1/api-keys/non-existent-key")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 200 OK when Owner successfully revokes an API key", async () => {
      vi.mocked(apiKeysService.revokeApiKey).mockResolvedValueOnce({
        message: "API key revoked successfully.",
      });

      const res = await request(app)
        .delete("/api/v1/api-keys/key-to-revoke")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("API key revoked successfully.");
      expect(apiKeysService.revokeApiKey).toHaveBeenCalledWith(
        orgA.id,
        "key-to-revoke",
        orgA.owner.id,
        expect.any(String)
      );
    });

    it("returns 200 OK when Admin successfully revokes an API key", async () => {
      vi.mocked(apiKeysService.revokeApiKey).mockResolvedValueOnce({
        message: "API key revoked successfully.",
      });

      const res = await request(app)
        .delete("/api/v1/api-keys/key-to-revoke-admin")
        .set("Authorization", `Bearer ${orgA.admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("API key revoked successfully.");
    });
  });
});
