import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiKeysService } from "../../src/api-keys/api-keys.service";
import { prisma } from "../../src/db/client";
import { auditService } from "../../src/audit/audit.service";
import { NotFoundError, UnauthenticatedError } from "../../src/common/errors";
import { hashApiKeySecret } from "../../src/api-keys/key-utils";
import { AUDIT_ACTIONS, ACTOR_TYPES } from "../../src/config/constants";

vi.mock("../../src/db/client", () => ({
  prisma: {
    apiKey: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../src/audit/audit.service", () => ({
  auditService: {
    logAction: vi.fn(),
  },
}));

describe("ApiKeysService (SRS §3.4 FR-15, FR-16, FR-17, §3.7)", () => {
  let service: ApiKeysService;
  const orgId = "11111111-1111-4111-8111-111111111111";
  const userId = "usr-owner-id";

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ApiKeysService();
  });

  describe("createApiKey (FR-15)", () => {
    it("creates an API key with default scope 'read' and logs audit action", async () => {
      const mockCreatedApiKey = {
        id: "key-123",
        orgId,
        name: "Test Read Key",
        prefix: "0123456789abcdef",
        hashedSecret: "dummyhash",
        scope: "read",
        createdById: userId,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date("2026-11-08T10:00:00.000Z"),
      };

      vi.mocked(prisma.apiKey.create).mockResolvedValueOnce(mockCreatedApiKey as never);
      vi.mocked(auditService.logAction).mockResolvedValueOnce({} as never);

      const result = await service.createApiKey(
        orgId,
        userId,
        {
          name: "Test Read Key",
          scope: "read",
        },
        "127.0.0.1"
      );

      expect(prisma.apiKey.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orgId,
          name: "Test Read Key",
          scope: "read",
          createdById: userId,
          expiresAt: null,
        }),
      });

      expect(auditService.logAction).toHaveBeenCalledWith({
        orgId,
        actorType: ACTOR_TYPES.USER,
        actorId: userId,
        action: AUDIT_ACTIONS.API_KEY_CREATED,
        targetType: "api_key",
        targetId: "key-123",
        metadata: expect.objectContaining({
          name: "Test Read Key",
          scope: "read",
          expiresAt: null,
        }),
        ip: "127.0.0.1",
      });

      expect(result.id).toBe("key-123");
      expect(result.scope).toBe("read");
      expect(result.key).toMatch(/^tf_[a-f0-9]{16}_[a-f0-9]{48}$/);
    });

    it("creates an API key with read_write scope and an expiration date", async () => {
      const futureDate = new Date(Date.now() + 86400000 * 30); // 30 days
      const mockCreatedApiKey = {
        id: "key-rw-1",
        orgId,
        name: "CI Key",
        prefix: "abcdef0123456789",
        hashedSecret: "dummyhash",
        scope: "read_write",
        createdById: userId,
        expiresAt: futureDate,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
      };

      vi.mocked(prisma.apiKey.create).mockResolvedValueOnce(mockCreatedApiKey as never);
      vi.mocked(auditService.logAction).mockResolvedValueOnce({} as never);

      const result = await service.createApiKey(orgId, userId, {
        name: "CI Key",
        scope: "read_write",
        expiresAt: futureDate.toISOString(),
      });

      expect(result.id).toBe("key-rw-1");
      expect(result.scope).toBe("read_write");
      expect(result.expiresAt).toEqual(futureDate);
    });
  });

  describe("listApiKeys (FR-16)", () => {
    it("lists tenant API keys with cursor pagination and never exposes hashedSecret", async () => {
      const mockKeys = [
        {
          id: "key-1",
          name: "Key 1",
          prefix: "prefix1",
          scope: "read",
          createdById: userId,
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: new Date("2026-11-08T10:00:00.000Z"),
        },
      ];

      vi.mocked(prisma.apiKey.findMany).mockResolvedValueOnce(mockKeys as never);

      const result = await service.listApiKeys(orgId, { limit: "10" });

      expect(prisma.apiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId }),
          select: expect.objectContaining({
            id: true,
            name: true,
            prefix: true,
            scope: true,
            createdById: true,
            expiresAt: true,
            revokedAt: true,
            lastUsedAt: true,
            createdAt: true,
          }),
        })
      );

      // Verify hashedSecret was not in select
      const selectArg = vi.mocked(prisma.apiKey.findMany).mock.calls[0][0]?.select as Record<
        string,
        unknown
      >;
      expect(selectArg.hashedSecret).toBeUndefined();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe("key-1");
      expect(result.nextCursor).toBeNull();
    });
  });

  describe("revokeApiKey (FR-16)", () => {
    it("revokes an existing API key and logs audit action", async () => {
      const existingKey = {
        id: "key-to-revoke",
        orgId,
        name: "Old Key",
        prefix: "pref123",
        hashedSecret: "hash",
      };

      vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce(existingKey as never);
      vi.mocked(prisma.apiKey.update).mockResolvedValueOnce({
        ...existingKey,
        revokedAt: new Date(),
      } as never);
      vi.mocked(auditService.logAction).mockResolvedValueOnce({} as never);

      const result = await service.revokeApiKey(orgId, "key-to-revoke", userId, "192.168.1.1");

      expect(prisma.apiKey.findFirst).toHaveBeenCalledWith({
        where: { id: "key-to-revoke", orgId },
      });
      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: "key-to-revoke" },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      });
      expect(auditService.logAction).toHaveBeenCalledWith({
        orgId,
        actorType: ACTOR_TYPES.USER,
        actorId: userId,
        action: AUDIT_ACTIONS.API_KEY_REVOKED,
        targetType: "api_key",
        targetId: "key-to-revoke",
        metadata: {
          name: "Old Key",
          prefix: "pref123",
        },
        ip: "192.168.1.1",
      });
      expect(result.message).toBe("API key revoked successfully.");
    });

    it("throws NotFoundError when key does not belong to the organization (ADR 2)", async () => {
      vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce(null);

      await expect(service.revokeApiKey(orgId, "non-existent-key", userId)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe("verifyAndAuthenticateKey (FR-17)", () => {
    const validSecret = "a1b2c3d4e5f60718a1b2c3d4e5f60718a1b2c3d4e5f60718";
    const validPrefix = "0123456789abcdef";
    const validKey = `tf_${validPrefix}_${validSecret}`;
    const storedHashedSecret = hashApiKeySecret(validSecret);

    it("successfully validates and authenticates a valid key", async () => {
      const mockKey = {
        id: "key-auth-1",
        orgId,
        name: "Production Service Key",
        prefix: validPrefix,
        hashedSecret: storedHashedSecret,
        scope: "read_write",
        createdById: userId,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
      };

      vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce(mockKey as never);
      vi.mocked(prisma.apiKey.update).mockResolvedValueOnce({} as never);

      const authenticated = await service.verifyAndAuthenticateKey(validKey);

      expect(authenticated).toEqual({
        apiKeyId: "key-auth-1",
        orgId,
        scope: "read_write",
        createdById: userId,
        name: "Production Service Key",
        prefix: validPrefix,
      });
    });

    it("throws UnauthenticatedError for invalid API key format", async () => {
      await expect(service.verifyAndAuthenticateKey("invalid-key-format")).rejects.toThrow(
        UnauthenticatedError
      );
      await expect(service.verifyAndAuthenticateKey("tf_onlyprefix")).rejects.toThrow(
        UnauthenticatedError
      );
    });

    it("throws UnauthenticatedError when key prefix is not found in database", async () => {
      vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce(null);

      await expect(service.verifyAndAuthenticateKey(validKey)).rejects.toThrow(
        UnauthenticatedError
      );
    });

    it("throws UnauthenticatedError when key has been revoked", async () => {
      vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce({
        id: "key-revoked",
        orgId,
        prefix: validPrefix,
        hashedSecret: storedHashedSecret,
        revokedAt: new Date(),
        expiresAt: null,
      } as never);

      await expect(service.verifyAndAuthenticateKey(validKey)).rejects.toThrow(
        "API key has been revoked."
      );
    });

    it("throws UnauthenticatedError when key is expired", async () => {
      vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce({
        id: "key-expired",
        orgId,
        prefix: validPrefix,
        hashedSecret: storedHashedSecret,
        revokedAt: null,
        expiresAt: new Date(Date.now() - 10000), // in the past
      } as never);

      await expect(service.verifyAndAuthenticateKey(validKey)).rejects.toThrow(
        "API key has expired."
      );
    });

    it("throws UnauthenticatedError when secret is incorrect", async () => {
      vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce({
        id: "key-wrong-secret",
        orgId,
        prefix: validPrefix,
        hashedSecret: storedHashedSecret,
        revokedAt: null,
        expiresAt: null,
      } as never);

      const wrongSecretKey = `tf_${validPrefix}_wrongsecretwrongsecretwrongsecretwrongsecretwrong`;
      await expect(service.verifyAndAuthenticateKey(wrongSecretKey)).rejects.toThrow(
        "Invalid API key."
      );
    });

    it("throttles lastUsedAt update: triggers update when lastUsedAt > 60s ago", async () => {
      const pastTime = new Date(Date.now() - 65000); // 65 seconds ago (> 60s)
      vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce({
        id: "key-throttled",
        orgId,
        prefix: validPrefix,
        hashedSecret: storedHashedSecret,
        scope: "read",
        createdById: userId,
        revokedAt: null,
        expiresAt: null,
        lastUsedAt: pastTime,
      } as never);
      vi.mocked(prisma.apiKey.update).mockResolvedValueOnce({} as never);

      await service.verifyAndAuthenticateKey(validKey);

      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: "key-throttled" },
        data: { lastUsedAt: expect.any(Date) },
      });
    });

    it("throttles lastUsedAt update: skips update when lastUsedAt < 60s ago", async () => {
      const recentTime = new Date(Date.now() - 20000); // 20 seconds ago (< 60s)
      vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce({
        id: "key-recent",
        orgId,
        prefix: validPrefix,
        hashedSecret: storedHashedSecret,
        scope: "read",
        createdById: userId,
        revokedAt: null,
        expiresAt: null,
        lastUsedAt: recentTime,
      } as never);

      await service.verifyAndAuthenticateKey(validKey);

      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });
  });
});
