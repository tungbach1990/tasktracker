ALTER TABLE "Task" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Task_deletedAt_idx" ON "Task"("deletedAt");
