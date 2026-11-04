export const ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const TASK_STATUSES = {
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  DONE: "done",
} as const;

export type TaskStatus = (typeof TASK_STATUSES)[keyof typeof TASK_STATUSES];

export const API_KEY_SCOPES = {
  READ: "read",
  READ_WRITE: "read_write",
} as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[keyof typeof API_KEY_SCOPES];

export const PAGINATION = {
  DEFAULT_LIMIT: 25,
  MAX_LIMIT: 100,
} as const;

export const AUTH_CONSTANTS = {
  PASSWORD_MIN_LENGTH: 10,
  ACCESS_TOKEN_EXPIRATION: "15m",
  REFRESH_TOKEN_EXPIRATION_DAYS: 7,
  INVITATION_EXPIRATION_DAYS: 7,
  PASSWORD_RESET_EXPIRATION_HOURS: 1,
} as const;

export const WEBHOOK_CONSTANTS = {
  MAX_ATTEMPTS: 3,
  TIMEOUT_MS: 10000,
  MAX_CONSECUTIVE_FAILURES: 20,
  TIMESTAMP_TOLERANCE_SECONDS: 300, // 5 minutes
} as const;

export const API_KEY_CONSTANTS = {
  PREFIX_HEADER: "tf_",
  THROTTLE_LAST_USED_MS: 60000, // update at most once per minute
} as const;
