ALTER TABLE "TaskApproval" ADD COLUMN "delegatedForId" TEXT;
ALTER TABLE "TaskHistory" ADD COLUMN "onBehalfOfId" TEXT;

CREATE TABLE "TeamDelegation" (
  "id" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "managerId" TEXT NOT NULL,
  "assistantId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,

  CONSTRAINT "TeamDelegation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamDelegation_managerId_assistantId_key" ON "TeamDelegation"("managerId", "assistantId");
CREATE INDEX "TeamDelegation_assistantId_active_idx" ON "TeamDelegation"("assistantId", "active");
CREATE INDEX "TeamDelegation_managerId_active_idx" ON "TeamDelegation"("managerId", "active");
CREATE INDEX "TaskApproval_delegatedForId_idx" ON "TaskApproval"("delegatedForId");
CREATE INDEX "TaskHistory_onBehalfOfId_idx" ON "TaskHistory"("onBehalfOfId");

ALTER TABLE "TaskApproval"
  ADD CONSTRAINT "TaskApproval_delegatedForId_fkey"
  FOREIGN KEY ("delegatedForId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskHistory"
  ADD CONSTRAINT "TaskHistory_onBehalfOfId_fkey"
  FOREIGN KEY ("onBehalfOfId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TeamDelegation"
  ADD CONSTRAINT "TeamDelegation_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamDelegation"
  ADD CONSTRAINT "TeamDelegation_assistantId_fkey"
  FOREIGN KEY ("assistantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamDelegation"
  ADD CONSTRAINT "TeamDelegation_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
