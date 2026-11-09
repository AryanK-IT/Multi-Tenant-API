-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'api_key', 'system');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_orgId_createdAt_id_idx" ON "audit_logs"("orgId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "audit_logs_orgId_action_createdAt_idx" ON "audit_logs"("orgId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_orgId_actorId_idx" ON "audit_logs"("orgId", "actorId");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable Row Level Security (RLS) on tenant tables (ADR 1, SRS §5.1)
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;

-- Create RLS Policy using app.current_org
CREATE POLICY "audit_logs_tenant_isolation" ON "audit_logs"
    FOR ALL
    USING ("orgId" = NULLIF(current_setting('app.current_org', true), ''));
