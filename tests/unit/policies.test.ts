import { describe, it, expect } from "vitest";
import {
  hasPermission,
  assertPermission,
  Action,
  UserPrincipal,
  ApiKeyPrincipal,
} from "../../src/policies";
import { ForbiddenError } from "../../src/common/errors";

describe("RBAC Permission Matrix (SRS §3.8)", () => {
  const owner: UserPrincipal = { type: "user", role: "owner", userId: "user-owner" };
  const admin: UserPrincipal = { type: "user", role: "admin", userId: "user-admin" };
  const member: UserPrincipal = { type: "user", role: "member", userId: "user-member" };
  const apiKeyRead: ApiKeyPrincipal = { type: "api_key", scope: "read" };
  const apiKeyReadWrite: ApiKeyPrincipal = { type: "api_key", scope: "read_write" };

  describe("View projects and tasks", () => {
    const actions: Action[] = ["projects:view", "tasks:view"];

    it("allows Owner, Admin, Member, API key (read), and API key (read_write)", () => {
      for (const action of actions) {
        expect(hasPermission(owner, action)).toBe(true);
        expect(hasPermission(admin, action)).toBe(true);
        expect(hasPermission(member, action)).toBe(true);
        expect(hasPermission(apiKeyRead, action)).toBe(true);
        expect(hasPermission(apiKeyReadWrite, action)).toBe(true);
      }
    });
  });

  describe("Create / edit projects", () => {
    const actions: Action[] = ["projects:create", "projects:edit"];

    it("allows Owner, Admin, Member, and API key (read_write), but rejects API key (read)", () => {
      for (const action of actions) {
        expect(hasPermission(owner, action)).toBe(true);
        expect(hasPermission(admin, action)).toBe(true);
        expect(hasPermission(member, action)).toBe(true);
        expect(hasPermission(apiKeyRead, action)).toBe(false);
        expect(hasPermission(apiKeyReadWrite, action)).toBe(true);
      }
    });
  });

  describe("Delete project", () => {
    it("allows Owner and Admin; rejects Member and all API keys", () => {
      expect(hasPermission(owner, "projects:delete")).toBe(true);
      expect(hasPermission(admin, "projects:delete")).toBe(true);
      expect(hasPermission(member, "projects:delete")).toBe(false);
      expect(hasPermission(apiKeyRead, "projects:delete")).toBe(false);
      expect(hasPermission(apiKeyReadWrite, "projects:delete")).toBe(false);
    });
  });

  describe("Create / edit tasks and assign", () => {
    const actions: Action[] = ["tasks:create", "tasks:edit", "tasks:assign"];

    it("allows Owner, Admin, Member, and API key (read_write); rejects API key (read)", () => {
      for (const action of actions) {
        expect(hasPermission(owner, action)).toBe(true);
        expect(hasPermission(admin, action)).toBe(true);
        expect(hasPermission(member, action)).toBe(true);
        expect(hasPermission(apiKeyRead, action)).toBe(false);
        expect(hasPermission(apiKeyReadWrite, action)).toBe(true);
      }
    });
  });

  describe("Delete task", () => {
    it("allows Owner and Admin unconditionally", () => {
      expect(hasPermission(owner, "tasks:delete", { isTaskCreator: false })).toBe(true);
      expect(hasPermission(owner, "tasks:delete", { isTaskCreator: true })).toBe(true);
      expect(hasPermission(admin, "tasks:delete", { isTaskCreator: false })).toBe(true);
      expect(hasPermission(admin, "tasks:delete", { isTaskCreator: true })).toBe(true);
    });

    it("allows Member ONLY if they are the task creator", () => {
      expect(hasPermission(member, "tasks:delete", { isTaskCreator: true })).toBe(true);
      expect(hasPermission(member, "tasks:delete", { isTaskCreator: false })).toBe(false);
      expect(hasPermission(member, "tasks:delete")).toBe(false);
    });

    it("rejects API keys even with read_write scope", () => {
      expect(hasPermission(apiKeyRead, "tasks:delete")).toBe(false);
      expect(hasPermission(apiKeyReadWrite, "tasks:delete")).toBe(false);
    });
  });

  describe("View members", () => {
    it("allows Owner, Admin, Member; rejects all API keys", () => {
      expect(hasPermission(owner, "members:view")).toBe(true);
      expect(hasPermission(admin, "members:view")).toBe(true);
      expect(hasPermission(member, "members:view")).toBe(true);
      expect(hasPermission(apiKeyRead, "members:view")).toBe(false);
      expect(hasPermission(apiKeyReadWrite, "members:view")).toBe(false);
    });
  });

  describe("Invite members", () => {
    it("allows Owner and Admin; rejects Member and API keys", () => {
      expect(hasPermission(owner, "members:invite")).toBe(true);
      expect(hasPermission(admin, "members:invite")).toBe(true);
      expect(hasPermission(member, "members:invite")).toBe(false);
      expect(hasPermission(apiKeyRead, "members:invite")).toBe(false);
      expect(hasPermission(apiKeyReadWrite, "members:invite")).toBe(false);
    });
  });

  describe("Change role / remove Member", () => {
    it("allows Owner and Admin; rejects Member and API keys", () => {
      expect(hasPermission(owner, "members:manage_member")).toBe(true);
      expect(hasPermission(admin, "members:manage_member")).toBe(true);
      expect(hasPermission(member, "members:manage_member")).toBe(false);
      expect(hasPermission(apiKeyRead, "members:manage_member")).toBe(false);
      expect(hasPermission(apiKeyReadWrite, "members:manage_member")).toBe(false);
    });
  });

  describe("Change role / remove Admin", () => {
    it("allows Owner ONLY; rejects Admin (preventing admin coup), Member, and API keys", () => {
      expect(hasPermission(owner, "members:manage_admin")).toBe(true);
      expect(hasPermission(admin, "members:manage_admin")).toBe(false);
      expect(hasPermission(member, "members:manage_admin")).toBe(false);
      expect(hasPermission(apiKeyRead, "members:manage_admin")).toBe(false);
      expect(hasPermission(apiKeyReadWrite, "members:manage_admin")).toBe(false);
    });
  });

  describe("Transfer ownership", () => {
    it("allows Owner ONLY; rejects Admin, Member, and API keys", () => {
      expect(hasPermission(owner, "ownership:transfer")).toBe(true);
      expect(hasPermission(admin, "ownership:transfer")).toBe(false);
      expect(hasPermission(member, "ownership:transfer")).toBe(false);
      expect(hasPermission(apiKeyRead, "ownership:transfer")).toBe(false);
      expect(hasPermission(apiKeyReadWrite, "ownership:transfer")).toBe(false);
    });
  });

  describe("Manage API keys", () => {
    it("allows Owner and Admin; rejects Member and API keys", () => {
      expect(hasPermission(owner, "api_keys:manage")).toBe(true);
      expect(hasPermission(admin, "api_keys:manage")).toBe(true);
      expect(hasPermission(member, "api_keys:manage")).toBe(false);
      expect(hasPermission(apiKeyRead, "api_keys:manage")).toBe(false);
      expect(hasPermission(apiKeyReadWrite, "api_keys:manage")).toBe(false);
    });
  });

  describe("Manage webhooks / view deliveries", () => {
    it("allows Owner and Admin; rejects Member and API keys", () => {
      expect(hasPermission(owner, "webhooks:manage")).toBe(true);
      expect(hasPermission(admin, "webhooks:manage")).toBe(true);
      expect(hasPermission(member, "webhooks:manage")).toBe(false);
      expect(hasPermission(apiKeyRead, "webhooks:manage")).toBe(false);
      expect(hasPermission(apiKeyReadWrite, "webhooks:manage")).toBe(false);
    });
  });

  describe("View audit log", () => {
    it("allows Owner and Admin; rejects Member and API keys", () => {
      expect(hasPermission(owner, "audit_log:view")).toBe(true);
      expect(hasPermission(admin, "audit_log:view")).toBe(true);
      expect(hasPermission(member, "audit_log:view")).toBe(false);
      expect(hasPermission(apiKeyRead, "audit_log:view")).toBe(false);
      expect(hasPermission(apiKeyReadWrite, "audit_log:view")).toBe(false);
    });
  });

  describe("assertPermission helper", () => {
    it("does not throw when permitted", () => {
      expect(() => assertPermission(owner, "projects:delete")).not.toThrow();
    });

    it("throws ForbiddenError when denied", () => {
      expect(() => assertPermission(member, "projects:delete")).toThrow(ForbiddenError);
    });
  });
});
