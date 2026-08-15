INSERT INTO "Project" ("id", "key", "name", "description", "active", "createdAt", "updatedAt")
SELECT
  'default-project-internal-work',
  'internal-work',
  'Công việc nội bộ',
  'Không gian nhiệm vụ nội bộ mặc định',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Project");

ALTER TABLE "TeamDelegation" ADD COLUMN "projectId" TEXT;

UPDATE "TeamDelegation" AS delegation
SET "projectId" = COALESCE(
  manager."currentProjectId",
  (
    SELECT project."id"
    FROM "Project" AS project
    WHERE project."active" = true
    ORDER BY project."createdAt" ASC, project."name" ASC, project."id" ASC
    LIMIT 1
  ),
  (
    SELECT project."id"
    FROM "Project" AS project
    ORDER BY project."createdAt" ASC, project."name" ASC, project."id" ASC
    LIMIT 1
  )
)
FROM "User" AS manager
WHERE delegation."managerId" = manager."id";

DELETE FROM "TeamDelegation"
WHERE "projectId" IS NULL;

DROP INDEX IF EXISTS "TeamDelegation_managerId_assistantId_key";

ALTER TABLE "TeamDelegation" ALTER COLUMN "projectId" SET NOT NULL;

CREATE UNIQUE INDEX "TeamDelegation_managerId_assistantId_projectId_key"
  ON "TeamDelegation"("managerId", "assistantId", "projectId");

CREATE INDEX "TeamDelegation_projectId_active_idx"
  ON "TeamDelegation"("projectId", "active");

ALTER TABLE "TeamDelegation"
  ADD CONSTRAINT "TeamDelegation_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
