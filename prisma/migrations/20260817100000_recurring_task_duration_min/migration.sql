UPDATE "RecurringTask"
SET "durationDays" = 1
WHERE "durationDays" < 1;

ALTER TABLE "RecurringTask"
  ADD CONSTRAINT "RecurringTask_durationDays_min_check" CHECK ("durationDays" >= 1);
