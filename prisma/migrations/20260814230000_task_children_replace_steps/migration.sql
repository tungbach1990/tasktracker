-- Replace checklist steps with full child tasks.
ALTER TABLE "Task" ADD COLUMN "result" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Task" ADD COLUMN "feedback" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Task" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 100;

WITH migrated_steps AS (
  SELECT
    s."id" AS "stepId",
    s."title",
    s."description",
    s."done",
    s."dueDate",
    s."sortOrder",
    s."completedAt",
    s."createdAt",
    s."updatedAt",
    t."id" AS "parentId",
    t."kind",
    t."priority",
    t."projectId",
    t."createdById",
    t."performerId",
    COALESCE(
      (
        SELECT so."id"
        FROM "TaskStatusOption" so
        WHERE so."ownerId" = t."createdById"
          AND so."active" = true
          AND so."done" = s."done"
        ORDER BY so."sortOrder" ASC, so."label" ASC
        LIMIT 1
      ),
      t."statusId"
    ) AS "statusId"
  FROM "TaskStep" s
  JOIN "Task" t ON t."id" = s."taskId"
)
INSERT INTO "Task" (
  "id",
  "sourcePath",
  "title",
  "description",
  "result",
  "feedback",
  "taskType",
  "kind",
  "workflowStatus",
  "priority",
  "startDate",
  "dueDate",
  "dueHistory",
  "sortOrder",
  "repeats",
  "repeatEvery",
  "repeatUnit",
  "seriesId",
  "occurrence",
  "completedAt",
  "createdAt",
  "updatedAt",
  "projectId",
  "statusId",
  "parentId",
  "performerId",
  "createdById",
  "updatedById"
)
SELECT
  'step_task_' || "stepId",
  NULL,
  "title",
  "description",
  '',
  '',
  'small'::"TaskType",
  "kind",
  CASE WHEN "done" THEN 'final_done'::"TaskWorkflowStatus" ELSE 'active'::"TaskWorkflowStatus" END,
  "priority",
  NULL,
  "dueDate",
  NULL,
  "sortOrder",
  false,
  1,
  'day'::"RepeatUnit",
  NULL,
  NULL,
  CASE WHEN "done" THEN COALESCE("completedAt", "updatedAt") ELSE NULL END,
  "createdAt",
  "updatedAt",
  "projectId",
  "statusId",
  "parentId",
  "performerId",
  "createdById",
  "createdById"
FROM migrated_steps;

INSERT INTO "TaskEmployee" ("taskId", "employeeId")
SELECT 'step_task_' || s."id", te."employeeId"
FROM "TaskStep" s
JOIN "TaskEmployee" te ON te."taskId" = s."taskId"
ON CONFLICT DO NOTHING;

UPDATE "Task" SET "taskType" = 'small'::"TaskType" WHERE "parentId" IS NOT NULL;
UPDATE "Task" SET "taskType" = 'big'::"TaskType" WHERE "parentId" IS NULL;

CREATE INDEX "Task_parentId_sortOrder_idx" ON "Task"("parentId", "sortOrder");

DROP TABLE "TaskStep";
