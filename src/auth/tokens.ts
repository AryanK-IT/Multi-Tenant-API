import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { Role } from "../config/constants";
import { UnauthenticatedError } from "../common/errors";

export interface AccessTokenPayload {
  userId: string;
  orgId: string;
  role: Role;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  // @ts-expect-error jsonwebtoken types mismatch with string options
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRATION,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
    if (!decoded.userId || !decoded.orgId || !decoded.role) {
      throw new UnauthenticatedError("Invalid access token payload");
    }
    return {
      userId: decoded.userId,
      orgId: decoded.orgId,
      role: decoded.role,
    };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthenticatedError("Access token has expired");
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new UnauthenticatedError("Invalid access token");
    }
    throw err;
  }
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateRefreshToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(40).toString("hex");
  const tokenHash = hashToken(rawToken);
  return { rawToken, tokenHash };
}

export function generateResetToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  return { rawToken, tokenHash };
}

export function generateInvitationToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  return { rawToken, tokenHash };
}
