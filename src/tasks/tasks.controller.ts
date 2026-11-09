import { Request, Response, NextFunction } from "express";
import { tasksService } from "./tasks.service";
import { ForbiddenError } from "../common/errors";

export class TasksController {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const userId = req.auth!.userId!;
      const projectId = Array.isArray(req.params.projectId)
        ? req.params.projectId[0]
        : req.params.projectId;
      const task = await tasksService.createTask(orgId, userId, projectId, req.body);
      res.status(201).json(task);
    } catch (err) {
      next(err);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const projectId = Array.isArray(req.params.projectId)
        ? req.params.projectId[0]
        : req.params.projectId;
      const result = await tasksService.listTasks(orgId, projectId, req.query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const taskId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const task = await tasksService.getTask(orgId, taskId);
      res.status(200).json(task);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const taskId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const task = await tasksService.updateTask(orgId, taskId, req.body);
      res.status(200).json(task);
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.auth?.isApiKey) {
        throw new ForbiddenError("You do not have permission to delete this task.");
      }
      const orgId = req.tenant!.orgId;
      const taskId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const requester = {
        userId: req.auth!.userId,
        role: req.auth!.role,
        isApiKey: req.auth!.isApiKey,
      };
      const result = await tasksService.deleteTask(orgId, requester, taskId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const tasksController = new TasksController();
