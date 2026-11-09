import { describe, it, expect } from "vitest";
import {
  generateWebhookSecret,
  encryptSecret,
  decryptSecret,
  signWebhookPayload,
  verifyWebhookSignature,
} from "../../src/webhooks/crypto";

describe("Webhook Cryptography & Signatures (SRS §3.5 FR-18, FR-20, §5.1)", () => {
  const testKeyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  describe("generateWebhookSecret", () => {
    it("generates a high-entropy secret with whsec_ prefix and 64 hex characters", () => {
      const secret = generateWebhookSecret();
      expect(secret).toMatch(/^whsec_[0-9a-f]{64}$/);
      expect(secret.length).toBe(70);
    });

    it("generates distinct secrets on successive calls", () => {
      const s1 = generateWebhookSecret();
      const s2 = generateWebhookSecret();
      expect(s1).not.toBe(s2);
    });
  });

  describe("encryptSecret and decryptSecret (AES-256-GCM)", () => {
    it("successfully encrypts and decrypts a webhook signing secret", () => {
      const rawSecret = generateWebhookSecret();
      const encrypted = encryptSecret(rawSecret, testKeyHex);

      expect(encrypted).not.toBe(rawSecret);
      expect(encrypted.split(":")).toHaveLength(3);

      const decrypted = decryptSecret(encrypted, testKeyHex);
      expect(decrypted).toBe(rawSecret);
    });

    it("produces distinct ciphertexts for identical plaintext due to random IV", () => {
      const secret = "whsec_test_secret_for_iv_randomness_1234567890abcdef";
      const enc1 = encryptSecret(secret, testKeyHex);
      const enc2 = encryptSecret(secret, testKeyHex);

      expect(enc1).not.toBe(enc2);
      expect(decryptSecret(enc1, testKeyHex)).toBe(secret);
      expect(decryptSecret(enc2, testKeyHex)).toBe(secret);
    });

    it("fails decryption if auth tag is tampered with (GCM authentication check)", () => {
      const rawSecret = generateWebhookSecret();
      const encrypted = encryptSecret(rawSecret, testKeyHex);
      const [ivHex, authTagHex, ciphertextHex] = encrypted.split(":");

      // Tamper with the auth tag
      const tamperedTag = (parseInt(authTagHex[0], 16) ^ 1).toString(16) + authTagHex.slice(1);
      const tamperedEncrypted = `${ivHex}:${tamperedTag}:${ciphertextHex}`;

      expect(() => decryptSecret(tamperedEncrypted, testKeyHex)).toThrow();
    });

    it("fails decryption if ciphertext is tampered with", () => {
      const rawSecret = generateWebhookSecret();
      const encrypted = encryptSecret(rawSecret, testKeyHex);
      const [ivHex, authTagHex, ciphertextHex] = encrypted.split(":");

      const tamperedCiphertext =
        (parseInt(ciphertextHex[0], 16) ^ 1).toString(16) + ciphertextHex.slice(1);
      const tamperedEncrypted = `${ivHex}:${authTagHex}:${tamperedCiphertext}`;

      expect(() => decryptSecret(tamperedEncrypted, testKeyHex)).toThrow();
    });

    it("throws an error if encryption key is not 32 bytes (64 hex characters)", () => {
      expect(() => encryptSecret("secret", "invalid_short_key")).toThrow(/must be 32 bytes/);
    });
  });

  describe("signWebhookPayload and verifyWebhookSignature", () => {
    const secret = "whsec_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const payload = JSON.stringify({
      event: "task.created",
      id: "evt_123",
      data: { title: "Test" },
    });
    const now = Math.floor(Date.now() / 1000);

    it("generates HMAC-SHA256 signature in sha256=<hex> format", () => {
      const sig = signWebhookPayload(secret, now, payload);
      expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    });

    it("verifies a valid signature successfully within tolerance window", () => {
      const signature = signWebhookPayload(secret, now, payload);
      const isValid = verifyWebhookSignature({
        secret,
        signatureHeader: signature,
        timestampHeader: now,
        payload,
        toleranceSeconds: 300,
        currentTimestamp: now,
      });

      expect(isValid).toBe(true);
    });

    it("verifies successfully when timestamp is a string", () => {
      const signature = signWebhookPayload(secret, now, payload);
      const isValid = verifyWebhookSignature({
        secret,
        signatureHeader: signature,
        timestampHeader: now.toString(),
        payload,
        toleranceSeconds: 300,
        currentTimestamp: now,
      });

      expect(isValid).toBe(true);
    });

    it("rejects signatures older than tolerance window (replay protection)", () => {
      const oldTimestamp = now - 301; // 301s ago (> 300s window)
      const signature = signWebhookPayload(secret, oldTimestamp, payload);

      const isValid = verifyWebhookSignature({
        secret,
        signatureHeader: signature,
        timestampHeader: oldTimestamp,
        payload,
        toleranceSeconds: 300,
        currentTimestamp: now,
      });

      expect(isValid).toBe(false);
    });

    it("rejects future timestamps beyond tolerance window", () => {
      const futureTimestamp = now + 350;
      const signature = signWebhookPayload(secret, futureTimestamp, payload);

      const isValid = verifyWebhookSignature({
        secret,
        signatureHeader: signature,
        timestampHeader: futureTimestamp,
        payload,
        toleranceSeconds: 300,
        currentTimestamp: now,
      });

      expect(isValid).toBe(false);
    });

    it("rejects signature when payload body is modified", () => {
      const signature = signWebhookPayload(secret, now, payload);
      const tamperedPayload = JSON.stringify({ ...JSON.parse(payload), tampered: true });

      const isValid = verifyWebhookSignature({
        secret,
        signatureHeader: signature,
        timestampHeader: now,
        payload: tamperedPayload,
        currentTimestamp: now,
      });

      expect(isValid).toBe(false);
    });

    it("rejects signature when secret does not match", () => {
      const signature = signWebhookPayload(secret, now, payload);
      const differentSecret =
        "whsec_fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

      const isValid = verifyWebhookSignature({
        secret: differentSecret,
        signatureHeader: signature,
        timestampHeader: now,
        payload,
        currentTimestamp: now,
      });

      expect(isValid).toBe(false);
    });

    it("rejects invalid or malformed timestamp header", () => {
      const signature = signWebhookPayload(secret, now, payload);

      const isValid = verifyWebhookSignature({
        secret,
        signatureHeader: signature,
        timestampHeader: "invalid_timestamp",
        payload,
        currentTimestamp: now,
      });

      expect(isValid).toBe(false);
    });
  });
});
