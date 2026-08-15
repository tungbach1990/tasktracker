-- Rename assignee data to employee data and add confirmed team relations.

CREATE TYPE "EmployeeLinkStatus" AS ENUM ('none', 'pending', 'confirmed', 'rejected');
CREATE TYPE "TeamRelationStatus" AS ENUM ('pending', 'confirmed', 'rejected', 'admin_confirmed');

ALTER TABLE "Assignee" RENAME TO "Employee";
ALTER TABLE "TaskAssignee" RENAME TO "TaskEmployee";
ALTER TABLE "TaskEmployee" RENAME COLUMN "assigneeId" TO "employeeId";

ALTER TABLE "Employee" RENAME CONSTRAINT "Assignee_pkey" TO "Employee_pkey";
ALTER TABLE "Employee" RENAME CONSTRAINT "Assignee_ownerId_fkey" TO "Employee_ownerId_fkey";
ALTER INDEX "Assignee_ownerId_key_key" RENAME TO "Employee_ownerId_key_key";
ALTER INDEX "Assignee_ownerId_active_idx" RENAME TO "Employee_ownerId_active_idx";

ALTER TABLE "TaskEmployee" RENAME CONSTRAINT "TaskAssignee_pkey" TO "TaskEmployee_pkey";
ALTER TABLE "TaskEmployee" RENAME CONSTRAINT "TaskAssignee_taskId_fkey" TO "TaskEmployee_taskId_fkey";
ALTER TABLE "TaskEmployee" RENAME CONSTRAINT "TaskAssignee_assigneeId_fkey" TO "TaskEmployee_employeeId_fkey";

ALTER TABLE "Employee"
  ADD COLUMN "linkStatus" "EmployeeLinkStatus" NOT NULL DEFAULT 'none',
  ADD COLUMN "linkRequestedAt" TIMESTAMP(3),
  ADD COLUMN "linkRespondedAt" TIMESTAMP(3),
  ADD COLUMN "linkedUserId" TEXT;

CREATE INDEX "Employee_linkedUserId_linkStatus_idx" ON "Employee"("linkedUserId", "linkStatus");

ALTER TABLE "Employee"
  ADD CONSTRAINT "Employee_linkedUserId_fkey"
  FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TeamRelation" (
  "id" TEXT NOT NULL,
  "status" "TeamRelationStatus" NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "managerId" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "sourceEmployeeId" TEXT,
  CONSTRAINT "TeamRelation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamRelation_managerId_reportId_key" ON "TeamRelation"("managerId", "reportId");
CREATE INDEX "TeamRelation_managerId_status_idx" ON "TeamRelation"("managerId", "status");
CREATE INDEX "TeamRelation_reportId_status_idx" ON "TeamRelation"("reportId", "status");
CREATE INDEX "TeamRelation_sourceEmployeeId_idx" ON "TeamRelation"("sourceEmployeeId");

ALTER TABLE "TeamRelation"
  ADD CONSTRAINT "TeamRelation_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamRelation"
  ADD CONSTRAINT "TeamRelation_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamRelation"
  ADD CONSTRAINT "TeamRelation_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamRelation"
  ADD CONSTRAINT "TeamRelation_sourceEmployeeId_fkey"
  FOREIGN KEY ("sourceEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "key", "label", "description", "createdAt")
VALUES
  ('perm_team_manage_own', 'team.manage.own', 'Manage own team', 'Request employee-user mappings for own employee records', CURRENT_TIMESTAMP),
  ('perm_team_view_downline', 'team.view.downline', 'View downline tasks', 'View tasks created by confirmed direct and indirect reports', CURRENT_TIMESTAMP),
  ('perm_team_manage_all', 'team.manage.all', 'Manage all teams', 'Create, confirm, reject, and delete any reporting relation', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE
SET "label" = EXCLUDED."label",
    "description" = EXCLUDED."description";

INSERT INTO "DashboardSectionPreference" ("id", "sectionKey", "label", "enabled", "sortOrder", "config", "updatedAt", "ownerId")
SELECT 'dash_' || u."id" || '_team_summary', 'team_summary', 'Team summary', true, 85, '{}'::jsonb, CURRENT_TIMESTAMP, u."id"
FROM "User" u
ON CONFLICT DO NOTHING;
