CREATE TYPE "KanbanColumnType" AS ENUM ('workflow', 'status');

CREATE TABLE "KanbanColumnPreference" (
  "id" TEXT NOT NULL,
  "columnKey" TEXT NOT NULL,
  "columnType" "KanbanColumnType" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL,
  "widthPx" INTEGER NOT NULL DEFAULT 320,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "ownerId" TEXT NOT NULL,
  CONSTRAINT "KanbanColumnPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KanbanColumnPreference_ownerId_columnKey_key" ON "KanbanColumnPreference"("ownerId", "columnKey");
CREATE INDEX "KanbanColumnPreference_ownerId_enabled_sortOrder_idx" ON "KanbanColumnPreference"("ownerId", "enabled", "sortOrder");

ALTER TABLE "KanbanColumnPreference"
  ADD CONSTRAINT "KanbanColumnPreference_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "KanbanColumnPreference" (
  "id",
  "columnKey",
  "columnType",
  "enabled",
  "sortOrder",
  "widthPx",
  "updatedAt",
  "ownerId"
)
SELECT
  'kanban_' || u."id" || '_workflow_pending_registration',
  'workflow:pending_registration',
  'workflow',
  true,
  10,
  320,
  CURRENT_TIMESTAMP,
  u."id"
FROM "User" u
ON CONFLICT ("ownerId", "columnKey") DO NOTHING;

INSERT INTO "KanbanColumnPreference" (
  "id",
  "columnKey",
  "columnType",
  "enabled",
  "sortOrder",
  "widthPx",
  "updatedAt",
  "ownerId"
)
SELECT
  'kanban_' || u."id" || '_workflow_registration_rejected',
  'workflow:registration_rejected',
  'workflow',
  true,
  20,
  320,
  CURRENT_TIMESTAMP,
  u."id"
FROM "User" u
ON CONFLICT ("ownerId", "columnKey") DO NOTHING;

INSERT INTO "KanbanColumnPreference" (
  "id",
  "columnKey",
  "columnType",
  "enabled",
  "sortOrder",
  "widthPx",
  "updatedAt",
  "ownerId"
)
SELECT
  'kanban_' || u."id" || '_workflow_pending_completion',
  'workflow:pending_completion',
  'workflow',
  true,
  800,
  320,
  CURRENT_TIMESTAMP,
  u."id"
FROM "User" u
ON CONFLICT ("ownerId", "columnKey") DO NOTHING;

INSERT INTO "KanbanColumnPreference" (
  "id",
  "columnKey",
  "columnType",
  "enabled",
  "sortOrder",
  "widthPx",
  "updatedAt",
  "ownerId"
)
SELECT
  'kanban_' || u."id" || '_workflow_final_done',
  'workflow:final_done',
  'workflow',
  true,
  900,
  320,
  CURRENT_TIMESTAMP,
  u."id"
FROM "User" u
ON CONFLICT ("ownerId", "columnKey") DO NOTHING;

INSERT INTO "KanbanColumnPreference" (
  "id",
  "columnKey",
  "columnType",
  "enabled",
  "sortOrder",
  "widthPx",
  "updatedAt",
  "ownerId"
)
SELECT
  'kanban_' || u."id" || '_workflow_completion_rejected',
  'workflow:completion_rejected',
  'workflow',
  true,
  910,
  320,
  CURRENT_TIMESTAMP,
  u."id"
FROM "User" u
ON CONFLICT ("ownerId", "columnKey") DO NOTHING;

INSERT INTO "KanbanColumnPreference" (
  "id",
  "columnKey",
  "columnType",
  "enabled",
  "sortOrder",
  "widthPx",
  "updatedAt",
  "ownerId"
)
SELECT
  'kanban_' || s."ownerId" || '_status_' || regexp_replace(s."key", '[^a-zA-Z0-9_]+', '_', 'g'),
  'status:' || s."key",
  'status',
  true,
  100 + s."sortOrder",
  320,
  CURRENT_TIMESTAMP,
  s."ownerId"
FROM "TaskStatusOption" s
WHERE s."active" = true
  AND s."done" = false
ON CONFLICT ("ownerId", "columnKey") DO NOTHING;
