-- Add work-task-helper style parent/child task support and due extension history.

CREATE TYPE "TaskType" AS ENUM ('big', 'small');

ALTER TABLE "Task"
  ADD COLUMN "taskType" "TaskType" NOT NULL DEFAULT 'big',
  ADD COLUMN "parentId" TEXT,
  ADD COLUMN "dueHistory" JSONB;

CREATE INDEX "Task_parentId_idx" ON "Task"("parentId");
CREATE INDEX "Task_createdById_taskType_idx" ON "Task"("createdById", "taskType");

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Task"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
