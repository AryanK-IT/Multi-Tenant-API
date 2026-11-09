import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "../db/client";
import { Role, AUDIT_ACTIONS, WEBHOOK_EVENTS } from "../config/constants";
import { env } from "../config/env";
import {
  ConflictError,
  UnauthenticatedError,
  ForbiddenError,
  ValidationError,
} from "../common/errors";
import { signAccessToken, generateRefreshToken, generateResetToken, hashToken } from "./tokens";
import { SignupInput, LoginInput, ResetPasswordInput } from "./schemas";
import { emailService } from "./email.service";
import { auditService } from "../audit/audit.service";
import { webhookDispatcher } from "../webhooks/dispatcher";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResult {
  user: {
    id: string;
    email: string;
  };
  org: {
    id: string;
    name: string;
  };
  role: Role;
  tokens: AuthTokens;
}

export class AuthService {
  private readonly bcryptRounds = 10;

  async signup(input: SignupInput, ip?: string): Promise<AuthResult> {
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (existingUser) {
      throw new ConflictError("A user with this email address already exists.");
    }

    const passwordHash = await bcrypt.hash(input.password, this.bcryptRounds);
    const { rawToken, tokenHash } = generateRefreshToken();
    const familyId = uuidv4();
    const refreshExpiresAt = new Date(
      Date.now() + env.JWT_REFRESH_EXPIRATION_DAYS * 24 * 60 * 60 * 1000
    );

    // If an invitation token is provided, join the existing organization
    if (input.invitationToken) {
      const inviteHash = hashToken(input.invitationToken);
      const invitation = await prisma.invitation.findFirst({
        where: {
          tokenHash: inviteHash,
          revokedAt: null,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: {
          org: true,
        },
      });

      if (!invitation) {
        throw new ValidationError("Invalid or expired invitation token.");
      }

      if (invitation.email.toLowerCase() !== input.email.toLowerCase()) {
        throw new ForbiddenError("This invitation was issued for a different email address.");
      }

      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email,
            passwordHash,
          },
        });

