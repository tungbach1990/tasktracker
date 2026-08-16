CREATE TYPE "RepeatPattern" AS ENUM ('daily', 'weekdays', 'weekly', 'monthly', 'quarterly', 'yearly');

ALTER TABLE "Task"
  ADD COLUMN "repeatPattern" "RepeatPattern" NOT NULL DEFAULT 'daily',
  ADD COLUMN "repeatWeekdays" JSONB,
  ADD COLUMN "repeatEndsAt" TIMESTAMP(3),
  ADD COLUMN "repeatNoticeDays" INTEGER NOT NULL DEFAULT 7;

UPDATE "Task"
SET "repeatPattern" = CASE "repeatUnit"
  WHEN 'week' THEN 'weekly'::"RepeatPattern"
  WHEN 'month' THEN 'monthly'::"RepeatPattern"
  ELSE 'daily'::"RepeatPattern"
END
WHERE "repeats" = true;

UPDATE "Task"
SET "seriesId" = "id"
WHERE "repeats" = true AND "seriesId" IS NULL;
