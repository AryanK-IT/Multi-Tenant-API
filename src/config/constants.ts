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
  SECRET_PREFIX: "whsec_",
} as const;

export const WEBHOOK_EVENTS = {
  PROJECT_CREATED: "project.created",
  PROJECT_UPDATED: "project.updated",
  PROJECT_DELETED: "project.deleted",
  TASK_CREATED: "task.created",
  TASK_UPDATED: "task.updated",
  TASK_DELETED: "task.deleted",
  TASK_STATUS_CHANGED: "task.status_changed",
  MEMBER_ADDED: "member.added",
  MEMBER_REMOVED: "member.removed",
} as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[keyof typeof WEBHOOK_EVENTS];

export const ALL_WEBHOOK_EVENTS: WebhookEvent[] = [
  WEBHOOK_EVENTS.PROJECT_CREATED,
  WEBHOOK_EVENTS.PROJECT_UPDATED,
  WEBHOOK_EVENTS.PROJECT_DELETED,
  WEBHOOK_EVENTS.TASK_CREATED,
  WEBHOOK_EVENTS.TASK_UPDATED,
  WEBHOOK_EVENTS.TASK_DELETED,
  WEBHOOK_EVENTS.TASK_STATUS_CHANGED,
  WEBHOOK_EVENTS.MEMBER_ADDED,
  WEBHOOK_EVENTS.MEMBER_REMOVED,
];

export const API_KEY_CONSTANTS = {
  PREFIX_HEADER: "tf_",
  THROTTLE_LAST_USED_MS: 60000, // update at most once per minute
} as const;

export const RATE_LIMIT_CONSTANTS = {
  AUTH_PER_IP: {
    LIMIT: 20, // 20 requests per minute per IP for auth endpoints (brute-force defense)
    WINDOW_MS: 60 * 1000,
    FAIL_CLOSED: true,
  },
  PER_ORG: {
    LIMIT: 1000, // 1000 requests per minute per organization
    WINDOW_MS: 60 * 1000,
    FAIL_CLOSED: false, // general limits fail open if Redis is down
  },
  PER_CREDENTIAL: {
    LIMIT: 200, // 200 requests per minute per credential (user or API key)
    WINDOW_MS: 60 * 1000,
    FAIL_CLOSED: false, // general limits fail open if Redis is down
  },
} as const;

export const ACTOR_TYPES = {
  USER: "user",
  API_KEY: "api_key",
  SYSTEM: "system",
} as const;

export type ActorType = (typeof ACTOR_TYPES)[keyof typeof ACTOR_TYPES];

export const AUDIT_ACTIONS = {
  MEMBER_INVITED: "member.invited",
  MEMBER_JOINED: "member.joined",
  MEMBER_ROLE_CHANGED: "member.role_changed",
  MEMBER_REMOVED: "member.removed",
  OWNERSHIP_TRANSFERRED: "ownership.transferred",
  PROJECT_DELETED: "project.deleted",
  API_KEY_CREATED: "api_key.created",
  API_KEY_REVOKED: "api_key.revoked",
  WEBHOOK_CREATED: "webhook.created",
  WEBHOOK_UPDATED: "webhook.updated",
  WEBHOOK_DELETED: "webhook.deleted",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
