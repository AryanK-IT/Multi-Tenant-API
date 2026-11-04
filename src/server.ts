import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./common/logger";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV },
    `TaskFlow API server listening on port ${env.PORT}`
  );
});

function gracefulShutdown(signal: string) {
  logger.info({ signal }, "Received termination signal. Starting graceful shutdown...");

  server.close((err) => {
    if (err) {
      logger.error({ err }, "Error during HTTP server shutdown");
      process.exit(1);
    }

    logger.info("HTTP server closed successfully.");
    process.exit(0);
  });

  // Force close if graceful shutdown takes longer than 10s
  setTimeout(() => {
    logger.error("Graceful shutdown timeout exceeded. Forcing process exit.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export { server, app };
