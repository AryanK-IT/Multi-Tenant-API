import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import { authService } from "../../src/auth/auth.service";
import { prisma } from "../../src/db/client";
import { hashToken } from "../../src/auth/tokens";
import { emailService } from "../../src/auth/email.service";
import {
  ConflictError,
  UnauthenticatedError,
  ForbiddenError,
  ValidationError,
} from "../../src/common/errors";

vi.mock("../../src/db/client", () => {
  return {
    prisma: {
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      org: {
        create: vi.fn(),
      },
      orgMembership: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      refreshToken: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      passwordResetToken: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn((callback) => callback(prisma)),
    },
  };
});

describe("AuthService Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("signup", () => {
    it("throws ConflictError if email is already registered", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: "existing-user",
        email: "test@example.com",
        passwordHash: "hash",
        createdAt: new Date(),
      });

      await expect(
        authService.signup({
          email: "test@example.com",
          password: "SecurePassword123",
          orgName: "Acme",
        })
      ).rejects.toThrow(ConflictError);
    });

    it("creates user, org, owner membership, and returns tokens on success", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.user.create).mockResolvedValueOnce({
        id: "new-user-id",
        email: "new@example.com",
        passwordHash: "hashed",
        createdAt: new Date(),
      });
      vi.mocked(prisma.org.create).mockResolvedValueOnce({
        id: "new-org-id",
        name: "Acme Corp",
        createdAt: new Date(),
      });

      const result = await authService.signup({
        email: "new@example.com",
        password: "ValidPassword123!",
        orgName: "Acme Corp",
      });

      expect(result.user.email).toBe("new@example.com");
      expect(result.org.name).toBe("Acme Corp");
      expect(result.role).toBe("owner");
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
      expect(result.tokens.expiresIn).toBe(900);
    });
  });

  describe("login", () => {
    it("throws UnauthenticatedError when user does not exist", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      await expect(
        authService.login({
          email: "unknown@example.com",
          password: "password123",
        })
      ).rejects.toThrow(UnauthenticatedError);
    });

    it("throws UnauthenticatedError when password does not match", async () => {
      const passwordHash = await bcrypt.hash("correct-password", 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: "u-1",
        email: "user@example.com",
        passwordHash,
        createdAt: new Date(),
        // @ts-expect-error mock relation
        memberships: [],
      });

      await expect(
        authService.login({
          email: "user@example.com",
          password: "wrong-password",
        })
      ).rejects.toThrow(UnauthenticatedError);
    });

    it("throws ForbiddenError when user has no active memberships", async () => {
      const passwordHash = await bcrypt.hash("correct-password", 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: "u-1",
        email: "user@example.com",
        passwordHash,
        createdAt: new Date(),
        // @ts-expect-error mock relation
        memberships: [],
      });

      await expect(
        authService.login({
          email: "user@example.com",
          password: "correct-password",
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it("throws ValidationError when user belongs to multiple orgs and orgId is omitted", async () => {
      const passwordHash = await bcrypt.hash("correct-password", 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: "u-1",
        email: "multi@example.com",
        passwordHash,
        createdAt: new Date(),
        // @ts-expect-error mock relation
        memberships: [
          { orgId: "org-1", role: "admin", org: { id: "org-1", name: "Org 1" } },
          { orgId: "org-2", role: "member", org: { id: "org-2", name: "Org 2" } },
        ],
      });

      await expect(
        authService.login({
          email: "multi@example.com",
          password: "correct-password",
        })
      ).rejects.toThrow(ValidationError);
    });

    it("succeeds and infers single org when exactly one membership exists", async () => {
      const passwordHash = await bcrypt.hash("correct-password", 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: "u-1",
        email: "single@example.com",
        passwordHash,
        createdAt: new Date(),
        // @ts-expect-error mock relation
        memberships: [
          { orgId: "org-single", role: "owner", org: { id: "org-single", name: "Single Org" } },
        ],
      });

      const result = await authService.login({
        email: "single@example.com",
        password: "correct-password",
      });

      expect(result.org.id).toBe("org-single");
      expect(result.role).toBe("owner");
      expect(result.tokens.accessToken).toBeDefined();
    });
  });

  describe("refresh token rotation & reuse detection (FR-3)", () => {
    it("throws UnauthenticatedError when refresh token is unknown", async () => {
      vi.mocked(prisma.refreshToken.findFirst).mockResolvedValueOnce(null);

      await expect(authService.refresh("non-existent-token")).rejects.toThrow(UnauthenticatedError);
    });

    it("detects reuse of already-rotated token, revoking entire family", async () => {
      const rawToken = "already-rotated-token";
      const tokenHash = hashToken(rawToken);

      vi.mocked(prisma.refreshToken.findFirst).mockResolvedValueOnce({
        id: "tok-old",
        userId: "u-1",
        orgId: "org-1",
        familyId: "fam-stolen",
        tokenHash,
        expiresAt: new Date(Date.now() + 100000),
        revokedAt: new Date(),
        replacedById: "tok-new-replacement", // was already replaced!
        createdAt: new Date(),
      });

      await expect(authService.refresh(rawToken)).rejects.toThrow(/Refresh token reuse detected/);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: "fam-stolen" },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("rejects revoked refresh token", async () => {
      vi.mocked(prisma.refreshToken.findFirst).mockResolvedValueOnce({
        id: "tok-revoked",
        userId: "u-1",
        orgId: "org-1",
        familyId: "fam-1",
        tokenHash: "hash",
        expiresAt: new Date(Date.now() + 100000),
        revokedAt: new Date(),
        replacedById: null,
        createdAt: new Date(),
      });

      await expect(authService.refresh("some-token")).rejects.toThrow(
        /Refresh token has been revoked/
      );
    });

    it("rejects expired refresh token", async () => {
      vi.mocked(prisma.refreshToken.findFirst).mockResolvedValueOnce({
        id: "tok-expired",
        userId: "u-1",
        orgId: "org-1",
        familyId: "fam-1",
        tokenHash: "hash",
        expiresAt: new Date(Date.now() - 100000), // in the past
        revokedAt: null,
        replacedById: null,
        createdAt: new Date(),
      });

      await expect(authService.refresh("some-token")).rejects.toThrow(/Refresh token has expired/);
    });

    it("successfully rotates valid refresh token and re-reads active membership", async () => {
      const rawToken = "valid-active-token";
      const tokenHash = hashToken(rawToken);

      vi.mocked(prisma.refreshToken.findFirst).mockResolvedValueOnce({
        id: "tok-valid",
        userId: "u-1",
        orgId: "org-1",
        familyId: "fam-active",
        tokenHash,
        expiresAt: new Date(Date.now() + 100000),
        revokedAt: null,
        replacedById: null,
        createdAt: new Date(),
      });

      vi.mocked(prisma.orgMembership.findUnique).mockResolvedValueOnce({
        userId: "u-1",
        orgId: "org-1",
        role: "admin",
        createdAt: new Date(),
      });

      vi.mocked(prisma.refreshToken.create).mockResolvedValueOnce({
        id: "tok-next",
        userId: "u-1",
        orgId: "org-1",
        familyId: "fam-active",
        tokenHash: "next-hash",
        expiresAt: new Date(),
        revokedAt: null,
        replacedById: null,
        createdAt: new Date(),
      });

      const result = await authService.refresh(rawToken);

      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "tok-valid" },
          data: expect.objectContaining({
            replacedById: "tok-next",
          }),
        })
      );
    });
  });

  describe("logout", () => {
    it("marks active token as revoked", async () => {
      const raw = "logout-tok";
      vi.mocked(prisma.refreshToken.findFirst).mockResolvedValueOnce({
        id: "tok-logout-id",
        userId: "u-1",
        orgId: "org-1",
        familyId: "fam-1",
        tokenHash: hashToken(raw),
        expiresAt: new Date(),
        revokedAt: null,
        replacedById: null,
        createdAt: new Date(),
      });

      await authService.logout(raw);

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: "tok-logout-id" },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe("password reset flow (FR-4)", () => {
    it("requestPasswordReset creates token and sends email when user exists", async () => {
      const emailSpy = vi.spyOn(emailService, "sendPasswordResetEmail").mockResolvedValue();

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: "u-reset",
        email: "user@example.com",
        passwordHash: "hash",
        createdAt: new Date(),
      });

      const res = await authService.requestPasswordReset("user@example.com");

      expect(res.message).toContain("If that email address is registered");
      expect(prisma.passwordResetToken.create).toHaveBeenCalled();
      expect(emailSpy).toHaveBeenCalledWith("user@example.com", expect.any(String));
    });

    it("resetPassword throws ValidationError for invalid or expired token", async () => {
      vi.mocked(prisma.passwordResetToken.findFirst).mockResolvedValueOnce(null);

      await expect(
        authService.resetPassword({
          token: "invalid-token",
          newPassword: "BrandNewPassword123!",
        })
      ).rejects.toThrow(ValidationError);
    });

    it("resetPassword updates password, marks token used, and revokes all user sessions", async () => {
      vi.mocked(prisma.passwordResetToken.findFirst).mockResolvedValueOnce({
        id: "reset-tok-id",
        userId: "u-reset-target",
        tokenHash: "token-hash",
        expiresAt: new Date(Date.now() + 10000),
        usedAt: null,
        createdAt: new Date(),
      });

      const res = await authService.resetPassword({
        token: "valid-reset-token",
        newPassword: "FreshPassword123!",
      });

      expect(res.message).toContain("Password has been successfully reset");
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "u-reset-target" },
        })
      );
      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: "reset-tok-id" },
        data: { usedAt: expect.any(Date) },
      });
      // Verifies all refresh tokens are revoked on password reset (FR-4)
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: "u-reset-target", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
