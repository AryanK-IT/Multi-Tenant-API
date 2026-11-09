-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in_progress', 'done');

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'todo',
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_orgId_name_key" ON "projects"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "projects_id_orgId_key" ON "projects"("id", "orgId");

-- CreateIndex
CREATE INDEX "projects_orgId_createdAt_id_idx" ON "projects"("orgId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "tasks_orgId_projectId_status_id_idx" ON "tasks"("orgId", "projectId", "status", "id");

-- CreateIndex
CREATE INDEX "tasks_orgId_assigneeId_idx" ON "tasks"("orgId", "assigneeId");

-- CreateIndex
CREATE INDEX "tasks_orgId_createdAt_id_idx" ON "tasks"("orgId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (Composite FK: Task(projectId, orgId) -> Project(id, orgId) per SRS §5.1 & §6)
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_orgId_fkey" FOREIGN KEY ("projectId", "orgId") REFERENCES "projects"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enable Row Level Security (RLS) on tenant tables (ADR 1, SRS §5.1)
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;

-- Create RLS Policies using app.current_org
CREATE POLICY "projects_tenant_isolation" ON "projects"
    FOR ALL
    USING ("orgId" = NULLIF(current_setting('app.current_org', true), ''));

CREATE POLICY "tasks_tenant_isolation" ON "tasks"
    FOR ALL
    USING ("orgId" = NULLIF(current_setting('app.current_org', true), ''));
