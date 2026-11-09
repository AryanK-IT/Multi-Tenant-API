import { Request, Response, NextFunction } from "express";
import { orgsService } from "./orgs.service";
import { createInvitationSchema, updateMemberRoleSchema, transferOwnershipSchema } from "./schemas";

export class OrgsController {
  async getOrg(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const org = await orgsService.getOrg(req.tenant!.orgId);
      res.status(200).json(org);
    } catch (err) {
      next(err);
    }
  }

  async listMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const members = await orgsService.listMembers(req.tenant!.orgId);
      res.status(200).json(members);
    } catch (err) {
      next(err);
    }
  }

  async updateMemberRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsedBody = updateMemberRoleSchema.parse(req.body);
      const targetUserId = Array.isArray(req.params.userId)
        ? req.params.userId[0]
        : req.params.userId;
      const result = await orgsService.updateMemberRole(
        req.auth!.role!,
        req.auth!.userId!,
        req.tenant!.orgId,
        targetUserId,
        parsedBody.role,
        req.ip
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async removeMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const targetUserId = Array.isArray(req.params.userId)
        ? req.params.userId[0]
        : req.params.userId;
      const result = await orgsService.removeMember(
        req.auth!.role!,
        req.auth!.userId!,
        req.tenant!.orgId,
        targetUserId,
        req.ip
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async transferOwnership(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsedBody = transferOwnershipSchema.parse(req.body);
      const result = await orgsService.transferOwnership(
        req.auth!.role!,
        req.auth!.userId!,
        req.tenant!.orgId,
        parsedBody.newOwnerUserId,
        req.ip
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async createInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsedBody = createInvitationSchema.parse(req.body);
      const result = await orgsService.createInvitation(
        req.auth!.userId!,
        req.tenant!.orgId,
        parsedBody,
        req.ip
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  async listInvitations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const invitations = await orgsService.listInvitations(req.tenant!.orgId);
      res.status(200).json(invitations);
    } catch (err) {
      next(err);
    }
  }

  async revokeInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const invitationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await orgsService.revokeInvitation(req.tenant!.orgId, invitationId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const orgsController = new OrgsController();
