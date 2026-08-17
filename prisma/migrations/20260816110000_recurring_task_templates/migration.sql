-- AlterTable
ALTER TABLE "Task"
  ADD COLUMN "recurringTaskId" TEXT,
  ADD COLUMN "recurrenceOccurrence" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RecurringTask" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "priority" "TaskPriority" NOT NULL DEFAULT 'normal',
  "repeatEvery" INTEGER NOT NULL DEFAULT 1,
  "repeatUnit" "RepeatUnit" NOT NULL DEFAULT 'day',
  "repeatPattern" "RepeatPattern" NOT NULL DEFAULT 'daily',
  "repeatWeekdays" JSONB,
  "firstOccurrence" TIMESTAMP(3) NOT NULL,
  "repeatEndsAt" TIMESTAMP(3),
  "repeatNoticeDays" INTEGER NOT NULL DEFAULT 7,
  "durationDays" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "projectId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "performerId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT,
  "onBehalfOfId" TEXT,

  CONSTRAINT "RecurringTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringTaskEmployee" (
  "recurringTaskId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,

  CONSTRAINT "RecurringTaskEmployee_pkey" PRIMARY KEY ("recurringTaskId","employeeId")
);

-- Backfill templates from legacy repeating tasks.
INSERT INTO "RecurringTask" (
  "id",
  "title",
  "description",
  "priority",
  "repeatEvery",
  "repeatUnit",
  "repeatPattern",
  "repeatWeekdays",
  "firstOccurrence",
  "repeatEndsAt",
  "repeatNoticeDays",
  "durationDays",
  "active",
  "archivedAt",
  "createdAt",
  "updatedAt",
  "projectId",
  "ownerId",
  "performerId",
  "createdById",
  "updatedById"
)
SELECT DISTINCT ON (COALESCE("seriesId", "id"))
  COALESCE("seriesId", "id"),
  "title",
  "description",
  "priority",
  "repeatEvery",
  "repeatUnit",
  "repeatPattern",
  "repeatWeekdays",
  COALESCE("occurrence", "startDate", "dueDate", "createdAt"),
  "repeatEndsAt",
  "repeatNoticeDays",
  COALESCE(
    GREATEST(0, ("dueDate"::date - COALESCE("occurrence", "startDate", "dueDate", "createdAt")::date)),
    1
  ),
  "deletedAt" IS NULL,
  "deletedAt",
  "createdAt",
  "updatedAt",
  "projectId",
  COALESCE("ownerId", "createdById"),
  "performerId",
  "createdById",
  "updatedById"
FROM "Task"
WHERE "repeats" = true
ORDER BY COALESCE("seriesId", "id"), "occurrence" ASC NULLS LAST, "createdAt" ASC;

INSERT INTO "RecurringTaskEmployee" ("recurringTaskId", "employeeId")
SELECT DISTINCT COALESCE(t."seriesId", t."id"), te."employeeId"
FROM "Task" t
JOIN "TaskEmployee" te ON te."taskId" = t."id"
WHERE t."repeats" = true
ON CONFLICT DO NOTHING;

-- Legacy occurrences that already behaved like real work items stay as normal tasks.
UPDATE "Task" t
SET
  "recurringTaskId" = COALESCE(t."seriesId", t."id"),
  "recurrenceOccurrence" = COALESCE(t."occurrence", t."startDate", t."dueDate", t."createdAt"),
  "repeats" = false,
  "repeatEvery" = 1,
  "repeatUnit" = 'day',
  "repeatPattern" = 'daily',
  "repeatWeekdays" = NULL,
  "repeatEndsAt" = NULL,
  "repeatNoticeDays" = 7,
  "seriesId" = NULL,
  "occurrence" = NULL
WHERE t."repeats" = true
  AND (
    EXISTS (
      SELECT 1 FROM "TaskHistory" h
      WHERE h."taskId" = t."id" AND h."action" = 'recurrence_created'
    )
    OR t."completedAt" IS NOT NULL
    OR t."result" <> ''
    OR t."feedback" <> ''
    OR EXISTS (SELECT 1 FROM "TaskComment" c WHERE c."taskId" = t."id")
    OR EXISTS (SELECT 1 FROM "TaskApproval" a WHERE a."taskId" = t."id")
  );

-- Legacy repeating tasks without work data now live only as RecurringTask templates.
UPDATE "Task" t
SET
  "repeats" = false,
  "repeatEvery" = 1,
  "repeatUnit" = 'day',
  "repeatPattern" = 'daily',
  "repeatWeekdays" = NULL,
  "repeatEndsAt" = NULL,
  "repeatNoticeDays" = 7,
  "seriesId" = NULL,
  "occurrence" = NULL,
  "deletedAt" = COALESCE(t."deletedAt", CURRENT_TIMESTAMP)
WHERE t."repeats" = true;

-- CreateIndex
CREATE INDEX "Task_recurringTaskId_idx" ON "Task"("recurringTaskId");
CREATE UNIQUE INDEX "Task_recurringTaskId_recurrenceOccurrence_key" ON "Task"("recurringTaskId", "recurrenceOccurrence");
CREATE INDEX "RecurringTask_projectId_active_idx" ON "RecurringTask"("projectId", "active");
CREATE INDEX "RecurringTask_ownerId_active_idx" ON "RecurringTask"("ownerId", "active");
CREATE INDEX "RecurringTask_performerId_idx" ON "RecurringTask"("performerId");
CREATE INDEX "RecurringTask_createdById_idx" ON "RecurringTask"("createdById");
CREATE INDEX "RecurringTask_onBehalfOfId_idx" ON "RecurringTask"("onBehalfOfId");
CREATE INDEX "RecurringTaskEmployee_employeeId_idx" ON "RecurringTaskEmployee"("employeeId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_recurringTaskId_fkey" FOREIGN KEY ("recurringTaskId") REFERENCES "RecurringTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecurringTask" ADD CONSTRAINT "RecurringTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringTask" ADD CONSTRAINT "RecurringTask_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringTask" ADD CONSTRAINT "RecurringTask_performerId_fkey" FOREIGN KEY ("performerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringTask" ADD CONSTRAINT "RecurringTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringTask" ADD CONSTRAINT "RecurringTask_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecurringTask" ADD CONSTRAINT "RecurringTask_onBehalfOfId_fkey" FOREIGN KEY ("onBehalfOfId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecurringTaskEmployee" ADD CONSTRAINT "RecurringTaskEmployee_recurringTaskId_fkey" FOREIGN KEY ("recurringTaskId") REFERENCES "RecurringTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringTaskEmployee" ADD CONSTRAINT "RecurringTaskEmployee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
