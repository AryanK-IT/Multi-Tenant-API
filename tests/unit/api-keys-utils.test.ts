import { describe, it, expect } from "vitest";
import {
  generateApiKey,
  hashApiKeySecret,
  verifyApiKeySecret,
  parseApiKey,
} from "../../src/api-keys/key-utils";

describe("API Key Utilities (SRS §3.4 FR-15, FR-17)", () => {
  describe("generateApiKey", () => {
    it("generates an API key with correct format tf_<prefix>_<secret>", () => {
      const generated = generateApiKey();

      expect(generated.fullKey).toMatch(/^tf_[a-f0-9]{16}_[a-f0-9]{48}$/);
      expect(generated.prefix).toHaveLength(16);
      expect(generated.secret).toHaveLength(48);
      expect(generated.hashedSecret).toBe(hashApiKeySecret(generated.secret));
    });

    it("generates unique keys on successive calls", () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();

      expect(key1.fullKey).not.toBe(key2.fullKey);
      expect(key1.prefix).not.toBe(key2.prefix);
      expect(key1.secret).not.toBe(key2.secret);
      expect(key1.hashedSecret).not.toBe(key2.hashedSecret);
    });
  });

  describe("hashApiKeySecret & verifyApiKeySecret", () => {
    it("verifies a valid secret against its hash in constant time", () => {
      const secret = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6";
      const hash = hashApiKeySecret(secret);

      expect(verifyApiKeySecret(secret, hash)).toBe(true);
    });

    it("rejects an invalid secret", () => {
      const secret = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6";
      const wrongSecret = "wrongsecretwrongsecretwrongsecretwrongsecretwrong";
      const hash = hashApiKeySecret(secret);

      expect(verifyApiKeySecret(wrongSecret, hash)).toBe(false);
    });

    it("rejects when secret or stored hash is empty/missing", () => {
      expect(verifyApiKeySecret("", "somehash")).toBe(false);
      expect(verifyApiKeySecret("secret", "")).toBe(false);
    });
  });

  describe("parseApiKey", () => {
    it("parses valid tf_<prefix>_<secret> format", () => {
      const raw = "tf_0123456789abcdef_fedcba9876543210fedcba9876543210";
      const parsed = parseApiKey(raw);

      expect(parsed).toEqual({
        prefix: "0123456789abcdef",
        secret: "fedcba9876543210fedcba9876543210",
      });
    });

    it("returns null for malformed or missing prefix/secret strings", () => {
      expect(parseApiKey("")).toBeNull();
      expect(parseApiKey("invalid_token")).toBeNull();
      expect(parseApiKey("jwt.token.here")).toBeNull();
      expect(parseApiKey("tf_prefixonly")).toBeNull();
      expect(parseApiKey("tf__secret")).toBeNull();
      expect(parseApiKey("tf_prefix_")).toBeNull();
      expect(parseApiKey("tf_prefix_secret_extra")).toBeNull();
      expect(parseApiKey(null as unknown as string)).toBeNull();
      expect(parseApiKey(undefined as unknown as string)).toBeNull();
    });
  });
});
