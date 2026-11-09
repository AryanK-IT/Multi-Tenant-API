import { Request, Response, NextFunction } from "express";
import { Role, ApiKeyScope, API_KEY_CONSTANTS } from "../config/constants";
import { UnauthenticatedError } from "../common/errors";
import { verifyAccessToken } from "../auth/tokens";
import { apiKeysService } from "../api-keys/api-keys.service";

export interface AuthContext {
  userId?: string;
  orgId: string;
  role?: Role;
  isApiKey: boolean;
  apiKeyId?: string;
  apiKeyScope?: ApiKeyScope;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return next(new UnauthenticatedError("Authorization header is required."));
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return next(
      new UnauthenticatedError("Invalid authorization format. Expected 'Bearer <token>'.")
    );
  }

  const token = parts[1];

  // Distinguish API keys (tf_ prefix) from JWT tokens per SRS §3.4 FR-17
  if (token.startsWith(API_KEY_CONSTANTS.PREFIX_HEADER)) {
    try {
      const keyData = await apiKeysService.verifyAndAuthenticateKey(token);
      req.auth = {
        orgId: keyData.orgId,
        isApiKey: true,
        apiKeyId: keyData.apiKeyId,
        apiKeyScope: keyData.scope,
        userId: keyData.createdById,
      };
      return next();
    } catch (err) {
      return next(err);
    }
  }

  try {
    const payload = verifyAccessToken(token);
    req.auth = {
      userId: payload.userId,
      orgId: payload.orgId,
      role: payload.role,
      isApiKey: false,
    };
    next();
  } catch (err) {
    next(err);
  }
}
