WITH first_active AS (
  SELECT "id"
  FROM "Project"
  WHERE "active" = true
  ORDER BY "createdAt" ASC, "name" ASC, "id" ASC
  LIMIT 1
)
UPDATE "User" u
SET "currentProjectId" = (SELECT "id" FROM first_active)
WHERE (SELECT "id" FROM first_active) IS NOT NULL
  AND u."currentProjectId" IS DISTINCT FROM (SELECT "id" FROM first_active);

DELETE FROM "UserProject";

INSERT INTO "UserProject" ("userId", "projectId")
SELECT u."id", u."currentProjectId"
FROM "User" u
WHERE u."currentProjectId" IS NOT NULL
ON CONFLICT ("userId", "projectId") DO NOTHING;
