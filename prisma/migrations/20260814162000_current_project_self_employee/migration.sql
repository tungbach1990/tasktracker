-- Add one admin-managed current project per user and a confirmed self employee.

ALTER TABLE "User" ADD COLUMN "currentProjectId" TEXT;

INSERT INTO "Project" ("id", "key", "name", "description", "active", "createdAt", "updatedAt", "ownerId")
SELECT
  'project_current_' || u."id",
  'default',
  'Internal Work',
  'Default internal task workspace',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  u."id"
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1
  FROM "Project" p
  WHERE p."ownerId" = u."id"
)
ON CONFLICT DO NOTHING;

UPDATE "Project" p
SET "active" = true,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE p."id" IN (
  SELECT DISTINCT ON (p2."ownerId") p2."id"
  FROM "Project" p2
  WHERE NOT EXISTS (
    SELECT 1
    FROM "Project" active_project
    WHERE active_project."ownerId" = p2."ownerId"
      AND active_project."active" = true
  )
  ORDER BY p2."ownerId", p2."createdAt" ASC, p2."name" ASC
);

UPDATE "User" u
SET "currentProjectId" = (
  SELECT p."id"
  FROM "Project" p
  WHERE p."ownerId" = u."id"
    AND p."active" = true
  ORDER BY p."createdAt" ASC, p."name" ASC
  LIMIT 1
)
WHERE u."currentProjectId" IS NULL;

INSERT INTO "Employee" (
  "id",
  "key",
  "name",
  "active",
  "linkStatus",
  "linkRequestedAt",
  "linkRespondedAt",
  "createdAt",
  "updatedAt",
  "ownerId",
  "linkedUserId"
)
SELECT
  'employee_self_' || u."id",
  'self',
  u."displayName",
  true,
  'confirmed',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  u."id",
  u."id"
FROM "User" u
ON CONFLICT ("ownerId", "key") DO UPDATE
SET "name" = EXCLUDED."name",
    "active" = true,
    "linkStatus" = 'confirmed',
    "linkRespondedAt" = CURRENT_TIMESTAMP,
    "linkedUserId" = EXCLUDED."linkedUserId",
    "updatedAt" = CURRENT_TIMESTAMP;

CREATE INDEX "User_currentProjectId_idx" ON "User"("currentProjectId");

ALTER TABLE "User"
  ADD CONSTRAINT "User_currentProjectId_fkey"
  FOREIGN KEY ("currentProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
