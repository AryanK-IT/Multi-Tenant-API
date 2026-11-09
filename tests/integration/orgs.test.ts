import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { orgsService } from "../../src/orgs/orgs.service";
import { authService } from "../../src/auth/auth.service";
import { createTwoOrgFixture } from "../helpers/two-org-fixture";

vi.mock("../../src/orgs/orgs.service");
vi.mock("../../src/auth/auth.service");

describe("Orgs & Members HTTP Endpoints Integration (Phase 3)", () => {
  const app = createApp();
  const { orgA } = createTwoOrgFixture();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication and Authorization guards", () => {
    it("returns 401 when Authorization header is missing", async () => {
      const response = await request(app).get("/api/v1/orgs/me");
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 403 when Member tries to transfer ownership", async () => {
      const response = await request(app)
        .post("/api/v1/orgs/transfer-ownership")
        .set("Authorization", `Bearer ${orgA.member.token}`)
        .send({ newOwnerUserId: "00000000-0000-0000-0000-000000000001" });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    });

    it("returns 403 when Member tries to create an invitation", async () => {
      const response = await request(app)
        .post("/api/v1/orgs/invitations")
        .set("Authorization", `Bearer ${orgA.member.token}`)
        .send({ email: "invitee@example.com", role: "member" });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("GET /api/v1/orgs/me", () => {
    it("returns 200 with org details for authenticated member", async () => {
      vi.mocked(orgsService.getOrg).mockResolvedValueOnce({
        id: orgA.id,
        name: orgA.name,
        createdAt: new Date(),
      });

      const response = await request(app)
        .get("/api/v1/orgs/me")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(orgA.id);
      expect(response.body.name).toBe(orgA.name);
    });
  });

  describe("GET /api/v1/orgs/members", () => {
    it("returns 200 and list of members", async () => {
      vi.mocked(orgsService.listMembers).mockResolvedValueOnce([
        {
          userId: orgA.owner.id,
          email: orgA.owner.email,
          role: "owner",
          joinedAt: new Date(),
        },
        {
          userId: orgA.admin.id,
          email: orgA.admin.email,
          role: "admin",
          joinedAt: new Date(),
        },
      ]);

      const response = await request(app)
        .get("/api/v1/orgs/members")
        .set("Authorization", `Bearer ${orgA.member.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(2);
    });
  });

  describe("PATCH /api/v1/orgs/members/:userId", () => {
    it("returns 200 on role update by Owner", async () => {
      vi.mocked(orgsService.updateMemberRole).mockResolvedValueOnce({
        userId: orgA.member.id,
        orgId: orgA.id,
        role: "admin",
      });

      const response = await request(app)
        .patch(`/api/v1/orgs/members/${orgA.member.id}`)
        .set("Authorization", `Bearer ${orgA.owner.token}`)
        .send({ role: "admin" });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe("admin");
    });

    it("returns 400 validation error on invalid role string", async () => {
      const response = await request(app)
        .patch(`/api/v1/orgs/members/${orgA.member.id}`)
        .set("Authorization", `Bearer ${orgA.owner.token}`)
        .send({ role: "invalid-role" });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("DELETE /api/v1/orgs/members/:userId", () => {
    it("returns 200 when Admin removes a Member", async () => {
      vi.mocked(orgsService.removeMember).mockResolvedValueOnce({
        message: "Member removed successfully.",
      });

      const response = await request(app)
        .delete(`/api/v1/orgs/members/${orgA.member.id}`)
        .set("Authorization", `Bearer ${orgA.admin.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Member removed successfully.");
    });
  });

  describe("POST /api/v1/orgs/transfer-ownership", () => {
    it("returns 200 when Owner transfers ownership to another member", async () => {
      vi.mocked(orgsService.transferOwnership).mockResolvedValueOnce({
        message: "Ownership transferred successfully.",
        previousOwnerUserId: orgA.owner.id,
        newOwnerUserId: orgA.admin.id,
      });

      const response = await request(app)
        .post("/api/v1/orgs/transfer-ownership")
        .set("Authorization", `Bearer ${orgA.owner.token}`)
        .send({ newOwnerUserId: "00000000-0000-0000-0000-000000000001" });

      expect(response.status).toBe(200);
      expect(response.body.newOwnerUserId).toBe(orgA.admin.id);
    });

    it("returns 403 when Admin attempts to transfer ownership", async () => {
      const response = await request(app)
        .post("/api/v1/orgs/transfer-ownership")
        .set("Authorization", `Bearer ${orgA.admin.token}`)
        .send({ newOwnerUserId: "00000000-0000-0000-0000-000000000001" });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("POST /api/v1/orgs/invitations", () => {
    it("returns 201 when Owner or Admin creates an invitation", async () => {
      vi.mocked(orgsService.createInvitation).mockResolvedValueOnce({
        id: "inv-new-id",
        orgId: orgA.id,
        email: "invited@acme.com",
        role: "member",
        expiresAt: new Date(),
        createdAt: new Date(),
        invitationToken: "raw-token-123",
      });

      const response = await request(app)
        .post("/api/v1/orgs/invitations")
        .set("Authorization", `Bearer ${orgA.admin.token}`)
        .send({ email: "invited@acme.com", role: "member" });

      expect(response.status).toBe(201);
      expect(response.body.email).toBe("invited@acme.com");
      expect(response.body.invitationToken).toBe("raw-token-123");
    });

    it("returns 400 validation error if role is 'owner'", async () => {
      const response = await request(app)
        .post("/api/v1/orgs/invitations")
        .set("Authorization", `Bearer ${orgA.admin.token}`)
        .send({ email: "invited@acme.com", role: "owner" });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("GET /api/v1/orgs/invitations", () => {
    it("returns 200 and pending invitations list", async () => {
      vi.mocked(orgsService.listInvitations).mockResolvedValueOnce([
        {
          id: "inv-1",
          orgId: orgA.id,
          email: "invited@acme.com",
          role: "member",
          invitedById: orgA.owner.id,
          expiresAt: new Date(),
          createdAt: new Date(),
        },
      ]);

      const response = await request(app)
        .get("/api/v1/orgs/invitations")
        .set("Authorization", `Bearer ${orgA.owner.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body[0].email).toBe("invited@acme.com");
    });
  });

  describe("DELETE /api/v1/orgs/invitations/:id", () => {
    it("returns 200 when invitation is revoked", async () => {
      vi.mocked(orgsService.revokeInvitation).mockResolvedValueOnce({
        message: "Invitation revoked successfully.",
      });

      const response = await request(app)
        .delete("/api/v1/orgs/invitations/inv-1")
        .set("Authorization", `Bearer ${orgA.admin.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Invitation revoked successfully.");
    });
  });

  describe("POST /api/v1/auth/invite/accept", () => {
    it("returns 200 when authenticated user accepts invitation", async () => {
      vi.mocked(authService.acceptInvitation).mockResolvedValueOnce({
        message: "Invitation accepted successfully.",
        org: { id: "org-new", name: "New Org" },
        role: "admin",
        tokens: {
          accessToken: "new.jwt.token",
          refreshToken: "new_refresh_token",
          expiresIn: 900,
        },
      });

      const response = await request(app)
        .post("/api/v1/auth/invite/accept")
        .set("Authorization", `Bearer ${orgA.member.token}`)
        .send({ token: "valid-invite-token" });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe("admin");
      expect(response.body.tokens.accessToken).toBe("new.jwt.token");
    });

    it("returns 400 validation error when token is missing", async () => {
      const response = await request(app)
        .post("/api/v1/auth/invite/accept")
        .set("Authorization", `Bearer ${orgA.member.token}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
