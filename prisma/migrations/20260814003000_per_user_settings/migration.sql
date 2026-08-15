-- Add per-user settings tables and migrate existing tasks without deleting data.

CREATE TABLE "TaskStatusOption" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "sortOrder" INTEGER NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "TaskStatusOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Assignee" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "Assignee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DashboardSectionPreference" (
    "id" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "DashboardSectionPreference_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Project" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Project" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Task" ADD COLUMN "statusId" TEXT;
ALTER TABLE "TaskAssignee" ADD COLUMN "assigneeId" TEXT;

UPDATE "Project" p
SET "ownerId" = COALESCE(
  (
    SELECT t."createdById"
    FROM "Task" t
    WHERE t."projectId" = p."id"
    ORDER BY t."createdAt" ASC
    LIMIT 1
  ),
  (
    SELECT u."id"
    FROM "User" u
    JOIN "UserRole" ur ON ur."userId" = u."id"
    JOIN "Role" r ON r."id" = ur."roleId"
    WHERE r."name" = 'Admin'
    ORDER BY u."createdAt" ASC
    LIMIT 1
  ),
  (
    SELECT u."id"
    FROM "User" u
    ORDER BY u."createdAt" ASC
    LIMIT 1
  )
);

INSERT INTO "TaskStatusOption" ("id", "key", "label", "color", "sortOrder", "done", "active", "updatedAt", "ownerId")
SELECT 'status_' || u."id" || '_phai_lam', 'phai-lam', 'Phải làm', 'slate', 10, false, true, CURRENT_TIMESTAMP, u."id"
FROM "User" u
ON CONFLICT DO NOTHING;

INSERT INTO "TaskStatusOption" ("id", "key", "label", "color", "sortOrder", "done", "active", "updatedAt", "ownerId")
SELECT 'status_' || u."id" || '_cho_lam_sau', 'cho-lam-sau', 'Chờ làm sau', 'sky', 20, false, true, CURRENT_TIMESTAMP, u."id"
FROM "User" u
ON CONFLICT DO NOTHING;

INSERT INTO "TaskStatusOption" ("id", "key", "label", "color", "sortOrder", "done", "active", "updatedAt", "ownerId")
SELECT 'status_' || u."id" || '_dang_lam', 'dang-lam', 'Đang làm', 'blue', 30, false, true, CURRENT_TIMESTAMP, u."id"
FROM "User" u
ON CONFLICT DO NOTHING;

INSERT INTO "TaskStatusOption" ("id", "key", "label", "color", "sortOrder", "done", "active", "updatedAt", "ownerId")
SELECT 'status_' || u."id" || '_vuong_mac', 'vuong-mac', 'Vướng mắc', 'amber', 40, false, true, CURRENT_TIMESTAMP, u."id"
FROM "User" u
ON CONFLICT DO NOTHING;

INSERT INTO "TaskStatusOption" ("id", "key", "label", "color", "sortOrder", "done", "active", "updatedAt", "ownerId")
SELECT 'status_' || u."id" || '_lam_xong', 'lam-xong', 'Làm xong', 'emerald', 50, true, true, CURRENT_TIMESTAMP, u."id"
FROM "User" u
ON CONFLICT DO NOTHING;

INSERT INTO "DashboardSectionPreference" ("id", "sectionKey", "label", "enabled", "sortOrder", "config", "updatedAt", "ownerId")
SELECT 'dash_' || u."id" || '_metrics', 'metrics', 'Metrics', true, 10, '{}'::jsonb, CURRENT_TIMESTAMP, u."id"
FROM "User" u
ON CONFLICT DO NOTHING;

INSERT INTO "DashboardSectionPreference" ("id", "sectionKey", "label", "enabled", "sortOrder", "config", "updatedAt", "ownerId")
SELECT 'dash_' || u."id" || '_overdue', 'overdue', 'Quá hạn', true, 20, '{}'::jsonb, CURRENT_TIMESTAMP, u."id"
FROM "User" u
ON CONFLICT DO NOTHING;

INSERT INTO "DashboardSectionPreference" ("id", "sectionKey", "label", "enabled", "sortOrder", "config", "updatedAt", "ownerId")
SELECT 'dash_' || u."id" || '_today', 'today', 'Hôm nay', true, 30, '{}'::jsonb, CURRENT_TIMESTAMP, u."id"
FROM "User" u
ON CONFLICT DO NOTHING;

INSERT INTO "DashboardSectionPreference" ("id", "sectionKey", "label", "enabled", "sortOrder", "config", "updatedAt", "ownerId")
SELECT 'dash_' || u."id" || '_upcoming', 'upcoming', 'Sắp tới', true, 40, '{"days":7,"limit":8}'::jsonb, CURRENT_TIMESTAMP, u."id"
FROM "User" u
ON CONFLICT DO NOTHING;

INSERT INTO "DashboardSectionPreference" ("id", "sectionKey", "label", "enabled", "sortOrder", "config", "updatedAt", "ownerId")
SELECT 'dash_' || u."id" || '_status_summary', 'status_summary', 'Theo trạng thái', true, 50, '{}'::jsonb, CURRENT_TIMESTAMP, u."id"
FROM "User" u
ON CONFLICT DO NOTHING;

INSERT INTO "DashboardSectionPreference" ("id", "sectionKey", "label", "enabled", "sortOrder", "config", "updatedAt", "ownerId")
SELECT 'dash_' || u."id" || '_recent_open', 'recent_open', 'Recent open tasks', true, 60, '{"limit":8}'::jsonb, CURRENT_TIMESTAMP, u."id"
FROM "User" u
ON CONFLICT DO NOTHING;

UPDATE "Task" t
SET "statusId" = s."id"
FROM "TaskStatusOption" s
WHERE s."ownerId" = t."createdById"
  AND s."key" = replace(t."status"::text, '_', '-');

INSERT INTO "Assignee" ("id", "key", "name", "active", "updatedAt", "ownerId")
SELECT
  'assignee_' || owner_task."createdById" || '_' || old_user."id",
  lower(regexp_replace(old_user."username", '[^a-zA-Z0-9]+', '-', 'g')),
  old_user."displayName",
  true,
  CURRENT_TIMESTAMP,
  owner_task."createdById"
FROM "TaskAssignee" ta
JOIN "Task" owner_task ON owner_task."id" = ta."taskId"
JOIN "User" old_user ON old_user."id" = ta."userId"
ON CONFLICT DO NOTHING;

UPDATE "TaskAssignee" ta
SET "assigneeId" = a."id"
FROM "Task" t, "User" old_user, "Assignee" a
WHERE t."id" = ta."taskId"
  AND old_user."id" = ta."userId"
  AND a."ownerId" = t."createdById"
  AND a."key" = lower(regexp_replace(old_user."username", '[^a-zA-Z0-9]+', '-', 'g'));

ALTER TABLE "Project" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Task" ALTER COLUMN "statusId" SET NOT NULL;
ALTER TABLE "TaskAssignee" ALTER COLUMN "assigneeId" SET NOT NULL;

DROP INDEX "Project_key_key";
DROP INDEX "Task_projectId_status_idx";
ALTER TABLE "Task" DROP COLUMN "status";
ALTER TABLE "TaskAssignee" DROP CONSTRAINT "TaskAssignee_pkey";
ALTER TABLE "TaskAssignee" DROP COLUMN "userId";

DROP TYPE "TaskStatus";

CREATE UNIQUE INDEX "Project_ownerId_key_key" ON "Project"("ownerId", "key");
CREATE INDEX "Project_ownerId_active_idx" ON "Project"("ownerId", "active");
CREATE UNIQUE INDEX "TaskStatusOption_ownerId_key_key" ON "TaskStatusOption"("ownerId", "key");
CREATE INDEX "TaskStatusOption_ownerId_active_sortOrder_idx" ON "TaskStatusOption"("ownerId", "active", "sortOrder");
CREATE UNIQUE INDEX "Assignee_ownerId_key_key" ON "Assignee"("ownerId", "key");
CREATE INDEX "Assignee_ownerId_active_idx" ON "Assignee"("ownerId", "active");
CREATE UNIQUE INDEX "DashboardSectionPreference_ownerId_sectionKey_key" ON "DashboardSectionPreference"("ownerId", "sectionKey");
CREATE INDEX "DashboardSectionPreference_ownerId_enabled_sortOrder_idx" ON "DashboardSectionPreference"("ownerId", "enabled", "sortOrder");
CREATE INDEX "Task_projectId_statusId_idx" ON "Task"("projectId", "statusId");
CREATE INDEX "Task_createdById_idx" ON "Task"("createdById");
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("taskId", "assigneeId");

ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskStatusOption" ADD CONSTRAINT "TaskStatusOption_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assignee" ADD CONSTRAINT "Assignee_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DashboardSectionPreference" ADD CONSTRAINT "DashboardSectionPreference_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "TaskStatusOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Assignee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
