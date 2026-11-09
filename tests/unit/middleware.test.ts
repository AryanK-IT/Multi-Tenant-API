import { describe, it, expect, vi } from "vitest";
import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../../src/middleware/authenticate";
import { tenantContext } from "../../src/middleware/tenant-context";
import { authorize } from "../../src/middleware/authorize";
import { validateBody } from "../../src/middleware/validate";
import { signAccessToken } from "../../src/auth/tokens";
import { UnauthenticatedError, ForbiddenError } from "../../src/common/errors";

describe("Middleware Suite", () => {
  const createMockReqRes = (headers: Record<string, string> = {}) => {
    const req = {
      headers,
    } as unknown as Request;

    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    return { req, res, next };
  };

  describe("authenticate middleware", () => {
    it("throws UnauthenticatedError when Authorization header is absent", () => {
      const { req, res, next } = createMockReqRes({});
      authenticate(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(UnauthenticatedError));
    });

    it("throws UnauthenticatedError when format is not Bearer <token>", () => {
      const { req, res, next } = createMockReqRes({ authorization: "Basic 12345" });
      authenticate(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(UnauthenticatedError));
    });

    it("attaches auth context on valid Bearer access token", () => {
      const token = signAccessToken({
        userId: "u-1",
        orgId: "org-1",
        role: "admin",
      });

      const { req, res, next } = createMockReqRes({ authorization: `Bearer ${token}` });
      authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.auth).toEqual({
        userId: "u-1",
        orgId: "org-1",
        role: "admin",
        isApiKey: false,
      });
    });
  });

  describe("tenantContext middleware", () => {
    it("throws UnauthenticatedError when auth context or orgId is missing", () => {
      const { req, res, next } = createMockReqRes();
      tenantContext(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(UnauthenticatedError));
    });

    it("attaches tenant context when auth has orgId", () => {
      const { req, res, next } = createMockReqRes();
      req.auth = {
        userId: "u-1",
        orgId: "org-99",
        role: "owner",
        isApiKey: false,
      };

      tenantContext(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.tenant).toEqual({ orgId: "org-99" });
    });
  });

  describe("authorize middleware", () => {
    it("allows request when principal has required permission", () => {
      const { req, res, next } = createMockReqRes();
      req.auth = {
        userId: "u-1",
        orgId: "org-1",
        role: "owner",
        isApiKey: false,
      };

      const middleware = authorize("projects:delete");
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it("rejects request with ForbiddenError when principal lacks permission", () => {
      const { req, res, next } = createMockReqRes();
      req.auth = {
        userId: "u-1",
        orgId: "org-1",
        role: "member",
        isApiKey: false,
      };

      const middleware = authorize("projects:delete");
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });
  });

  describe("validateBody middleware", () => {
    const testSchema = z.object({
      name: z.string().min(3),
    });

    it("passes through valid body", () => {
      const { req, res, next } = createMockReqRes();
      req.body = { name: "Valid Task" };

      const middleware = validateBody(testSchema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it("calls next with error for invalid body", () => {
      const { req, res, next } = createMockReqRes();
      req.body = { name: "ab" };

      const middleware = validateBody(testSchema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(z.ZodError));
    });
  });
});
