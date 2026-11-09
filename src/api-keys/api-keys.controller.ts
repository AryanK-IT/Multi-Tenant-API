import { Request, Response, NextFunction } from "express";
import { apiKeysService } from "./api-keys.service";

export class ApiKeysController {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const userId = req.auth!.userId!;
      const result = await apiKeysService.createApiKey(orgId, userId, req.body, req.ip);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const result = await apiKeysService.listApiKeys(orgId, req.query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async revoke(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const userId = req.auth!.userId!;
      const apiKeyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await apiKeysService.revokeApiKey(orgId, apiKeyId, userId, req.ip);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const apiKeysController = new ApiKeysController();
