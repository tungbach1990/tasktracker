CREATE TYPE "TaskKind" AS ENUM ('assigned', 'self_registered');
CREATE TYPE "TaskWorkflowStatus" AS ENUM (
  'active',
  'pending_registration',
  'registration_rejected',
  'pending_completion',
  'final_done',
  'completion_rejected'
);
CREATE TYPE "TaskApprovalType" AS ENUM ('registration', 'completion');
CREATE TYPE "TaskApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'skipped');

ALTER TABLE "Task"
  ADD COLUMN "kind" "TaskKind" NOT NULL DEFAULT 'assigned',
  ADD COLUMN "workflowStatus" "TaskWorkflowStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "performerId" TEXT;

UPDATE "Task" t
SET "performerId" = COALESCE(
  (
    SELECT e."linkedUserId"
    FROM "TaskEmployee" te
    JOIN "Employee" e ON e."id" = te."employeeId"
    WHERE te."taskId" = t."id"
      AND e."linkStatus" = 'confirmed'
      AND e."linkedUserId" IS NOT NULL
    ORDER BY e."createdAt" ASC, e."name" ASC
    LIMIT 1
  ),
  t."createdById"
);

UPDATE "Task" t
SET "workflowStatus" = 'final_done'
WHERE t."completedAt" IS NOT NULL
   OR EXISTS (
    SELECT 1
    FROM "TaskStatusOption" s
    WHERE s."id" = t."statusId"
      AND s."done" = true
  );

ALTER TABLE "Task"
  ALTER COLUMN "performerId" SET NOT NULL;

CREATE INDEX "Task_performerId_idx" ON "Task"("performerId");
CREATE INDEX "Task_workflowStatus_idx" ON "Task"("workflowStatus");

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_performerId_fkey"
  FOREIGN KEY ("performerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TaskApproval" (
  "id" TEXT NOT NULL,
  "type" "TaskApprovalType" NOT NULL,
  "round" INTEGER NOT NULL,
  "level" INTEGER NOT NULL,
  "status" "TaskApprovalStatus" NOT NULL DEFAULT 'pending',
  "note" TEXT NOT NULL DEFAULT '',
  "actedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "taskId" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  CONSTRAINT "TaskApproval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskApproval_taskId_type_round_level_idx" ON "TaskApproval"("taskId", "type", "round", "level");
CREATE INDEX "TaskApproval_reviewerId_status_idx" ON "TaskApproval"("reviewerId", "status");
CREATE INDEX "TaskApproval_taskId_type_status_idx" ON "TaskApproval"("taskId", "type", "status");

ALTER TABLE "TaskApproval"
  ADD CONSTRAINT "TaskApproval_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskApproval"
  ADD CONSTRAINT "TaskApproval_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "key", "label", "description", "createdAt")
VALUES (
  'perm_task_done_approve',
  'task.done.approve',
  'Approve task completion',
  'Approve final done state for tasks in the management chain',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE
SET "label" = EXCLUDED."label",
    "description" = EXCLUDED."description";
