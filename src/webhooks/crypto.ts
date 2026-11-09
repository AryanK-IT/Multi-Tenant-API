import crypto from "crypto";
import { env } from "../config/env";
import { WEBHOOK_CONSTANTS } from "../config/constants";

/**
 * Generates a high-entropy signing secret for a webhook endpoint (SRS §3.5 FR-18).
 * Format: whsec_<64 hex chars> (32 random bytes).
 */
export function generateWebhookSecret(): string {
  const randomBytes = crypto.randomBytes(32).toString("hex");
  return `${WEBHOOK_CONSTANTS.SECRET_PREFIX}${randomBytes}`;
}

/**
 * Encrypts a webhook signing secret at rest using AES-256-GCM (SRS §3.5 FR-18, §5.1).
 * Output format: <iv_hex>:<auth_tag_hex>:<ciphertext_hex>
 */
export function encryptSecret(secret: string, keyHex: string = env.WEBHOOK_ENCRYPTION_KEY): string {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("Invalid encryption key: must be 32 bytes (64 hex characters).");
  }

  // Standard 96-bit (12 bytes) IV for AES-GCM
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/**
 * Decrypts an encrypted webhook signing secret using AES-256-GCM (SRS §3.5 FR-18).
 */
export function decryptSecret(
  encryptedSecret: string,
  keyHex: string = env.WEBHOOK_ENCRYPTION_KEY
): string {
  const parts = encryptedSecret.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted secret format. Expected iv:authTag:ciphertext.");
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("Invalid encryption key: must be 32 bytes (64 hex characters).");
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString("utf8");
}

/**
 * Computes an HMAC-SHA256 signature for webhook delivery (SRS §3.5 FR-20).
 * Payload signed: timestamp + "." + canonicalBody
 * Return format: sha256=<hex_digest>
 */
export function signWebhookPayload(secret: string, timestamp: number, payloadJson: string): string {
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payloadJson}`)
    .digest("hex");

  return `sha256=${signature}`;
}

export interface VerifyWebhookSignatureOptions {
  secret: string;
  signatureHeader: string;
  timestampHeader: string | number;
  payload: string;
  toleranceSeconds?: number;
  currentTimestamp?: number;
}

/**
 * Verifies a webhook signature using constant-time comparison and replay attack protection (SRS §3.5 FR-20).
 */
export function verifyWebhookSignature({
  secret,
  signatureHeader,
  timestampHeader,
  payload,
  toleranceSeconds = WEBHOOK_CONSTANTS.TIMESTAMP_TOLERANCE_SECONDS,
  currentTimestamp = Math.floor(Date.now() / 1000),
}: VerifyWebhookSignatureOptions): boolean {
  const timestamp =
    typeof timestampHeader === "number" ? timestampHeader : parseInt(timestampHeader, 10);
  if (isNaN(timestamp)) {
    return false;
  }

  // Replay attack protection (reject timestamps older or newer than tolerance window)
  if (Math.abs(currentTimestamp - timestamp) > toleranceSeconds) {
    return false;
  }

  // Extract sha256 prefix if present
  const providedSignatureHex = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  const providedBuffer = Buffer.from(providedSignatureHex, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}
