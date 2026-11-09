import { prisma } from "../db/client";
import { NotFoundError, UnauthenticatedError } from "../common/errors";
import {
  parsePaginationParams,
  decodeCursor,
  buildKeysetFilter,
  buildPaginatedResponse,
  PaginatedResult,
} from "../common/pagination";
import { CreateApiKeyInput, ListApiKeysQuery } from "./schemas";
import { generateApiKey, parseApiKey, verifyApiKeySecret } from "./key-utils";
import { API_KEY_CONSTANTS, ACTOR_TYPES, AUDIT_ACTIONS, ApiKeyScope } from "../config/constants";
import { auditService } from "../audit/audit.service";
import { logger } from "../common/logger";

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scope: ApiKeyScope;
  createdById: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface CreatedApiKeyResult extends ApiKeySummary {
  key: string;
}

export interface AuthenticatedApiKeyPayload {
  apiKeyId: string;
  orgId: string;
  scope: ApiKeyScope;
  createdById: string;
  name: string;
  prefix: string;
}

export class ApiKeysService {
  /**
   * Generates and stores a new API key (SRS §3.4 FR-15).
   * Key format: tf_<prefix>_<secret>. Full key returned once.
   */
  async createApiKey(
    orgId: string,
    createdById: string,
    data: CreateApiKeyInput,
    ip?: string
  ): Promise<CreatedApiKeyResult> {
    const { prefix, fullKey, hashedSecret } = generateApiKey();
    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;

    const apiKey = await prisma.apiKey.create({
      data: {
        orgId,
        name: data.name,
        prefix,
        hashedSecret,
        scope: data.scope,
        createdById,
        expiresAt,
      },
    });

    // Record append-only audit log entry (SRS §3.7 FR-23)
    await auditService.logAction({
      orgId,
      actorType: ACTOR_TYPES.USER,
      actorId: createdById,
      action: AUDIT_ACTIONS.API_KEY_CREATED,
      targetType: "api_key",
      targetId: apiKey.id,
      metadata: {
        name: apiKey.name,
        prefix: apiKey.prefix,
        scope: apiKey.scope,
        expiresAt: apiKey.expiresAt ? apiKey.expiresAt.toISOString() : null,
      },
      ip: ip ?? null,
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      prefix: apiKey.prefix,
      scope: apiKey.scope as ApiKeyScope,
      createdById: apiKey.createdById,
      expiresAt: apiKey.expiresAt,
      revokedAt: apiKey.revokedAt,
      lastUsedAt: apiKey.lastUsedAt,
      createdAt: apiKey.createdAt,
      key: fullKey,
    };
  }

  /**
   * Lists API keys belonging to the tenant with cursor pagination (SRS §3.4 FR-16).
   * Never exposes the hashedSecret.
   */
  async listApiKeys(
    orgId: string,
    query: ListApiKeysQuery
  ): Promise<PaginatedResult<ApiKeySummary>> {
    const { limit, cursor } = parsePaginationParams(query);
    const cursorPayload = decodeCursor(cursor);
    const keysetFilter = buildKeysetFilter(cursorPayload);

    const items = await prisma.apiKey.findMany({
      where: {
        orgId,
        ...keysetFilter,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        name: true,
        prefix: true,
        scope: true,
        createdById: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    return buildPaginatedResponse(items as ApiKeySummary[], limit);
  }

  /**
   * Revokes an API key belonging to the tenant (SRS §3.4 FR-16).
   * Cross-tenant or non-existent keys return 404 NOT_FOUND (ADR 2).
   */
  async revokeApiKey(
    orgId: string,
    keyId: string,
    userId: string,
    ip?: string
  ): Promise<{ message: string }> {
    const key = await prisma.apiKey.findFirst({
      where: {
        id: keyId,
        orgId,
      },
    });

    if (!key) {
      throw new NotFoundError("API key not found.");
    }

    await prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });

    // Record append-only audit log entry (SRS §3.7 FR-23)
    await auditService.logAction({
      orgId,
      actorType: ACTOR_TYPES.USER,
      actorId: userId,
      action: AUDIT_ACTIONS.API_KEY_REVOKED,
      targetType: "api_key",
      targetId: key.id,
      metadata: {
        name: key.name,
        prefix: key.prefix,
      },
      ip: ip ?? null,
    });

    return { message: "API key revoked successfully." };
  }

  /**
   * Validates and authenticates an incoming API key bearer token (SRS §3.4 FR-17).
   * Lookup is performed by prefix; secret is verified against hashedSecret.
   * Updates lastUsedAt throttled to at most once per minute.
   */
  async verifyAndAuthenticateKey(rawKey: string): Promise<AuthenticatedApiKeyPayload> {
    const parsed = parseApiKey(rawKey);
    if (!parsed) {
      throw new UnauthenticatedError("Invalid API key format.");
    }

    const apiKey = await prisma.apiKey.findUnique({
      where: { prefix: parsed.prefix },
    });

    if (!apiKey) {
      throw new UnauthenticatedError("Invalid API key.");
    }

    if (apiKey.revokedAt) {
      throw new UnauthenticatedError("API key has been revoked.");
    }

    if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now()) {
      throw new UnauthenticatedError("API key has expired.");
    }

    const isValidSecret = verifyApiKeySecret(parsed.secret, apiKey.hashedSecret);
    if (!isValidSecret) {
      throw new UnauthenticatedError("Invalid API key.");
    }

    // Throttled lastUsedAt update (SRS §3.4 FR-17)
    const now = new Date();
    const shouldUpdateLastUsed =
      !apiKey.lastUsedAt ||
      now.getTime() - apiKey.lastUsedAt.getTime() > API_KEY_CONSTANTS.THROTTLE_LAST_USED_MS;

    if (shouldUpdateLastUsed) {
      prisma.apiKey
        .update({
          where: { id: apiKey.id },
          data: { lastUsedAt: now },
        })
        .catch((err) => {
          logger.warn({ err, apiKeyId: apiKey.id }, "Failed to update lastUsedAt for API key");
        });
    }

    return {
      apiKeyId: apiKey.id,
      orgId: apiKey.orgId,
      scope: apiKey.scope as ApiKeyScope,
      createdById: apiKey.createdById,
      name: apiKey.name,
      prefix: apiKey.prefix,
    };
  }
}

export const apiKeysService = new ApiKeysService();
