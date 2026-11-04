import pino from "pino";
import { env } from "../config/env";

export const logger = pino({
  level: env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "password",
      "*.password",
      "passwordHash",
      "*.passwordHash",
      "token",
      "*.token",
      "refreshToken",
      "*.refreshToken",
      "secret",
      "*.secret",
      "hashedSecret",
      "*.hashedSecret",
      "encryptedSecret",
      "*.encryptedSecret",
      "req.headers.authorization",
      "headers.authorization",
      "req.headers.cookie",
      "headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});
