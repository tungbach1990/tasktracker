ALTER TABLE "Task" ADD COLUMN "sourcePath" TEXT;

CREATE UNIQUE INDEX "Task_sourcePath_key" ON "Task"("sourcePath");
