import express, { Express, Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { requestIdMiddleware } from "./common/request-id";
import { errorHandler } from "./common/error-envelope";
import { NotFoundError } from "./common/errors";

export interface ReadinessCheckers {
  checkDatabase?: () => Promise<boolean>;
  checkRedis?: () => Promise<boolean>;
}

export function createApp(checkers: ReadinessCheckers = {}): Express {
  const app = express();

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

    if (checkers.checkDatabase) {
      try {
        const isDbReady = await checkers.checkDatabase();
        checks.database = isDbReady ? "ok" : "failed";
        if (!isDbReady) allReady = false;
      } catch {
        checks.database = "failed";
        allReady = false;
      }
    } else {
      checks.database = "ok";
    }

    if (checkers.checkRedis) {
      try {
        const isRedisReady = await checkers.checkRedis();
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

  // Unmatched routes -> 404
  app.use((req: Request, res: Response, next: NextFunction) => {
    next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
  });

  // Global error handler
  app.use(errorHandler);

  return app;
}
