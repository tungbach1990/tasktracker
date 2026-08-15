CREATE TEMP TABLE "_ProjectNameMergeMap" AS
WITH normalized AS (
  SELECT
    p."id" AS "oldProjectId",
    COALESCE(
      NULLIF(btrim(regexp_replace(lower(trim(p."name")), '[^a-z0-9]+', '-', 'g'), '-'), ''),
      NULLIF(lower(trim(p."key")), ''),
      'project'
    ) AS "nameKey",
    p."active",
    p."createdAt",
    p."name"
  FROM "Project" p
),
duplicate_names AS (
  SELECT "nameKey"
  FROM normalized
  GROUP BY "nameKey"
  HAVING count(*) > 1
),
ranked AS (
  SELECT
    n.*,
    first_value(n."oldProjectId") OVER (
      PARTITION BY n."nameKey"
      ORDER BY n."active" DESC, n."createdAt" ASC, n."name" ASC, n."oldProjectId" ASC
    ) AS "canonicalProjectId"
  FROM normalized n
  JOIN duplicate_names d ON d."nameKey" = n."nameKey"
)
SELECT "oldProjectId", "canonicalProjectId"
FROM ranked;

UPDATE "Project" p
SET "active" = canonical."active"
FROM (
  SELECT
    m."canonicalProjectId",
    bool_or(existing."active") AS "active"
  FROM "_ProjectNameMergeMap" m
  JOIN "Project" existing ON existing."id" = m."oldProjectId"
  GROUP BY m."canonicalProjectId"
) canonical
WHERE p."id" = canonical."canonicalProjectId";

UPDATE "Task" t
SET "projectId" = m."canonicalProjectId"
FROM "_ProjectNameMergeMap" m
WHERE t."projectId" = m."oldProjectId"
  AND t."projectId" <> m."canonicalProjectId";

UPDATE "User" u
SET "currentProjectId" = m."canonicalProjectId"
FROM "_ProjectNameMergeMap" m
WHERE u."currentProjectId" = m."oldProjectId"
  AND u."currentProjectId" <> m."canonicalProjectId";

DELETE FROM "UserProject";

DELETE FROM "Project" p
USING "_ProjectNameMergeMap" m
WHERE p."id" = m."oldProjectId"
  AND m."oldProjectId" <> m."canonicalProjectId";

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

DROP TABLE "_ProjectNameMergeMap";
