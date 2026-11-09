import { Router } from "express";
import { orgsController } from "./orgs.controller";
import { authenticate } from "../middleware/authenticate";
import { tenantContext } from "../middleware/tenant-context";
import { tenantRateLimiter } from "../rate-limit";
import { authorize } from "../middleware/authorize";

export const orgsRouter = Router();

// Apply authenticate, tenantContext, and rate limiting to all org routes
orgsRouter.use(authenticate, tenantContext, tenantRateLimiter);

// Org details
orgsRouter.get("/me", (req, res, next) => orgsController.getOrg(req, res, next));

// Ownership transfer (Owner only per SRS §3.8)
orgsRouter.post("/transfer-ownership", authorize("ownership:transfer"), (req, res, next) =>
  orgsController.transferOwnership(req, res, next)
);

// Members
orgsRouter.get("/members", authorize("members:view"), (req, res, next) =>
  orgsController.listMembers(req, res, next)
);

orgsRouter.patch("/members/:userId", authorize("members:manage_member"), (req, res, next) =>
  orgsController.updateMemberRole(req, res, next)
);

orgsRouter.delete("/members/:userId", authorize("members:manage_member"), (req, res, next) =>
  orgsController.removeMember(req, res, next)
);

// Invitations
orgsRouter.post("/invitations", authorize("members:invite"), (req, res, next) =>
  orgsController.createInvitation(req, res, next)
);

orgsRouter.get("/invitations", authorize("members:invite"), (req, res, next) =>
  orgsController.listInvitations(req, res, next)
);

orgsRouter.delete("/invitations/:id", authorize("members:invite"), (req, res, next) =>
  orgsController.revokeInvitation(req, res, next)
);
