import crypto from "crypto";
import bcrypt from "bcrypt";
import { PrismaClient, Role, TaskStatus, ApiKeyScope, ActorType } from "@prisma/client";
import { encryptSecret } from "../webhooks/crypto";

export interface SeedResult {
  orgsCount: number;
  usersCount: number;
  membershipsCount: number;
  projectsCount: number;
  tasksCount: number;
  apiKeysCount: number;
  webhooksCount: number;
  deliveriesCount: number;
  auditLogsCount: number;
}

export async function seedDatabase(prisma: PrismaClient): Promise<SeedResult> {
  const defaultPassword = "Password123!";
  const passwordHash = await bcrypt.hash(defaultPassword, 10);

  // Fallback encryption key for seeding if not in process.env
  const encryptionKey =
    process.env.WEBHOOK_ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  // 1. Organization A: Acme Technologies
  const acmeOrg = await prisma.org.upsert({
    where: { id: "00000000-0000-4000-8000-000000000001" },
    update: { name: "Acme Technologies" },
    create: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Acme Technologies",
    },
  });

  // 2. Organization B: Globex Innovations (for cross-tenant testing)
  const globexOrg = await prisma.org.upsert({
    where: { id: "00000000-0000-4000-8000-000000000002" },
    update: { name: "Globex Innovations" },
    create: {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Globex Innovations",
    },
  });

  // 3. Users
  const alice = await prisma.user.upsert({
    where: { email: "owner@acme.com" },
    update: { passwordHash },
    create: {
      id: "10000000-0000-4000-8000-000000000001",
      email: "owner@acme.com",
      passwordHash,
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: "admin@acme.com" },
    update: { passwordHash },
    create: {
      id: "10000000-0000-4000-8000-000000000002",
      email: "admin@acme.com",
      passwordHash,
    },
  });

  const charlie = await prisma.user.upsert({
    where: { email: "member@acme.com" },
    update: { passwordHash },
    create: {
      id: "10000000-0000-4000-8000-000000000003",
      email: "member@acme.com",
      passwordHash,
    },
  });

  const dave = await prisma.user.upsert({
    where: { email: "owner@globex.com" },
    update: { passwordHash },
    create: {
      id: "10000000-0000-4000-8000-000000000004",
      email: "owner@globex.com",
      passwordHash,
    },
  });

  // 4. Memberships
  await prisma.orgMembership.upsert({
    where: { userId_orgId: { userId: alice.id, orgId: acmeOrg.id } },
    update: { role: Role.owner },
    create: { userId: alice.id, orgId: acmeOrg.id, role: Role.owner },
  });

  await prisma.orgMembership.upsert({
    where: { userId_orgId: { userId: bob.id, orgId: acmeOrg.id } },
    update: { role: Role.admin },
    create: { userId: bob.id, orgId: acmeOrg.id, role: Role.admin },
  });

  await prisma.orgMembership.upsert({
    where: { userId_orgId: { userId: charlie.id, orgId: acmeOrg.id } },
    update: { role: Role.member },
    create: { userId: charlie.id, orgId: acmeOrg.id, role: Role.member },
  });

  await prisma.orgMembership.upsert({
    where: { userId_orgId: { userId: dave.id, orgId: globexOrg.id } },
    update: { role: Role.owner },
    create: { userId: dave.id, orgId: globexOrg.id, role: Role.owner },
  });

  // 5. Invitations
  const inviteTokenHash = crypto.createHash("sha256").update("seed_invite_token_123").digest("hex");
  await prisma.invitation.upsert({
    where: { id: "20000000-0000-4000-8000-000000000001" },
    update: { email: "contractor@external.com", role: Role.member },
    create: {
      id: "20000000-0000-4000-8000-000000000001",
      orgId: acmeOrg.id,
      email: "contractor@external.com",
      role: Role.member,
      tokenHash: inviteTokenHash,
      invitedById: bob.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // 6. Projects
  const _projectAlpha = await prisma.project.upsert({
    where: { id: "30000000-0000-4000-8000-000000000001" },
    update: { name: "Marketing Web Portal", description: "Public corporate site redesign" },
    create: {
      id: "30000000-0000-4000-8000-000000000001",
      orgId: acmeOrg.id,
      name: "Marketing Web Portal",
      description: "Public corporate site redesign",
      createdById: alice.id,
    },
  });

  const projectBeta = await prisma.project.upsert({
    where: { id: "30000000-0000-4000-8000-000000000002" },
    update: { name: "Core API Platform", description: "Multi-tenant REST API infrastructure" },
    create: {
      id: "30000000-0000-4000-8000-000000000002",
      orgId: acmeOrg.id,
      name: "Core API Platform",
      description: "Multi-tenant REST API infrastructure",
      createdById: bob.id,
    },
  });

  const projectGlobex = await prisma.project.upsert({
    where: { id: "30000000-0000-4000-8000-000000000003" },
    update: { name: "Globex Enterprise Cloud", description: "Globex internal cloud orchestrator" },
    create: {
      id: "30000000-0000-4000-8000-000000000003",
      orgId: globexOrg.id,
      name: "Globex Enterprise Cloud",
      description: "Globex internal cloud orchestrator",
      createdById: dave.id,
    },
  });

  // 7. Tasks
  await prisma.task.upsert({
    where: { id: "40000000-0000-4000-8000-000000000001" },
    update: { status: TaskStatus.done },
    create: {
      id: "40000000-0000-4000-8000-000000000001",
      projectId: projectBeta.id,
      orgId: acmeOrg.id,
      title: "Set up Prisma schema and composite foreign keys",
      description: "Enforce multi-tenant data integrity at schema level",
      status: TaskStatus.done,
      createdById: bob.id,
      assigneeId: charlie.id,
    },
  });

  await prisma.task.upsert({
    where: { id: "40000000-0000-4000-8000-000000000002" },
    update: { status: TaskStatus.in_progress },
    create: {
      id: "40000000-0000-4000-8000-000000000002",
      projectId: projectBeta.id,
      orgId: acmeOrg.id,
      title: "Implement Redis sliding-window rate limiter",
      description: "Provide Per-Org, Per-Credential, and Per-IP tiers",
      status: TaskStatus.in_progress,
      createdById: bob.id,
      assigneeId: charlie.id,
    },
  });

  await prisma.task.upsert({
    where: { id: "40000000-0000-4000-8000-000000000003" },
    update: { status: TaskStatus.todo },
    create: {
      id: "40000000-0000-4000-8000-000000000003",
      projectId: projectBeta.id,
      orgId: acmeOrg.id,
      title: "Configure BullMQ webhook queue worker",
      description: "Deliver event notifications with HMAC signatures and exponential retries",
      status: TaskStatus.todo,
      createdById: alice.id,
      assigneeId: bob.id,
    },
  });

  await prisma.task.upsert({
    where: { id: "40000000-0000-4000-8000-000000000004" },
    update: { status: TaskStatus.in_progress },
    create: {
      id: "40000000-0000-4000-8000-000000000004",
      projectId: projectGlobex.id,
      orgId: globexOrg.id,
      title: "Architecture audit and tenant security verification",
      description: "Verify cross-tenant boundary isolation against Acme Corp",
      status: TaskStatus.in_progress,
      createdById: dave.id,
      assigneeId: dave.id,
    },
  });

  // 8. API Keys
  const hashedCicdKey = crypto
    .createHash("sha256")
    .update("tfk_live_acmedep1_secret1234567890")
    .digest("hex");
  await prisma.apiKey.upsert({
    where: { prefix: "tfk_live_acmedep1" },
    update: { scope: ApiKeyScope.read_write },
    create: {
      id: "50000000-0000-4000-8000-000000000001",
      orgId: acmeOrg.id,
      name: "CI/CD Pipeline Key",
      prefix: "tfk_live_acmedep1",
      hashedSecret: hashedCicdKey,
      scope: ApiKeyScope.read_write,
      createdById: bob.id,
    },
  });

  const hashedMonKey = crypto
    .createHash("sha256")
    .update("tfk_live_acmemo11_secret1234567890")
    .digest("hex");
  await prisma.apiKey.upsert({
    where: { prefix: "tfk_live_acmemo11" },
    update: { scope: ApiKeyScope.read },
    create: {
      id: "50000000-0000-4000-8000-000000000002",
      orgId: acmeOrg.id,
      name: "Prometheus Monitoring Key",
      prefix: "tfk_live_acmemo11",
      hashedSecret: hashedMonKey,
      scope: ApiKeyScope.read,
      createdById: alice.id,
    },
  });

  // 9. Webhooks
  const rawWebhookSecret = "whsec_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const encryptedWebhookSecret = encryptSecret(rawWebhookSecret, encryptionKey);

  const webhook1 = await prisma.webhook.upsert({
    where: { id: "60000000-0000-4000-8000-000000000001" },
    update: {
      url: "https://hooks.slack.com/services/taskflow/seed-alert",
      events: ["task.created", "task.status_changed"],
    },
    create: {
      id: "60000000-0000-4000-8000-000000000001",
      orgId: acmeOrg.id,
      url: "https://hooks.slack.com/services/taskflow/seed-alert",
      encryptedSecret: encryptedWebhookSecret,
      events: ["task.created", "task.status_changed"],
      active: true,
      createdById: alice.id,
    },
  });

  // 10. Webhook Deliveries
  await prisma.webhookDelivery.upsert({
    where: { id: "70000000-0000-4000-8000-000000000001" },
    update: { statusCode: 200, durationMs: 42 },
    create: {
      id: "70000000-0000-4000-8000-000000000001",
      webhookId: webhook1.id,
      orgId: acmeOrg.id,
      eventId: "evt_seed_0000001",
      eventType: "task.created",
      attempt: 1,
      statusCode: 200,
      durationMs: 42,
    },
  });

  await prisma.webhookDelivery.upsert({
    where: { id: "70000000-0000-4000-8000-000000000002" },
    update: { statusCode: 504, error: "Gateway Timeout (10s exceeded)" },
    create: {
      id: "70000000-0000-4000-8000-000000000002",
      webhookId: webhook1.id,
      orgId: acmeOrg.id,
      eventId: "evt_seed_0000002",
      eventType: "task.status_changed",
      attempt: 1,
      statusCode: 504,
      durationMs: 10002,
      error: "Gateway Timeout (10s exceeded)",
    },
  });

  // 11. Audit Logs
  await prisma.auditLog.upsert({
    where: { id: "80000000-0000-4000-8000-000000000001" },
    update: {},
    create: {
      id: "80000000-0000-4000-8000-000000000001",
      orgId: acmeOrg.id,
      actorType: ActorType.user,
      actorId: alice.id,
      action: "user.signed_up",
      targetType: "user",
      targetId: alice.id,
      metadata: { email: alice.email, orgName: acmeOrg.name },
      ip: "127.0.0.1",
    },
  });

  await prisma.auditLog.upsert({
    where: { id: "80000000-0000-4000-8000-000000000002" },
    update: {},
    create: {
      id: "80000000-0000-4000-8000-000000000002",
      orgId: acmeOrg.id,
      actorType: ActorType.user,
      actorId: bob.id,
      action: "project.created",
      targetType: "project",
      targetId: projectBeta.id,
      metadata: { name: projectBeta.name },
      ip: "127.0.0.1",
    },
  });

  await prisma.auditLog.upsert({
    where: { id: "80000000-0000-4000-8000-000000000003" },
    update: {},
    create: {
      id: "80000000-0000-4000-8000-000000000003",
      orgId: acmeOrg.id,
      actorType: ActorType.user,
      actorId: alice.id,
      action: "webhook.created",
      targetType: "webhook",
      targetId: webhook1.id,
      metadata: { url: webhook1.url, events: webhook1.events },
      ip: "127.0.0.1",
    },
  });

  return {
    orgsCount: 2,
    usersCount: 4,
    membershipsCount: 4,
    projectsCount: 3,
    tasksCount: 4,
    apiKeysCount: 2,
    webhooksCount: 1,
    deliveriesCount: 2,
    auditLogsCount: 3,
  };
}
