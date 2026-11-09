import { describe, it, expect, vi, beforeEach } from "vitest";
import { authService } from "../../src/auth/auth.service";
import { prisma } from "../../src/db/client";
import { hashToken } from "../../src/auth/tokens";
import { ValidationError, ForbiddenError, ConflictError } from "../../src/common/errors";

vi.mock("../../src/db/client", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    org: {
      create: vi.fn(),
    },
    orgMembership: {
      create: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
    },
    invitation: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => {
      if (typeof cb === "function") {
        return cb(prisma);
      }
      return cb;
    }),
  },
}));

describe("AuthService Invitation Flow Unit Tests", () => {
  const inviteToken = "secret-invite-token";
  const inviteTokenHash = hashToken(inviteToken);
  const orgId = "org-target";
  const userEmail = "invited@example.com";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("signup with invitationToken", () => {
    it("successfully creates user and joins the invited org with invited role", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.invitation.findFirst).mockResolvedValueOnce({
        id: "inv-1",
        orgId,
        email: userEmail,
        role: "admin",
        tokenHash: inviteTokenHash,
        revokedAt: null,
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        org: { id: orgId, name: "Inviting Org" },
      } as never);

      vi.mocked(prisma.user.create).mockResolvedValueOnce({
        id: "usr-new",
        email: userEmail,
        passwordHash: "hashed",
      } as never);

      const result = await authService.signup({
        email: userEmail,
        password: "LongSecurePassword123!",
        invitationToken: inviteToken,
      });

      expect(result.user.email).toBe(userEmail);
      expect(result.org.id).toBe(orgId);
      expect(result.role).toBe("admin");
      expect(result.tokens.accessToken).toBeDefined();
      expect(prisma.invitation.update).toHaveBeenCalledWith({
        where: { id: "inv-1" },
        data: { acceptedAt: expect.any(Date) },
      });
      expect(prisma.orgMembership.create).toHaveBeenCalledWith({
        data: {
          userId: "usr-new",
          orgId,
          role: "admin",
        },
      });
    });

    it("rejects signup when invitation token is invalid or expired", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.invitation.findFirst).mockResolvedValueOnce(null);

      await expect(
        authService.signup({
          email: userEmail,
          password: "LongSecurePassword123!",
          invitationToken: "invalid-token",
        })
      ).rejects.toThrow(ValidationError);
    });

    it("rejects signup when invitation was issued for another email", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.invitation.findFirst).mockResolvedValueOnce({
        id: "inv-1",
        orgId,
        email: "different@example.com",
        role: "member",
        revokedAt: null,
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        org: { id: orgId, name: "Inviting Org" },
      } as never);

      await expect(
        authService.signup({
          email: userEmail,
          password: "LongSecurePassword123!",
          invitationToken: inviteToken,
        })
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("acceptInvitation for existing authenticated user", () => {
    it("successfully creates membership and returns auth tokens", async () => {
      vi.mocked(prisma.invitation.findFirst).mockResolvedValueOnce({
        id: "inv-1",
        orgId,
        email: userEmail,
        role: "member",
        tokenHash: inviteTokenHash,
        revokedAt: null,
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        org: { id: orgId, name: "Inviting Org" },
      } as never);

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: "usr-existing",
        email: userEmail,
        memberships: [{ orgId: "other-org", role: "owner" }],
      } as never);

      const result = await authService.acceptInvitation("usr-existing", inviteToken);

      expect(result.message).toBe("Invitation accepted successfully.");
      expect(result.org.id).toBe(orgId);
      expect(result.role).toBe("member");
      expect(result.tokens.accessToken).toBeDefined();
      expect(prisma.invitation.update).toHaveBeenCalledWith({
        where: { id: "inv-1" },
        data: { acceptedAt: expect.any(Date) },
      });
      expect(prisma.orgMembership.create).toHaveBeenCalledWith({
        data: {
          userId: "usr-existing",
          orgId,
          role: "member",
        },
      });
    });

    it("rejects when token is invalid or expired", async () => {
      vi.mocked(prisma.invitation.findFirst).mockResolvedValueOnce(null);

      await expect(authService.acceptInvitation("usr-existing", "invalid-token")).rejects.toThrow(
        ValidationError
      );
    });

    it("rejects when invitation was issued for another email", async () => {
      vi.mocked(prisma.invitation.findFirst).mockResolvedValueOnce({
        id: "inv-1",
        orgId,
        email: "someone-else@example.com",
        role: "member",
        revokedAt: null,
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        org: { id: orgId, name: "Inviting Org" },
      } as never);

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: "usr-existing",
        email: userEmail,
        memberships: [],
      } as never);

      await expect(authService.acceptInvitation("usr-existing", inviteToken)).rejects.toThrow(
        ForbiddenError
      );
    });

    it("rejects when user is already a member of the organization", async () => {
      vi.mocked(prisma.invitation.findFirst).mockResolvedValueOnce({
        id: "inv-1",
        orgId,
        email: userEmail,
        role: "member",
        tokenHash: inviteTokenHash,
        revokedAt: null,
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        org: { id: orgId, name: "Inviting Org" },
      } as never);

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: "usr-existing",
        email: userEmail,
        memberships: [{ orgId, role: "member" }],
      } as never);

      await expect(authService.acceptInvitation("usr-existing", inviteToken)).rejects.toThrow(
        ConflictError
      );
    });
  });
});
