-- Add checklist-like child steps inside a task.

CREATE TABLE "TaskStep" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "done" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "taskId" TEXT NOT NULL,

    CONSTRAINT "TaskStep_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskStep_taskId_done_sortOrder_idx" ON "TaskStep"("taskId", "done", "sortOrder");
CREATE INDEX "TaskStep_dueDate_idx" ON "TaskStep"("dueDate");

ALTER TABLE "TaskStep"
  ADD CONSTRAINT "TaskStep_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
