import { describe, it, expect, vi } from "vitest";
import { seedDatabase } from "../../src/db/seed";
import { PrismaClient } from "@prisma/client";

describe("Database Seed Generation (SRS §5.2, Phase 9)", () => {
  it("populates multi-tenant seed data across all domain models idempotently", async () => {
    // Mock PrismaClient delegates
    const mockPrisma = {
      org: {
        upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve(create)),
      },
      user: {
        upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve(create)),
      },
      orgMembership: {
        upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve(create)),
      },
      invitation: {
        upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve(create)),
      },
      project: {
        upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve(create)),
      },
      task: {
        upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve(create)),
      },
      apiKey: {
        upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve(create)),
      },
      webhook: {
        upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve(create)),
      },
      webhookDelivery: {
        upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve(create)),
      },
      auditLog: {
        upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve(create)),
      },
    } as unknown as PrismaClient;

    const summary = await seedDatabase(mockPrisma);

    // Verify entity counts created
    expect(summary.orgsCount).toBe(2);
    expect(summary.usersCount).toBe(4);
    expect(summary.membershipsCount).toBe(4);
    expect(summary.projectsCount).toBe(3);
    expect(summary.tasksCount).toBe(4);
    expect(summary.apiKeysCount).toBe(2);
    expect(summary.webhooksCount).toBe(1);
    expect(summary.deliveriesCount).toBe(2);
    expect(summary.auditLogsCount).toBe(3);

    // Verify Acme and Globex organizations were upserted
    expect(mockPrisma.org.upsert).toHaveBeenCalledTimes(2);

    // Verify users (Alice, Bob, Charlie, Dave) were upserted
    expect(mockPrisma.user.upsert).toHaveBeenCalledTimes(4);

    // Verify memberships were upserted
    expect(mockPrisma.orgMembership.upsert).toHaveBeenCalledTimes(4);

    // Verify webhook secret was encrypted with AES-256-GCM format
    const webhookCall = (mockPrisma.webhook.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(webhookCall.create.encryptedSecret).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);

    // Verify API key hashing with SHA-256
    const apiKeyCall = (mockPrisma.apiKey.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(apiKeyCall.create.hashedSecret).toHaveLength(64);
  });
});
