DROP INDEX IF EXISTS "Project_key_key";
DROP INDEX IF EXISTS "Project_ownerId_key_key";
DROP INDEX IF EXISTS "Project_ownerId_active_idx";

CREATE TEMP TABLE "_ProjectGlobalMap" AS
WITH normalized AS (
  SELECT
    p."id" AS "oldProjectId",
    COALESCE(
      NULLIF(lower(trim(p."key")), ''),
      NULLIF(btrim(regexp_replace(lower(trim(p."name")), '[^a-z0-9]+', '-', 'g'), '-'), ''),
      'project'
    ) AS "globalKey",
    p."active",
    p."createdAt",
    p."name"
  FROM "Project" p
),
ranked AS (
  SELECT
    n.*,
    first_value(n."oldProjectId") OVER (
      PARTITION BY n."globalKey"
      ORDER BY n."active" DESC, n."createdAt" ASC, n."name" ASC, n."oldProjectId" ASC
    ) AS "canonicalProjectId"
  FROM normalized n
)
SELECT "oldProjectId", "canonicalProjectId", "globalKey"
FROM ranked;

UPDATE "Project" p
SET
  "key" = canonical."globalKey",
  "active" = canonical."active"
FROM (
  SELECT
    m."canonicalProjectId",
    m."globalKey",
    bool_or(existing."active") AS "active"
  FROM "_ProjectGlobalMap" m
  JOIN "Project" existing ON existing."id" = m."oldProjectId"
  GROUP BY m."canonicalProjectId", m."globalKey"
) canonical
WHERE p."id" = canonical."canonicalProjectId";

UPDATE "Task" t
SET "projectId" = m."canonicalProjectId"
FROM "_ProjectGlobalMap" m
WHERE t."projectId" = m."oldProjectId"
  AND t."projectId" <> m."canonicalProjectId";

UPDATE "User" u
SET "currentProjectId" = m."canonicalProjectId"
FROM "_ProjectGlobalMap" m
WHERE u."currentProjectId" = m."oldProjectId"
  AND u."currentProjectId" <> m."canonicalProjectId";

DELETE FROM "UserProject";

DELETE FROM "Project" p
USING "_ProjectGlobalMap" m
WHERE p."id" = m."oldProjectId"
  AND m."oldProjectId" <> m."canonicalProjectId";

ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_ownerId_fkey";
ALTER TABLE "Project" DROP COLUMN IF EXISTS "ownerId";

INSERT INTO "Project" ("id", "key", "name", "description", "active", "createdAt", "updatedAt")
SELECT
  'project_internal_work',
  'internal-work',
  'Internal Work',
  'Default internal task workspace',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Project");

WITH first_project AS (
  SELECT "id"
  FROM "Project"
  ORDER BY "createdAt" ASC, "name" ASC, "id" ASC
  LIMIT 1
)
UPDATE "Project" p
SET "active" = true
WHERE p."id" = (SELECT "id" FROM first_project)
  AND NOT EXISTS (SELECT 1 FROM "Project" WHERE "active" = true);

WITH first_active AS (
  SELECT "id"
  FROM "Project"
  WHERE "active" = true
  ORDER BY "createdAt" ASC, "name" ASC, "id" ASC
  LIMIT 1
)
UPDATE "User" u
SET "currentProjectId" = (SELECT "id" FROM first_active)
WHERE NOT EXISTS (
  SELECT 1
  FROM "Project" p
  WHERE p."id" = u."currentProjectId"
    AND p."active" = true
);

INSERT INTO "UserProject" ("userId", "projectId")
SELECT u."id", u."currentProjectId"
FROM "User" u
WHERE u."currentProjectId" IS NOT NULL
ON CONFLICT ("userId", "projectId") DO NOTHING;

CREATE UNIQUE INDEX "Project_key_key" ON "Project"("key");
CREATE INDEX "Project_active_name_idx" ON "Project"("active", "name");

DROP TABLE "_ProjectGlobalMap";
