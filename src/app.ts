import express, { Express, Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { requestIdMiddleware } from "./common/request-id";
import { errorHandler } from "./common/error-envelope";
import { NotFoundError } from "./common/errors";
import { authRouter } from "./auth/auth.routes";
import { orgsRouter } from "./orgs/orgs.routes";
import { projectsRouter } from "./projects/projects.routes";
import { tasksRouter } from "./tasks/tasks.routes";
import { auditLogRouter } from "./audit/audit.routes";
import { apiKeysRouter } from "./api-keys/api-keys.routes";
import { webhooksRouter } from "./webhooks/webhooks.routes";
import { docsRouter } from "./docs";
import { authenticate } from "./middleware/authenticate";
import { tenantContext } from "./middleware/tenant-context";
import { tenantRateLimiter, setRateLimitStore, RateLimitStore } from "./rate-limit";

export interface ReadinessCheckers {
  checkDatabase?: () => Promise<boolean>;
  checkRedis?: () => Promise<boolean>;
}

export interface AppOptions extends ReadinessCheckers {
  rateLimitStore?: RateLimitStore;
}

export function createApp(options: AppOptions = {}): Express {
  if (options.rateLimitStore) {
    setRateLimitStore(options.rateLimitStore);
  }

  const app = express();

  // Trust first proxy hop (ALB, Nginx) for accurate client IP in rate limiting
  app.set("trust proxy", 1);

  // Security headers & CORS
  app.use(helmet());
  app.use(cors());

  // Request body parsing
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  // Attach Request ID and Child Logger
  app.use(requestIdMiddleware);

  // Request logging
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      req.log.info(
        {
          method: req.method,
          url: req.originalUrl,
          statusCode: res.statusCode,
          durationMs: duration,
        },
        "HTTP request completed"
      );
    });
    next();
  });

  // Liveness check (GET /health)
  app.get("/health", (req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness check (GET /ready) - verifies DB & Redis readiness
  app.get("/ready", async (req: Request, res: Response) => {
    const checks: Record<string, "ok" | "failed" | "not_configured"> = {
      database: "not_configured",
      redis: "not_configured",
    };

    let allReady = true;

    if (options.checkDatabase) {
      try {
        const isDbReady = await options.checkDatabase();
        checks.database = isDbReady ? "ok" : "failed";
        if (!isDbReady) allReady = false;
      } catch {
        checks.database = "failed";
        allReady = false;
      }
    } else {
      checks.database = "ok";
    }

    if (options.checkRedis) {
      try {
        const isRedisReady = await options.checkRedis();
        checks.redis = isRedisReady ? "ok" : "failed";
        if (!isRedisReady) allReady = false;
      } catch {
        checks.redis = "failed";
        allReady = false;
      }
    } else {
      checks.redis = "ok";
    }

    const statusCode = allReady ? 200 : 503;
    res.status(statusCode).json({
      status: allReady ? "ready" : "not_ready",
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  // Current session information (GET /api/v1/auth/me & /auth/me)
  app.get(
    "/auth/me",
    authenticate,
    tenantContext,
    tenantRateLimiter,
    (req: Request, res: Response) => {
      res.status(200).json({
        auth: req.auth,
        tenant: req.tenant,
      });
    }
  );

  // Versioned API v1 Router
  const apiV1Router = express.Router();
  apiV1Router.use("/auth", authRouter);
  apiV1Router.use("/orgs", orgsRouter);
  apiV1Router.use("/projects", projectsRouter);
  apiV1Router.use("/tasks", tasksRouter);
  apiV1Router.use("/audit-log", auditLogRouter);
  apiV1Router.use("/api-keys", apiKeysRouter);
  apiV1Router.use("/webhooks", webhooksRouter);
  apiV1Router.get(
    "/auth/me",
    authenticate,
    tenantContext,
    tenantRateLimiter,
    (req: Request, res: Response) => {
      res.status(200).json({
        auth: req.auth,
        tenant: req.tenant,
      });
    }
  );

  // Mount API v1 router
  app.use("/api/v1", apiV1Router);

  // Mount /auth, /orgs, /projects, /tasks, /audit-log, /api-keys aliases for direct path access
  app.use("/auth", authRouter);
  app.use("/orgs", orgsRouter);
  app.use("/projects", projectsRouter);
  app.use("/tasks", tasksRouter);
  app.use("/audit-log", auditLogRouter);
  app.use("/api-keys", apiKeysRouter);
  app.use("/webhooks", webhooksRouter);

  // OpenAPI and Swagger documentation UI
  app.use("/api/docs", docsRouter);
  app.use("/docs", docsRouter);

  // Unmatched routes -> 404
  app.use((req: Request, res: Response, next: NextFunction) => {
    next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
  });

  // Global error handler
  app.use(errorHandler);

  return app;
}
