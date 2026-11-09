import { Request, Response, NextFunction } from "express";
import { projectsService } from "./projects.service";

export class ProjectsController {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const userId = req.auth!.userId!;
      const project = await projectsService.createProject(orgId, userId, req.body);
      res.status(201).json(project);
    } catch (err) {
      next(err);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const result = await projectsService.listProjects(orgId, req.query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const projectId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const project = await projectsService.getProject(orgId, projectId);
      res.status(200).json(project);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const projectId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const project = await projectsService.updateProject(orgId, projectId, req.body);
      res.status(200).json(project);
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const projectId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await projectsService.deleteProject(
        orgId,
        projectId,
        req.auth?.userId,
        req.ip
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const projectsController = new ProjectsController();
