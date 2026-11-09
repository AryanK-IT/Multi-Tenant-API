import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { authService } from "../../src/auth/auth.service";
import { createTwoOrgFixture } from "../helpers/two-org-fixture";

vi.mock("../../src/auth/auth.service");

describe("Auth HTTP Endpoints Integration", () => {
  const app = createApp();
  const fixture = createTwoOrgFixture();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/v1/auth/signup", () => {
    it("returns 400 validation error on short password or missing fields", async () => {
      const response = await request(app).post("/api/v1/auth/signup").send({
        email: "not-an-email",
        password: "short",
        orgName: "",
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.details.length).toBeGreaterThan(0);
    });

    it("returns 201 on successful signup", async () => {
      vi.mocked(authService.signup).mockResolvedValueOnce({
        user: { id: "usr-1", email: "user@example.com" },
        org: { id: "org-1", name: "Acme" },
        role: "owner",
        tokens: {
          accessToken: "sample.jwt.token",
          refreshToken: "sample_refresh_token",
          expiresIn: 900,
        },
      });

      const response = await request(app).post("/api/v1/auth/signup").send({
        email: "user@example.com",
        password: "LongSecurePassword123!",
        orgName: "Acme",
      });

      expect(response.status).toBe(201);
      expect(response.body.user.email).toBe("user@example.com");
      expect(response.body.tokens.accessToken).toBe("sample.jwt.token");
    });
  });

  describe("POST /api/v1/auth/login", () => {
    it("returns 200 and auth credentials on valid login", async () => {
      vi.mocked(authService.login).mockResolvedValueOnce({
        user: { id: "usr-1", email: "user@example.com" },
        org: { id: "org-1", name: "Acme" },
        role: "owner",
        tokens: {
          accessToken: "login.access.token",
          refreshToken: "login.refresh.token",
          expiresIn: 900,
        },
      });

      const response = await request(app).post("/api/v1/auth/login").send({
        email: "user@example.com",
        password: "LongSecurePassword123!",
      });

      expect(response.status).toBe(200);
      expect(response.body.tokens.accessToken).toBe("login.access.token");
    });
  });

  describe("POST /api/v1/auth/refresh", () => {
    it("returns 200 with refreshed token pair", async () => {
      vi.mocked(authService.refresh).mockResolvedValueOnce({
        tokens: {
          accessToken: "new.access.token",
          refreshToken: "new.refresh.token",
          expiresIn: 900,
        },
      });

      const response = await request(app).post("/api/v1/auth/refresh").send({
        refreshToken: "valid.refresh.token",
      });

      expect(response.status).toBe(200);
      expect(response.body.tokens.accessToken).toBe("new.access.token");
    });
  });

  describe("POST /api/v1/auth/logout", () => {
    it("returns 200 after revoking refresh token", async () => {
      vi.mocked(authService.logout).mockResolvedValueOnce();

      const response = await request(app).post("/api/v1/auth/logout").send({
        refreshToken: "active.refresh.token",
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe("POST /api/v1/auth/password/forgot & /reset", () => {
    it("POST /auth/password/forgot returns neutral success confirmation", async () => {
      vi.mocked(authService.requestPasswordReset).mockResolvedValueOnce({
        message: "If that email address is registered, a password reset link has been sent.",
      });

      const response = await request(app).post("/api/v1/auth/password/forgot").send({
        email: "user@example.com",
      });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain("If that email address is registered");
    });

    it("POST /auth/password/reset returns success confirmation", async () => {
      vi.mocked(authService.resetPassword).mockResolvedValueOnce({
        message: "Password has been successfully reset. Please log in with your new password.",
      });

      const response = await request(app).post("/api/v1/auth/password/reset").send({
        token: "sample-reset-token",
        newPassword: "BrandNewPassword123!",
      });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain("Password has been successfully reset");
    });
  });

  describe("Protected /auth/me tenant context resolution", () => {
    it("returns 401 when no token is supplied", async () => {
      const response = await request(app).get("/api/v1/auth/me");
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("correctly identifies Org A member and attaches Org A tenant context", async () => {
      const response = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${fixture.orgA.owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.auth.userId).toBe(fixture.orgA.owner.id);
      expect(response.body.auth.orgId).toBe(fixture.orgA.id);
      expect(response.body.auth.role).toBe("owner");
      expect(response.body.tenant.orgId).toBe(fixture.orgA.id);
    });

    it("correctly identifies Org B member and attaches Org B tenant context", async () => {
      const response = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${fixture.orgB.member.token}`);

      expect(response.status).toBe(200);
      expect(response.body.auth.userId).toBe(fixture.orgB.member.id);
      expect(response.body.auth.orgId).toBe(fixture.orgB.id);
      expect(response.body.auth.role).toBe("member");
      expect(response.body.tenant.orgId).toBe(fixture.orgB.id);
    });
  });
});
