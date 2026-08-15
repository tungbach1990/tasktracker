-- Add task owner for reporting without changing audit creator.
ALTER TABLE "Task" ADD COLUMN "ownerId" TEXT;

UPDATE "Task"
SET "ownerId" = "createdById"
WHERE "ownerId" IS NULL;

CREATE INDEX "Task_ownerId_idx" ON "Task"("ownerId");

ALTER TABLE "Task"
ADD CONSTRAINT "Task_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Store export files outside PostgreSQL. The existing content column remains
-- for backwards-compatible downloads of older export jobs.
ALTER TABLE "ExportJob" ADD COLUMN "filePath" TEXT;
