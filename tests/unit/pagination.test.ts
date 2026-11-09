import { describe, it, expect } from "vitest";
import {
  encodeCursor,
  decodeCursor,
  parsePaginationParams,
  buildPaginatedResponse,
  buildKeysetFilter,
} from "../../src/common/pagination";

describe("Pagination Utility (ADR 6, SRS §4.1)", () => {
  describe("encodeCursor and decodeCursor", () => {
    it("encodes and decodes cursor correctly", () => {
      const payload = {
        id: "proj-123",
        createdAt: "2026-11-07T12:00:00.000Z",
      };

      const encoded = encodeCursor(payload);
      expect(typeof encoded).toBe("string");
      expect(encoded.length).toBeGreaterThan(0);

      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual(payload);
    });

    it("returns null for invalid or corrupted cursors", () => {
      expect(decodeCursor(undefined)).toBeNull();
      expect(decodeCursor("")).toBeNull();
      expect(decodeCursor("not-a-valid-base64url")).toBeNull();
      expect(decodeCursor(Buffer.from('{"invalid": true}').toString("base64url"))).toBeNull();
    });
  });

  describe("parsePaginationParams", () => {
    it("uses default limit when not provided", () => {
      const params = parsePaginationParams({});
      expect(params.limit).toBe(25);
      expect(params.cursor).toBeUndefined();
    });

    it("parses valid limit and clamps to max limit", () => {
      expect(parsePaginationParams({ limit: 10 }).limit).toBe(10);
      expect(parsePaginationParams({ limit: "50" }).limit).toBe(50);
      expect(parsePaginationParams({ limit: 200 }).limit).toBe(100);
      expect(parsePaginationParams({ limit: -5 }).limit).toBe(25);
      expect(parsePaginationParams({ limit: 0 }).limit).toBe(25);
    });

    it("trims and accepts cursor string", () => {
      const params = parsePaginationParams({ cursor: "  abc123cursor  " });
      expect(params.cursor).toBe("abc123cursor");
    });
  });

  describe("buildPaginatedResponse", () => {
    const items = [
      { id: "1", createdAt: new Date("2026-11-07T10:00:00.000Z") },
      { id: "2", createdAt: new Date("2026-11-07T09:00:00.000Z") },
      { id: "3", createdAt: new Date("2026-11-07T08:00:00.000Z") },
    ];

    it("returns nextCursor when items exceed limit", () => {
      const result = buildPaginatedResponse(items, 2);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe("1");
      expect(result.data[1].id).toBe("2");
      expect(result.nextCursor).not.toBeNull();

      const decoded = decodeCursor(result.nextCursor!);
      expect(decoded?.id).toBe("2");
      expect(decoded?.createdAt).toBe(items[1].createdAt.toISOString());
    });

    it("returns null nextCursor when items do not exceed limit", () => {
      const result = buildPaginatedResponse(items, 5);
      expect(result.data).toHaveLength(3);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe("buildKeysetFilter", () => {
    it("returns empty object when cursor is null", () => {
      expect(buildKeysetFilter(null)).toEqual({});
    });

    it("returns OR filter with createdAt and id conditions", () => {
      const filter = buildKeysetFilter({
        id: "proj-1",
        createdAt: "2026-11-07T10:00:00.000Z",
      });
      expect(filter).toHaveProperty("OR");
      expect(filter.OR).toHaveLength(2);
    });
  });
});
