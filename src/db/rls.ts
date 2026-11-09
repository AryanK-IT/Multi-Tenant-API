import { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./client";

/**
 * Executes a callback within a PostgreSQL transaction where `app.current_org`
 * is set to the provided organization ID. This activates Row-Level Security (RLS)
 * policies on tenant tables as a defense-in-depth safety net.
 */
export async function withTenantContext<T>(
  orgId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  basePrisma: PrismaClient = defaultPrisma
): Promise<T> {
  // Sanitize orgId to prevent SQL injection in session setting
  const sanitizedOrgId = orgId.replace(/'/g, "''");

  return basePrisma.$transaction(async (tx) => {
    // Set the session variable for RLS policies
    await tx.$executeRawUnsafe(`SET LOCAL app.current_org = '${sanitizedOrgId}';`);
    return fn(tx);
  });
}
