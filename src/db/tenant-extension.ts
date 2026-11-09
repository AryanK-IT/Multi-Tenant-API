import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./client";

/**
 * List of tenant-scoped models that require orgId injection.
 * As additional models (projects, tasks, etc.) land across phases,
 * they are covered here.
 */
export const TENANT_SCOPED_MODELS = [
  "refreshToken",
  "invitation",
  "project",
  "task",
  "apiKey",
  "webhook",
  "webhookDelivery",
  "auditLog",
] as const;

export type TenantScopedModel = (typeof TENANT_SCOPED_MODELS)[number];

/**
 * Creates a tenant-isolated Prisma client extension for a given organization ID.
 * This guarantees at the ORM layer that all queries against tenant-scoped models
 * include the orgId discriminator.
 */
export function createTenantClient(orgId: string, basePrisma: PrismaClient = defaultPrisma) {
  return basePrisma.$extends({
    name: "tenant-isolation-extension",
    client: {
      $tenantOrgId: orgId,
    },
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // If the model is tenant-scoped, enforce orgId filter / mutation constraint
          const modelName = model ? model.charAt(0).toLowerCase() + model.slice(1) : "";

          if (TENANT_SCOPED_MODELS.includes(modelName as TenantScopedModel)) {
            const currentArgs = (args ?? {}) as {
              where?: Record<string, unknown>;
              data?: Record<string, unknown>;
            };

            // Read operations: inject orgId into where clause
            if (
              ["findUnique", "findFirst", "findMany", "count", "aggregate", "groupBy"].includes(
                operation
              )
            ) {
              currentArgs.where = {
                ...currentArgs.where,
                orgId,
              };
            }

            // Create operations: inject orgId into data payload
            if (operation === "create") {
              currentArgs.data = {
                ...currentArgs.data,
                orgId,
              };
            }

            // Update & Delete operations: ensure where clause scopes to orgId
            if (["update", "updateMany", "delete", "deleteMany", "upsert"].includes(operation)) {
              currentArgs.where = {
                ...currentArgs.where,
                orgId,
              };
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return query(currentArgs as any);
          }

          return query(args);
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof createTenantClient>;

/**
 * Helper to obtain a tenant-scoped Prisma client for a given tenant context.
 */
export function getTenantDb(orgId: string): TenantClient {
  return createTenantClient(orgId);
}
