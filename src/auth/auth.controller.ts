import { Request, Response, NextFunction } from "express";
import { authService } from "./auth.service";
import {
  signupSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  acceptInvitationSchema,
} from "./schemas";
import { UnauthenticatedError } from "../common/errors";

export class AuthController {
  async signup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsedBody = signupSchema.parse(req.body);
      const result = await authService.signup(parsedBody, req.ip);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsedBody = loginSchema.parse(req.body);
      const result = await authService.login(parsedBody);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsedBody = refreshSchema.parse(req.body);
      const result = await authService.refresh(parsedBody.refreshToken);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsedBody = logoutSchema.parse(req.body);
      await authService.logout(parsedBody.refreshToken);
      res.status(200).json({ success: true, message: "Logged out successfully." });
    } catch (err) {
      next(err);
    }
  }

  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsedBody = forgotPasswordSchema.parse(req.body);
      const result = await authService.requestPasswordReset(parsedBody.email);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsedBody = resetPasswordSchema.parse(req.body);
      const result = await authService.resetPassword(parsedBody);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async acceptInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsedBody = acceptInvitationSchema.parse(req.body);
      const userId = req.auth?.userId;
      if (!userId) {
        throw new UnauthenticatedError("Authentication required to accept invitation.");
      }
      const result = await authService.acceptInvitation(userId, parsedBody.token, req.ip);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
