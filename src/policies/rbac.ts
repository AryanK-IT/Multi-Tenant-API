import { Role, ApiKeyScope } from "../config/constants";
import { ForbiddenError } from "../common/errors";

export type Action =
  | "projects:view"
  | "tasks:view"
  | "projects:create"
  | "projects:edit"
  | "projects:delete"
  | "tasks:create"
  | "tasks:edit"
  | "tasks:assign"
  | "tasks:delete"
  | "members:view"
  | "members:invite"
  | "members:manage_member"
  | "members:manage_admin"
  | "ownership:transfer"
  | "api_keys:manage"
  | "webhooks:manage"
  | "audit_log:view";

export interface UserPrincipal {
  type: "user";
  userId: string;
  role: Role;
}

export interface ApiKeyPrincipal {
  type: "api_key";
  scope: ApiKeyScope;
}

export type Principal = UserPrincipal | ApiKeyPrincipal;

export interface PolicyContext {
  isTaskCreator?: boolean;
}

/**
 * Checks whether the given principal has permission to perform the requested action.
 * Strictly implements the SRS §3.8 Permission Matrix.
 */
export function hasPermission(
  principal: Principal,
  action: Action,
  context?: PolicyContext
): boolean {
  if (principal.type === "api_key") {
    // API keys represent service principals with scope; they never have access to administrative endpoints
    switch (action) {
      case "projects:view":
      case "tasks:view":
        // Both 'read' and 'read_write' can view
        return true;
      case "projects:create":
      case "projects:edit":
      case "tasks:create":
      case "tasks:edit":
      case "tasks:assign":
        // Only 'read_write' can mutate projects & tasks
        return principal.scope === "read_write";
      case "projects:delete":
      case "tasks:delete":
      case "members:view":
      case "members:invite":
      case "members:manage_member":
      case "members:manage_admin":
      case "ownership:transfer":
      case "api_keys:manage":
      case "webhooks:manage":
      case "audit_log:view":
        // API keys NEVER have these permissions
        return false;
      default:
        return false;
    }
  }

  // User principal
  const { role } = principal;

  switch (action) {
    case "projects:view":
    case "tasks:view":
      return true; // Owner, Admin, Member

    case "projects:create":
    case "projects:edit":
      return true; // Owner, Admin, Member

    case "projects:delete":
      return role === "owner" || role === "admin"; // Member cannot delete projects

    case "tasks:create":
    case "tasks:edit":
    case "tasks:assign":
      return true; // Owner, Admin, Member

    case "tasks:delete":
      if (role === "owner" || role === "admin") {
        return true;
      }
      if (role === "member") {
        return Boolean(context?.isTaskCreator);
      }
      return false;

    case "members:view":
      return true; // Owner, Admin, Member

    case "members:invite":
      return role === "owner" || role === "admin";

    case "members:manage_member":
      return role === "owner" || role === "admin";

    case "members:manage_admin":
      return role === "owner"; // Admin cannot manage Admin or Owner

    case "ownership:transfer":
      return role === "owner"; // Only current Owner can transfer ownership

    case "api_keys:manage":
    case "webhooks:manage":
    case "audit_log:view":
      return role === "owner" || role === "admin";

    default:
      return false;
  }
}

/**
 * Asserts that the principal has permission for the specified action; throws ForbiddenError if not.
 */
export function assertPermission(
  principal: Principal,
  action: Action,
  context?: PolicyContext
): void {
  if (!hasPermission(principal, action, context)) {
    throw new ForbiddenError("You do not have permission to perform this action.");
  }
}
