-- Add recurring task metadata from work-task-helper.

CREATE TYPE "RepeatUnit" AS ENUM ('day', 'week', 'month');

ALTER TABLE "Task"
  ADD COLUMN "repeats" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "repeatEvery" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "repeatUnit" "RepeatUnit" NOT NULL DEFAULT 'day',
  ADD COLUMN "seriesId" TEXT,
  ADD COLUMN "occurrence" TIMESTAMP(3);

UPDATE "Task"
SET "occurrence" = COALESCE("startDate", "dueDate", "createdAt")
WHERE "repeats" = true AND "occurrence" IS NULL;

CREATE INDEX "Task_seriesId_occurrence_idx" ON "Task"("seriesId", "occurrence");