        await tx.invitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        });

        await tx.orgMembership.create({
          data: {
            userId: user.id,
            orgId: invitation.orgId,
            role: invitation.role,
          },
        });

        await tx.refreshToken.create({
          data: {
            userId: user.id,
            orgId: invitation.orgId,
            familyId,
            tokenHash,
            expiresAt: refreshExpiresAt,
          },
        });

        // Audit log (FR-23)
        await auditService.logAction(
          {
            orgId: invitation.orgId,
            actorType: "user",
            actorId: user.id,
            action: AUDIT_ACTIONS.MEMBER_JOINED,
            targetType: "member",
            targetId: user.id,
            metadata: { role: invitation.role, email: user.email },
            ip,
          },
          tx
        );

        return { user, org: invitation.org, role: invitation.role };
      });

      await webhookDispatcher.dispatch(result.org.id, WEBHOOK_EVENTS.MEMBER_ADDED, {
        userId: result.user.id,
        email: result.user.email,
        role: result.role,
      });

      const accessToken = signAccessToken({
        userId: result.user.id,
        orgId: result.org.id,
        role: result.role,
      });

      return {
        user: {
          id: result.user.id,
          email: result.user.email,
        },
        org: {
          id: result.org.id,
          name: result.org.name,
        },
        role: result.role,
        tokens: {
          accessToken,
          refreshToken: rawToken,
          expiresIn: 900,
        },
      };
    }

    // Otherwise, create a new organization with the user as Owner
    if (!input.orgName) {
      throw new ValidationError("Organization name is required when not accepting an invitation.");
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
        },
      });

      const org = await tx.org.create({
        data: {
          name: input.orgName!,
        },
      });

      await tx.orgMembership.create({
        data: {
          userId: user.id,
          orgId: org.id,
          role: "owner",
        },
      });

      await tx.refreshToken.create({
        data: {
          userId: user.id,
          orgId: org.id,
          familyId,
          tokenHash,
          expiresAt: refreshExpiresAt,
        },
      });

      return { user, org };
    });

    const accessToken = signAccessToken({
      userId: result.user.id,
      orgId: result.org.id,
      role: "owner",
    });

    return {
      user: {
        id: result.user.id,
        email: result.user.email,
      },
      org: {
        id: result.org.id,
        name: result.org.name,
      },
      role: "owner",
      tokens: {
        accessToken,
        refreshToken: rawToken,
        expiresIn: 900, // 15 minutes in seconds
      },
    };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: {
        memberships: {
          include: {
            org: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthenticatedError("Invalid email or password.");
    }

    const isValidPassword = await bcrypt.compare(input.password, user.passwordHash);
    if (!isValidPassword) {
      throw new UnauthenticatedError("Invalid email or password.");
    }

    if (user.memberships.length === 0) {
      throw new ForbiddenError("User is not associated with any organization.");
    }

    let targetMembership = user.memberships[0];

    if (input.orgId) {
      const found = user.memberships.find((m) => m.orgId === input.orgId);
      if (!found) {
        throw new ForbiddenError("User is not a member of the specified organization.");
      }
      targetMembership = found;
    } else if (user.memberships.length > 1) {
      const availableOrgs = user.memberships.map((m) => ({
        id: m.orgId,
        name: m.org.name,
        role: m.role,
      }));
      throw new ValidationError(
        "User belongs to multiple organizations. An orgId must be provided.",
        availableOrgs
      );
    }

    const { rawToken, tokenHash } = generateRefreshToken();
    const familyId = uuidv4();
    const refreshExpiresAt = new Date(
      Date.now() + env.JWT_REFRESH_EXPIRATION_DAYS * 24 * 60 * 60 * 1000
    );

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        orgId: targetMembership.orgId,
        familyId,
        tokenHash,
        expiresAt: refreshExpiresAt,
      },
    });

    const accessToken = signAccessToken({
      userId: user.id,
      orgId: targetMembership.orgId,
      role: targetMembership.role,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
      },
      org: {
        id: targetMembership.org.id,
        name: targetMembership.org.name,
      },
      role: targetMembership.role,
      tokens: {
        accessToken,
        refreshToken: rawToken,
        expiresIn: 900,
      },
    };
  }

  async refresh(rawRefreshToken: string): Promise<{ tokens: AuthTokens }> {
    const tokenHash = hashToken(rawRefreshToken);

    const tokenRecord = await prisma.refreshToken.findFirst({
      where: { tokenHash },
    });

    if (!tokenRecord) {
      throw new UnauthenticatedError("Invalid refresh token.");
    }

    // Theft detection: check if token was already rotated/replaced
    if (tokenRecord.replacedById !== null) {
      await prisma.refreshToken.updateMany({
        where: { familyId: tokenRecord.familyId },
        data: { revokedAt: new Date() },
      });
      throw new UnauthenticatedError(
        "Refresh token reuse detected. All sessions in this token family have been revoked."
      );
    }

    if (tokenRecord.revokedAt !== null) {
      throw new UnauthenticatedError("Refresh token has been revoked.");
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new UnauthenticatedError("Refresh token has expired.");
    }

    // Re-verify current membership
    const membership = await prisma.orgMembership.findUnique({
      where: {
        userId_orgId: {
          userId: tokenRecord.userId,
          orgId: tokenRecord.orgId,
        },
      },
    });

    if (!membership) {
      throw new UnauthenticatedError("User is no longer an active member of this organization.");
    }

    const { rawToken: newRawToken, tokenHash: newTokenHash } = generateRefreshToken();
    const refreshExpiresAt = new Date(
      Date.now() + env.JWT_REFRESH_EXPIRATION_DAYS * 24 * 60 * 60 * 1000
    );

    await prisma.$transaction(async (tx) => {
      const newToken = await tx.refreshToken.create({
        data: {
          userId: tokenRecord.userId,
          orgId: tokenRecord.orgId,
          familyId: tokenRecord.familyId,
          tokenHash: newTokenHash,
          expiresAt: refreshExpiresAt,
        },
      });

      await tx.refreshToken.update({
        where: { id: tokenRecord.id },
        data: {
          revokedAt: new Date(),
          replacedById: newToken.id,
        },
      });
    });

    const accessToken = signAccessToken({
      userId: tokenRecord.userId,
      orgId: tokenRecord.orgId,
      role: membership.role,
    });

    return {
      tokens: {
        accessToken,
        refreshToken: newRawToken,
        expiresIn: 900,
      },
    };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashToken(rawRefreshToken);
    const tokenRecord = await prisma.refreshToken.findFirst({
      where: { tokenHash },
    });

    if (tokenRecord && !tokenRecord.revokedAt) {
      await prisma.refreshToken.update({
        where: { id: tokenRecord.id },
        data: { revokedAt: new Date() },
      });
    }
  }

  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (user) {
      const { rawToken, tokenHash } = generateResetToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });

      await emailService.sendPasswordResetEmail(user.email, rawToken);
    }

    // Always return neutral response to prevent email enumeration
    return {
      message: "If that email address is registered, a password reset link has been sent.",
    };
  }

  async resetPassword(input: ResetPasswordInput): Promise<{ message: string }> {
    const tokenHash = hashToken(input.token);

    const resetToken = await prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    if (!resetToken) {
      throw new ValidationError("Invalid or expired password reset token.");
    }

    const passwordHash = await bcrypt.hash(input.newPassword, this.bcryptRounds);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      });

      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      });

      // Revoke all refresh tokens for the user
      await tx.refreshToken.updateMany({
        where: {
          userId: resetToken.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    });

    return {
      message: "Password has been successfully reset. Please log in with your new password.",
    };
  }

  async acceptInvitation(
    userId: string,
    token: string,
    ip?: string
  ): Promise<{
    message: string;
    org: { id: string; name: string };
    role: Role;
    tokens: AuthTokens;
  }> {
    const tokenHash = hashToken(token);

    const invitation = await prisma.invitation.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        org: true,
      },
    });

    if (!invitation) {
      throw new ValidationError("Invalid or expired invitation token.");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: true,
      },
    });

    if (!user) {
      throw new UnauthenticatedError("User not found.");
    }

    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new ForbiddenError("This invitation was issued for a different email address.");
    }

    const alreadyMember = user.memberships.some((m) => m.orgId === invitation.orgId);
    if (alreadyMember) {
      throw new ConflictError("You are already a member of this organization.");
    }

    const { rawToken, tokenHash: refreshTokenHash } = generateRefreshToken();
    const familyId = uuidv4();
    const refreshExpiresAt = new Date(
      Date.now() + env.JWT_REFRESH_EXPIRATION_DAYS * 24 * 60 * 60 * 1000
    );

    await prisma.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });

      await tx.orgMembership.create({
        data: {
          userId: user.id,
          orgId: invitation.orgId,
          role: invitation.role,
        },
      });

      await tx.refreshToken.create({
        data: {
          userId: user.id,
          orgId: invitation.orgId,
          familyId,
          tokenHash: refreshTokenHash,
          expiresAt: refreshExpiresAt,
        },
      });

      // Audit log (FR-23)
      await auditService.logAction(
        {
          orgId: invitation.orgId,
          actorType: "user",
          actorId: user.id,
          action: AUDIT_ACTIONS.MEMBER_JOINED,
          targetType: "member",
          targetId: user.id,
          metadata: { role: invitation.role, email: user.email },
          ip,
        },
        tx
      );
    });

    await webhookDispatcher.dispatch(invitation.orgId, WEBHOOK_EVENTS.MEMBER_ADDED, {
      userId: user.id,
      email: user.email,
      role: invitation.role,
    });

    const accessToken = signAccessToken({
      userId: user.id,
      orgId: invitation.orgId,
      role: invitation.role,
    });

    return {
      message: "Invitation accepted successfully.",
      org: {
        id: invitation.org.id,
        name: invitation.org.name,
      },
      role: invitation.role,
      tokens: {
        accessToken,
        refreshToken: rawToken,
        expiresIn: 900,
      },
    };
  }
}

export const authService = new AuthService();
