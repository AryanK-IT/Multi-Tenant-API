import { Router } from "express";
import { authController } from "./auth.controller";
import { authenticate } from "../middleware/authenticate";
import { authRateLimiter } from "../rate-limit";

export const authRouter = Router();

// Per-IP rate limiting applied to all auth endpoints (SRS §3.6 FR-22)
authRouter.use(authRateLimiter);

authRouter.post("/signup", (req, res, next) => authController.signup(req, res, next));
authRouter.post("/login", (req, res, next) => authController.login(req, res, next));
authRouter.post("/refresh", (req, res, next) => authController.refresh(req, res, next));
authRouter.post("/logout", (req, res, next) => authController.logout(req, res, next));
authRouter.post("/invite/accept", authenticate, (req, res, next) =>
  authController.acceptInvitation(req, res, next)
);
authRouter.post("/password/forgot", (req, res, next) =>
  authController.forgotPassword(req, res, next)
);
authRouter.post("/password/reset", (req, res, next) =>
  authController.resetPassword(req, res, next)
);
