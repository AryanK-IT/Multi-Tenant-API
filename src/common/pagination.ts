import { PAGINATION } from "../config/constants";

export interface CursorPayload {
  id: string;
  createdAt: string;
}

export interface PaginationParams {
  limit: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
}

/**
 * Encodes an item's id and createdAt timestamp into an opaque base64url cursor.
 */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/**
 * Decodes an opaque base64url cursor into its constituent id and createdAt values.
 * Returns null if the cursor cannot be parsed or is invalid.
 */
export function decodeCursor(cursor?: string): CursorPayload | null {
  if (!cursor || typeof cursor !== "string") {
    return null;
  }

  try {
    const json = Buffer.from(cursor, "base64url").toString("utf-8");
    const parsed = JSON.parse(json) as unknown;

    if (
      parsed &&
      typeof parsed === "object" &&
      "id" in parsed &&
      "createdAt" in parsed &&
      typeof (parsed as CursorPayload).id === "string" &&
      typeof (parsed as CursorPayload).createdAt === "string"
    ) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parses query parameters for pagination, applying default and max bounds.
 */
export function parsePaginationParams(query: {
  limit?: unknown;
  cursor?: unknown;
}): PaginationParams {
  let limit: number = PAGINATION.DEFAULT_LIMIT;

  if (query.limit !== undefined && query.limit !== null) {
    const parsed = Number(query.limit);
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(Math.floor(parsed), PAGINATION.MAX_LIMIT);
    }
  }

  const cursor =
    typeof query.cursor === "string" && query.cursor.trim() ? query.cursor.trim() : undefined;

  return { limit, cursor };
}

/**
 * Given fetched items (typically fetched with take: limit + 1) and the requested limit,
 * slices the items to the limit and returns nextCursor if additional items exist.
 */
export function buildPaginatedResponse<T extends { id: string; createdAt: Date }>(
  items: T[],
  limit: number
): PaginatedResult<T> {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  let nextCursor: string | null = null;
  if (hasMore && data.length > 0) {
    const lastItem = data[data.length - 1];
    nextCursor = encodeCursor({
      id: lastItem.id,
      createdAt: lastItem.createdAt.toISOString(),
    });
  }

  return {
    data,
    nextCursor,
  };
}

/**
 * Builds Prisma where filter for keyset pagination ordered by createdAt: "desc", id: "desc".
 */
export function buildKeysetFilter(cursorPayload: CursorPayload | null) {
  if (!cursorPayload) return {};

  const cursorDate = new Date(cursorPayload.createdAt);

  return {
    OR: [
      { createdAt: { lt: cursorDate } },
      {
        AND: [{ createdAt: cursorDate }, { id: { lt: cursorPayload.id } }],
      },
    ],
  };
}
