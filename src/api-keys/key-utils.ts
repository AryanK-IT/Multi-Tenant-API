import crypto from "crypto";

export interface GeneratedApiKey {
  prefix: string;
  secret: string;
  fullKey: string;
  hashedSecret: string;
}

export interface ParsedApiKey {
  prefix: string;
  secret: string;
}

/**
 * Computes the SHA-256 hash of an API key secret.
 * Per SRS §3.4 FR-15, secrets are stored hashed server-side.
 */
export function hashApiKeySecret(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * Verifies a candidate secret against a stored SHA-256 hash in constant time.
 */
export function verifyApiKeySecret(secret: string, storedHash: string): boolean {
  if (!secret || !storedHash) {
    return false;
  }

  const computedHash = hashApiKeySecret(secret);
  const bufComputed = Buffer.from(computedHash, "utf8");
  const bufStored = Buffer.from(storedHash, "utf8");

  if (bufComputed.length !== bufStored.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufComputed, bufStored);
}

/**
 * Parses an API key into prefix and secret parts.
 * Format: tf_<prefix>_<secret>
 */
export function parseApiKey(rawKey: string): ParsedApiKey | null {
  if (!rawKey || typeof rawKey !== "string") {
    return null;
  }

  if (!rawKey.startsWith("tf_")) {
    return null;
  }

  const parts = rawKey.split("_");
  if (parts.length !== 3) {
    return null;
  }

  const [header, prefix, secret] = parts;
  if (header !== "tf" || !prefix || !secret) {
    return null;
  }

  return { prefix, secret };
}

/**
 * Generates a new API key following the `tf_<prefix>_<secret>` format.
 * - prefix: 16 hex chars (8 random bytes) for database lookup
 * - secret: 48 hex chars (24 random bytes) high-entropy secret
 */
export function generateApiKey(): GeneratedApiKey {
  const prefix = crypto.randomBytes(8).toString("hex");
  const secret = crypto.randomBytes(24).toString("hex");
  const fullKey = `tf_${prefix}_${secret}`;
  const hashedSecret = hashApiKeySecret(secret);

  return {
    prefix,
    secret,
    fullKey,
    hashedSecret,
  };
}
