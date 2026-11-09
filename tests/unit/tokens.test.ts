import { describe, it, expect } from "vitest";
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  generateResetToken,
  hashToken,
} from "../../src/auth/tokens";
import { UnauthenticatedError } from "../../src/common/errors";

describe("Auth Tokens Utility", () => {
  describe("signAccessToken & verifyAccessToken", () => {
    it("successfully signs and verifies a valid access token", () => {
      const payload = {
        userId: "user-123",
        orgId: "org-456",
        role: "owner" as const,
      };

      const token = signAccessToken(payload);
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(20);

      const verified = verifyAccessToken(token);
      expect(verified).toEqual({
        userId: "user-123",
        orgId: "org-456",
        role: "owner",
      });
    });

    it("throws UnauthenticatedError for invalid token string", () => {
      expect(() => verifyAccessToken("invalid.jwt.token")).toThrow(UnauthenticatedError);
    });

    it("throws UnauthenticatedError for malformed token", () => {
      expect(() => verifyAccessToken("")).toThrow(UnauthenticatedError);
    });
  });

  describe("generateRefreshToken & hashToken", () => {
    it("generates random high-entropy token and its sha256 hash", () => {
      const { rawToken, tokenHash } = generateRefreshToken();

      expect(typeof rawToken).toBe("string");
      expect(rawToken.length).toBe(80); // 40 bytes hex

      expect(typeof tokenHash).toBe("string");
      expect(tokenHash.length).toBe(64); // sha256 hex length
      expect(hashToken(rawToken)).toBe(tokenHash);
    });

    it("produces distinct tokens on subsequent invocations", () => {
      const first = generateRefreshToken();
      const second = generateRefreshToken();

      expect(first.rawToken).not.toBe(second.rawToken);
      expect(first.tokenHash).not.toBe(second.tokenHash);
    });
  });

  describe("generateResetToken", () => {
    it("generates a 32-byte hex reset token and valid sha256 hash", () => {
      const { rawToken, tokenHash } = generateResetToken();

      expect(typeof rawToken).toBe("string");
      expect(rawToken.length).toBe(64); // 32 bytes hex
      expect(tokenHash.length).toBe(64);
      expect(hashToken(rawToken)).toBe(tokenHash);
    });
  });
});
