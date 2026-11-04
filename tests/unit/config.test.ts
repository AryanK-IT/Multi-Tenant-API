import { describe, it, expect } from "vitest";
import { parseEnv } from "../../src/config/env";
import {
  ROLES,
  TASK_STATUSES,
  AUTH_CONSTANTS,
  WEBHOOK_CONSTANTS,
} from "../../src/config/constants";

describe("Configuration and Constants", () => {
  const validEnvInput = {
    NODE_ENV: "test",
    PORT: "4000",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
    REDIS_URL: "redis://localhost:6379",
    JWT_ACCESS_SECRET: "12345678901234567890123456789012",
    JWT_ACCESS_EXPIRATION: "15m",
    JWT_REFRESH_SECRET: "abcdefghijklmnopqrstuvwxyz123456",
    JWT_REFRESH_EXPIRATION_DAYS: "14",
    WEBHOOK_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    LOG_LEVEL: "debug",
  };

  it("parses valid environment configuration successfully", () => {
    const parsed = parseEnv(validEnvInput);
    expect(parsed.PORT).toBe(4000);
    expect(parsed.NODE_ENV).toBe("test");
    expect(parsed.JWT_REFRESH_EXPIRATION_DAYS).toBe(14);
    expect(parsed.LOG_LEVEL).toBe("debug");
  });

  it("applies default values for optional environment variables", () => {
    const minimalInput = {
      DATABASE_URL: "postgresql://localhost:5432/test",
      REDIS_URL: "redis://localhost:6379",
      JWT_ACCESS_SECRET: "12345678901234567890123456789012",
      JWT_REFRESH_SECRET: "abcdefghijklmnopqrstuvwxyz123456",
      WEBHOOK_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };
    const parsed = parseEnv(minimalInput);
    expect(parsed.PORT).toBe(3000);
    expect(parsed.NODE_ENV).toBe("development");
    expect(parsed.JWT_ACCESS_EXPIRATION).toBe("15m");
    expect(parsed.JWT_REFRESH_EXPIRATION_DAYS).toBe(7);
    expect(parsed.LOG_LEVEL).toBe("info");
  });

  it("throws validation error when required variables are missing", () => {
    expect(() => parseEnv({})).toThrow(/Invalid environment configuration/);
  });

  it("throws validation error when secrets are too short", () => {
    expect(() =>
      parseEnv({
        ...validEnvInput,
        JWT_ACCESS_SECRET: "too-short",
      })
    ).toThrow(/JWT_ACCESS_SECRET must be at least 32 characters/);
  });

  it("throws validation error when webhook encryption key is not 64 hex chars", () => {
    expect(() =>
      parseEnv({
        ...validEnvInput,
        WEBHOOK_ENCRYPTION_KEY: "short_key",
      })
    ).toThrow(/WEBHOOK_ENCRYPTION_KEY must be a 64-character hex string/);
  });

  it("validates core constants match SRS specifications", () => {
    expect(ROLES.OWNER).toBe("owner");
    expect(ROLES.ADMIN).toBe("admin");
    expect(ROLES.MEMBER).toBe("member");

    expect(TASK_STATUSES.TODO).toBe("todo");
    expect(TASK_STATUSES.IN_PROGRESS).toBe("in_progress");
    expect(TASK_STATUSES.DONE).toBe("done");

    expect(AUTH_CONSTANTS.PASSWORD_MIN_LENGTH).toBe(10);
    expect(WEBHOOK_CONSTANTS.MAX_ATTEMPTS).toBe(3);
    expect(WEBHOOK_CONSTANTS.TIMEOUT_MS).toBe(10000);
    expect(WEBHOOK_CONSTANTS.MAX_CONSECUTIVE_FAILURES).toBe(20);
    expect(WEBHOOK_CONSTANTS.TIMESTAMP_TOLERANCE_SECONDS).toBe(300);
  });
});
