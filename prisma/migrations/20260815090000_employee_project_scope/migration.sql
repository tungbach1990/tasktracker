CREATE TABLE "EmployeeProject" (
  "employeeId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,

  CONSTRAINT "EmployeeProject_pkey" PRIMARY KEY ("employeeId", "projectId")
);

CREATE INDEX "EmployeeProject_projectId_idx" ON "EmployeeProject"("projectId");

ALTER TABLE "EmployeeProject"
  ADD CONSTRAINT "EmployeeProject_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmployeeProject"
  ADD CONSTRAINT "EmployeeProject_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "EmployeeProject" ("employeeId", "projectId")
SELECT e."id", u."currentProjectId"
FROM "Employee" e
JOIN "User" u ON u."id" = e."ownerId"
WHERE u."currentProjectId" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "EmployeeProject" ("employeeId", "projectId")
SELECT DISTINCT te."employeeId", t."projectId"
FROM "TaskEmployee" te
JOIN "Task" t ON t."id" = te."taskId"
WHERE t."projectId" IS NOT NULL
ON CONFLICT DO NOTHING;
