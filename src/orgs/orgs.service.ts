import { prisma } from "../db/client";
import { Role, AUDIT_ACTIONS, WEBHOOK_EVENTS } from "../config/constants";
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from "../common/errors";
import { generateInvitationToken } from "../auth/tokens";
import { emailService } from "../auth/email.service";
import { CreateInvitationInput } from "./schemas";
import { auditService } from "../audit/audit.service";
import { webhookDispatcher } from "../webhooks/dispatcher";

export interface MemberResponse {
  userId: string;
  email: string;
  role: Role;
  joinedAt: Date;
}

export class OrgsService {
  async getOrg(orgId: string): Promise<{ id: string; name: string; createdAt: Date }> {
    const org = await prisma.org.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, createdAt: true },
    });

    if (!org) {
      throw new NotFoundError("Organization not found.");
    }

    return org;
  }

  async listMembers(orgId: string): Promise<MemberResponse[]> {
    const memberships = await prisma.orgMembership.findMany({
      where: { orgId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return memberships.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      role: m.role,
      joinedAt: m.createdAt,
    }));
  }

  async updateMemberRole(
    requesterRole: Role,
    requesterUserId: string,
    orgId: string,
    targetUserId: string,
    newRole: "admin" | "member",
    ip?: string
  ): Promise<{ userId: string; orgId: string; role: Role }> {
    const target = await prisma.orgMembership.findUnique({
      where: {
        userId_orgId: {
          userId: targetUserId,
          orgId,
        },
      },
    });

    if (!target) {
      throw new NotFoundError("Member not found in this organization.");
    }

    // Owner cannot be demoted or modified through member management (FR-6)
    if (target.role === "owner") {
      throw new ForbiddenError(
        "The owner cannot be demoted or modified. Use ownership transfer instead."
      );
    }

    // Admins cannot modify other Admins (FR-6)
    if (requesterRole === "admin" && target.role === "admin") {
      throw new ForbiddenError("Admins cannot modify other Admins.");
    }

    // Members cannot modify anyone
    if (requesterRole === "member") {
      throw new ForbiddenError("Members do not have permission to modify roles.");
    }

    const updated = await prisma.orgMembership.update({
      where: {
        userId_orgId: {
          userId: targetUserId,
          orgId,
        },
      },
      data: {
        role: newRole,
      },
    });

    // Audit log (FR-23)
    await auditService.logAction({
      orgId,
      actorType: "user",
      actorId: requesterUserId,
      action: AUDIT_ACTIONS.MEMBER_ROLE_CHANGED,
      targetType: "member",
      targetId: targetUserId,
      metadata: { previousRole: target.role, newRole },
      ip,
    });

    return {
      userId: updated.userId,
      orgId: updated.orgId,
      role: updated.role,
    };
  }

  async removeMember(
    requesterRole: Role,
    requesterUserId: string,
    orgId: string,
    targetUserId: string,
    ip?: string
  ): Promise<{ message: string }> {
    const target = await prisma.orgMembership.findUnique({
      where: {
        userId_orgId: {
          userId: targetUserId,
          orgId,
        },
      },
    });

    if (!target) {
      throw new NotFoundError("Member not found in this organization.");
    }

    // Owner cannot be removed (FR-6)
    if (target.role === "owner") {
      throw new ForbiddenError(
        "The owner cannot be removed from the organization. Transfer ownership first."
      );
    }

    // Admins cannot remove other Admins (FR-6)
    if (requesterRole === "admin" && target.role === "admin") {
      throw new ForbiddenError("Admins cannot remove other Admins.");
    }

    // Members cannot remove members
    if (requesterRole === "member") {
      throw new ForbiddenError("Members do not have permission to remove members.");
    }

    await prisma.$transaction(async (tx) => {
      // 1. Remove membership
      await tx.orgMembership.delete({
        where: {
          userId_orgId: {
            userId: targetUserId,
            orgId,
          },
        },
      });

      // 2. Revoke all refresh tokens for that org (FR-6)
      await tx.refreshToken.updateMany({
        where: {
          userId: targetUserId,
          orgId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });

      // 3. Unassign all tasks assigned to the removed member in this org (FR-6 & FR-14)
      await tx.task.updateMany({
        where: {
          orgId,
          assigneeId: targetUserId,
        },
        data: {
          assigneeId: null,
        },
      });

      // 4. Audit log (FR-6 & FR-23)
      await auditService.logAction(
        {
          orgId,
          actorType: "user",
          actorId: requesterUserId,
          action: AUDIT_ACTIONS.MEMBER_REMOVED,
          targetType: "member",
          targetId: targetUserId,
          metadata: { removedUserId: targetUserId, previousRole: target.role },
          ip,
        },
        tx
      );
    });

    await webhookDispatcher.dispatch(orgId, WEBHOOK_EVENTS.MEMBER_REMOVED, {
      userId: targetUserId,
      role: target.role,
    });

    return { message: "Member removed successfully." };
  }

  async transferOwnership(
    requesterRole: Role,
    requesterUserId: string,
    orgId: string,
    newOwnerUserId: string,
    ip?: string
  ): Promise<{ message: string; previousOwnerUserId: string; newOwnerUserId: string }> {
    if (requesterRole !== "owner") {
      throw new ForbiddenError("Only the organization owner can transfer ownership.");
    }

    if (requesterUserId === newOwnerUserId) {
      throw new ValidationError("Target user is already the owner.");
    }

    const targetMembership = await prisma.orgMembership.findUnique({
      where: {
        userId_orgId: {
          userId: newOwnerUserId,
          orgId,
        },
      },
    });

    if (!targetMembership) {
      throw new NotFoundError("Target user is not a member of this organization.");
    }

    await prisma.$transaction(async (tx) => {
      // Atomic ownership transfer (FR-7)
      await tx.orgMembership.update({
        where: {
          userId_orgId: {
            userId: newOwnerUserId,
            orgId,
          },
        },
        data: { role: "owner" },
      });

      await tx.orgMembership.update({
        where: {
          userId_orgId: {
            userId: requesterUserId,
            orgId,
          },
        },
        data: { role: "admin" },
      });

      // Audit log (FR-7 & FR-23)
      await auditService.logAction(
        {
          orgId,
          actorType: "user",
          actorId: requesterUserId,
          action: AUDIT_ACTIONS.OWNERSHIP_TRANSFERRED,
          targetType: "org",
          targetId: orgId,
          metadata: { previousOwnerUserId: requesterUserId, newOwnerUserId },
          ip,
        },
        tx
      );
    });

    return {
      message: "Ownership transferred successfully.",
      previousOwnerUserId: requesterUserId,
      newOwnerUserId,
    };
  }

  async createInvitation(
    requesterUserId: string,
    orgId: string,
    input: CreateInvitationInput,
    ip?: string
  ): Promise<{
    id: string;
    orgId: string;
    email: string;
    role: Role;
    expiresAt: Date;
    createdAt: Date;
    invitationToken: string;
  }> {
    // Check if user is already an active member of this organization (FR-5)
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email },
      include: {
        memberships: {
          where: { orgId },
        },
      },
    });

    if (existingUser && existingUser.memberships.length > 0) {
      throw new ConflictError("User is already a member of this organization.");
    }

    // Check for an active pending invitation
    const existingInvite = await prisma.invitation.findFirst({
      where: {
        orgId,
        email: input.email,
        revokedAt: null,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (existingInvite) {
      throw new ConflictError("An active invitation already exists for this email address.");
    }

    const { rawToken, tokenHash } = generateInvitationToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days per FR-5

    const invitation = await prisma.invitation.create({
      data: {
        orgId,
        email: input.email,
        role: input.role,
        tokenHash,
        invitedById: requesterUserId,
        expiresAt,
      },
    });

    // Audit log (FR-23)
    await auditService.logAction({
      orgId,
      actorType: "user",
      actorId: requesterUserId,
      action: AUDIT_ACTIONS.MEMBER_INVITED,
      targetType: "invitation",
      targetId: invitation.id,
      metadata: { email: input.email, role: input.role },
      ip,
    });

    const org = await prisma.org.findUnique({ where: { id: orgId } });
    await emailService.sendInvitationEmail(input.email, rawToken, org?.name || "Organization");

    return {
      id: invitation.id,
      orgId: invitation.orgId,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      invitationToken: rawToken,
    };
  }

  async listInvitations(orgId: string) {
    const invitations = await prisma.invitation.findMany({
      where: {
        orgId,
        revokedAt: null,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orgId: true,
        email: true,
        role: true,
        invitedById: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return invitations;
  }

  async revokeInvitation(orgId: string, invitationId: string): Promise<{ message: string }> {
    const invitation = await prisma.invitation.findFirst({
      where: {
        id: invitationId,
        orgId,
      },
    });

    if (!invitation) {
      throw new NotFoundError("Invitation not found.");
    }

    if (invitation.revokedAt !== null) {
      throw new ValidationError("Invitation is already revoked.");
    }

    if (invitation.acceptedAt !== null) {
      throw new ValidationError("Invitation has already been accepted.");
    }

    await prisma.invitation.update({
      where: { id: invitationId },
      data: { revokedAt: new Date() },
    });

    return { message: "Invitation revoked successfully." };
  }
}

export const orgsService = new OrgsService();
