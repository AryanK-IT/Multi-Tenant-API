import { describe, it, expect, vi, beforeEach } from "vitest";
import { orgsService } from "../../src/orgs/orgs.service";
import { prisma } from "../../src/db/client";
import { emailService } from "../../src/auth/email.service";
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError,
} from "../../src/common/errors";

vi.mock("../../src/db/client", () => ({
  prisma: {
    org: {
      findUnique: vi.fn(),
    },
    orgMembership: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    refreshToken: {
      updateMany: vi.fn(),
    },
    task: {
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    invitation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
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

vi.mock("../../src/auth/email.service", () => ({
  emailService: {
    sendInvitationEmail: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("OrgsService Unit Tests", () => {
  const orgId = "org-123";
  const ownerId = "user-owner";
  const adminId = "user-admin";
  const memberId = "user-member";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getOrg", () => {
    it("returns org when found", async () => {
      vi.mocked(prisma.org.findUnique).mockResolvedValueOnce({
        id: orgId,
        name: "Acme Corp",
        createdAt: new Date(),
      } as never);

      const org = await orgsService.getOrg(orgId);
      expect(org.id).toBe(orgId);
      expect(org.name).toBe("Acme Corp");
    });

    it("throws NotFoundError when org is not found", async () => {
      vi.mocked(prisma.org.findUnique).mockResolvedValueOnce(null);

      await expect(orgsService.getOrg("unknown-org")).rejects.toThrow(NotFoundError);
    });
  });

  describe("listMembers", () => {
    it("returns formatted list of members", async () => {
      vi.mocked(prisma.orgMembership.findMany).mockResolvedValueOnce([
        {
          userId: ownerId,
          orgId,
          role: "owner",
          createdAt: new Date(),
          user: { id: ownerId, email: "owner@acme.com" },
        },
        {
          userId: memberId,
          orgId,
          role: "member",
          createdAt: new Date(),
          user: { id: memberId, email: "member@acme.com" },
        },
      ] as never);

      const members = await orgsService.listMembers(orgId);
      expect(members).toHaveLength(2);
      expect(members[0].role).toBe("owner");
      expect(members[0].email).toBe("owner@acme.com");
      expect(members[1].role).toBe("member");
    });
  });

  describe("updateMemberRole", () => {
    it("allows Owner to change Member to Admin", async () => {
      vi.mocked(prisma.orgMembership.findUnique).mockResolvedValueOnce({
        userId: memberId,
        orgId,
        role: "member",
      } as never);

      vi.mocked(prisma.orgMembership.update).mockResolvedValueOnce({
        userId: memberId,
        orgId,
        role: "admin",
      } as never);

      const result = await orgsService.updateMemberRole("owner", ownerId, orgId, memberId, "admin");

      expect(result.role).toBe("admin");
      expect(prisma.orgMembership.update).toHaveBeenCalledWith({
        where: { userId_orgId: { userId: memberId, orgId } },
        data: { role: "admin" },
      });
    });

    it("prevents modifying the Owner", async () => {
      vi.mocked(prisma.orgMembership.findUnique).mockResolvedValueOnce({
        userId: ownerId,
        orgId,
        role: "owner",
      } as never);

      await expect(
        orgsService.updateMemberRole("owner", ownerId, orgId, ownerId, "admin")
      ).rejects.toThrow(ForbiddenError);
    });

    it("prevents Admin from modifying another Admin", async () => {
      vi.mocked(prisma.orgMembership.findUnique).mockResolvedValueOnce({
        userId: "other-admin",
        orgId,
        role: "admin",
      } as never);

      await expect(
        orgsService.updateMemberRole("admin", adminId, orgId, "other-admin", "member")
      ).rejects.toThrow(ForbiddenError);
    });

    it("prevents Member from changing roles", async () => {
      vi.mocked(prisma.orgMembership.findUnique).mockResolvedValueOnce({
        userId: "someone",
        orgId,
        role: "member",
      } as never);

      await expect(
        orgsService.updateMemberRole("member", memberId, orgId, "someone", "admin")
      ).rejects.toThrow(ForbiddenError);
    });

    it("throws NotFoundError if target member does not exist in org", async () => {
      vi.mocked(prisma.orgMembership.findUnique).mockResolvedValueOnce(null);

      await expect(
        orgsService.updateMemberRole("owner", ownerId, orgId, "unknown", "admin")
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("removeMember", () => {
    it("allows Owner to remove Member and revokes their refresh tokens", async () => {
      vi.mocked(prisma.orgMembership.findUnique).mockResolvedValueOnce({
        userId: memberId,
        orgId,
        role: "member",
      } as never);

      vi.mocked(prisma.orgMembership.delete).mockResolvedValueOnce({} as never);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValueOnce({ count: 2 });
      vi.mocked(prisma.task.updateMany).mockResolvedValueOnce({ count: 1 });

      const result = await orgsService.removeMember("owner", ownerId, orgId, memberId);

      expect(result.message).toBe("Member removed successfully.");
      expect(prisma.orgMembership.delete).toHaveBeenCalledWith({
        where: { userId_orgId: { userId: memberId, orgId } },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: memberId, orgId, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.task.updateMany).toHaveBeenCalledWith({
        where: { orgId, assigneeId: memberId },
        data: { assigneeId: null },
      });
    });

    it("prevents removing the Owner", async () => {
      vi.mocked(prisma.orgMembership.findUnique).mockResolvedValueOnce({
        userId: ownerId,
        orgId,
        role: "owner",
      } as never);

      await expect(orgsService.removeMember("owner", ownerId, orgId, ownerId)).rejects.toThrow(
        ForbiddenError
      );
    });

    it("prevents Admin from removing another Admin", async () => {
      vi.mocked(prisma.orgMembership.findUnique).mockResolvedValueOnce({
        userId: "other-admin",
        orgId,
        role: "admin",
      } as never);

      await expect(
        orgsService.removeMember("admin", adminId, orgId, "other-admin")
      ).rejects.toThrow(ForbiddenError);
    });

    it("prevents Member from removing any member", async () => {
      vi.mocked(prisma.orgMembership.findUnique).mockResolvedValueOnce({
        userId: "target",
        orgId,
        role: "member",
      } as never);

      await expect(orgsService.removeMember("member", memberId, orgId, "target")).rejects.toThrow(
        ForbiddenError
      );
    });
  });

  describe("transferOwnership", () => {
    it("atomically transfers ownership from current Owner to target Member", async () => {
      vi.mocked(prisma.orgMembership.findUnique).mockResolvedValueOnce({
        userId: memberId,
        orgId,
        role: "member",
      } as never);

      const result = await orgsService.transferOwnership("owner", ownerId, orgId, memberId);

      expect(result.message).toBe("Ownership transferred successfully.");
      expect(result.previousOwnerUserId).toBe(ownerId);
      expect(result.newOwnerUserId).toBe(memberId);
      expect(prisma.orgMembership.update).toHaveBeenCalledWith({
        where: { userId_orgId: { userId: memberId, orgId } },
        data: { role: "owner" },
      });
      expect(prisma.orgMembership.update).toHaveBeenCalledWith({
        where: { userId_orgId: { userId: ownerId, orgId } },
        data: { role: "admin" },
      });
    });

    it("prevents non-owners from transferring ownership", async () => {
      await expect(
        orgsService.transferOwnership("admin", adminId, orgId, memberId)
      ).rejects.toThrow(ForbiddenError);
    });

    it("prevents transferring ownership to oneself", async () => {
      await expect(orgsService.transferOwnership("owner", ownerId, orgId, ownerId)).rejects.toThrow(
        ValidationError
      );
    });

    it("throws NotFoundError if target is not a member of the org", async () => {
      vi.mocked(prisma.orgMembership.findUnique).mockResolvedValueOnce(null);

      await expect(
        orgsService.transferOwnership("owner", ownerId, orgId, "non-member")
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("createInvitation", () => {
    it("creates invitation and sends email", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.invitation.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.invitation.create).mockResolvedValueOnce({
        id: "inv-1",
        orgId,
        email: "newuser@example.com",
        role: "member",
        tokenHash: "hashed",
        invitedById: ownerId,
        expiresAt: new Date(Date.now() + 7 * 86400000),
        createdAt: new Date(),
      } as never);
      vi.mocked(prisma.org.findUnique).mockResolvedValueOnce({
        id: orgId,
        name: "Acme",
      } as never);

      const result = await orgsService.createInvitation(ownerId, orgId, {
        email: "newuser@example.com",
        role: "member",
      });

      expect(result.id).toBe("inv-1");
      expect(result.invitationToken).toBeDefined();
      expect(emailService.sendInvitationEmail).toHaveBeenCalled();
    });

    it("rejects invitation if user is already an active member", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: "existing-usr",
        email: "existing@example.com",
        memberships: [{ orgId, role: "member" }],
      } as never);

      await expect(
        orgsService.createInvitation(ownerId, orgId, {
          email: "existing@example.com",
          role: "member",
        })
      ).rejects.toThrow(ConflictError);
    });

    it("rejects invitation if active pending invite already exists", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.invitation.findFirst).mockResolvedValueOnce({
        id: "existing-invite",
      } as never);

      await expect(
        orgsService.createInvitation(ownerId, orgId, {
          email: "pending@example.com",
          role: "member",
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("revokeInvitation", () => {
    it("revokes pending invitation", async () => {
      vi.mocked(prisma.invitation.findFirst).mockResolvedValueOnce({
        id: "inv-1",
        orgId,
        revokedAt: null,
        acceptedAt: null,
      } as never);

      const result = await orgsService.revokeInvitation(orgId, "inv-1");
      expect(result.message).toBe("Invitation revoked successfully.");
      expect(prisma.invitation.update).toHaveBeenCalledWith({
        where: { id: "inv-1" },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("throws NotFoundError when invitation not found in tenant", async () => {
      vi.mocked(prisma.invitation.findFirst).mockResolvedValueOnce(null);

      await expect(orgsService.revokeInvitation(orgId, "unknown")).rejects.toThrow(NotFoundError);
    });

    it("throws ValidationError when invitation is already revoked", async () => {
      vi.mocked(prisma.invitation.findFirst).mockResolvedValueOnce({
        id: "inv-1",
        orgId,
        revokedAt: new Date(),
        acceptedAt: null,
      } as never);

      await expect(orgsService.revokeInvitation(orgId, "inv-1")).rejects.toThrow(ValidationError);
    });
  });
});
