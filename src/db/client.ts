import { PrismaClient } from "@prisma/client";
import { logger } from "../common/logger";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: "event", level: "error" },
      { emit: "event", level: "warn" },
    ],
  });

// Bind prisma logging events to pino logger
// @ts-expect-error Prisma event typing
prisma.$on("error", (e: unknown) => {
  logger.error({ err: e }, "Prisma Database Error");
});

// @ts-expect-error Prisma event typing
prisma.$on("warn", (e: unknown) => {
  logger.warn({ warning: e }, "Prisma Database Warning");
});

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
