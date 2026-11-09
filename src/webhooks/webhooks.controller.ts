import { Request, Response, NextFunction } from "express";
import { webhooksService } from "./webhooks.service";

export class WebhooksController {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const userId = req.auth!.userId!;
      const result = await webhooksService.createWebhook(orgId, userId, req.body, req.ip);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const result = await webhooksService.listWebhooks(orgId, req.query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const webhookId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await webhooksService.getWebhook(orgId, webhookId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const userId = req.auth!.userId!;
      const webhookId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await webhooksService.updateWebhook(
        orgId,
        webhookId,
        userId,
        req.body,
        req.ip
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const userId = req.auth!.userId!;
      const webhookId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await webhooksService.deleteWebhook(orgId, webhookId, userId, req.ip);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async listDeliveries(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const webhookId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await webhooksService.listDeliveries(orgId, webhookId, req.query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const webhooksController = new WebhooksController();
