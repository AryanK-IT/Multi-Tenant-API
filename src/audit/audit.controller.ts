import { Request, Response, NextFunction } from "express";
import { auditService } from "./audit.service";
import { listAuditLogsQuerySchema } from "./schemas";

export class AuditController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const parsedQuery = listAuditLogsQuerySchema.parse(req.query);
      const result = await auditService.listAuditLogs(orgId, parsedQuery);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const auditController = new AuditController();
