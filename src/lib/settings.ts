import type { PrismaClient } from "@prisma/client";

import { defaultDashboardSections, defaultStatusOptions, kanbanColumnWidth, kanbanWorkflowColumns } from "@/lib/constants";
import { ensureUserCurrentProject } from "@/lib/projects";

export async function ensureUserSettings(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true },
  });
  if (!user) return;

  await prisma.taskStatusOption.createMany({
    data: defaultStatusOptions.map((status) => ({
      ...status,
      ownerId: userId,
    })),
    skipDuplicates: true,
  });

  const currentProjectId = await ensureUserCurrentProject(prisma, userId);

  const selfEmployee = await prisma.employee.upsert({
    where: { ownerId_key: { ownerId: userId, key: "self" } },
    update: {
      name: user.displayName,
      active: true,
      linkedUserId: userId,
      linkStatus: "confirmed",
      linkRespondedAt: new Date(),
    },
    create: {
      ownerId: userId,
      key: "self",
      name: user.displayName,
      active: true,
      linkedUserId: userId,
      linkStatus: "confirmed",
      linkRequestedAt: new Date(),
      linkRespondedAt: new Date(),
    },
  });
  if (currentProjectId) {
    await prisma.employeeProject.upsert({
      where: { employeeId_projectId: { employeeId: selfEmployee.id, projectId: currentProjectId } },
      update: {},
      create: { employeeId: selfEmployee.id, projectId: currentProjectId },
    });
  }

  await prisma.dashboardSectionPreference.createMany({
    data: defaultDashboardSections.map((section) => ({
      sectionKey: section.sectionKey,
      label: section.label,
      enabled: section.enabled,
      sortOrder: section.sortOrder,
      config: section.config,
      ownerId: userId,
    })),
    skipDuplicates: true,
  });

  await ensureKanbanSettings(prisma, userId);
}

export async function copyDefaultSettingsForUser(prisma: PrismaClient, userId: string) {
  await ensureUserSettings(prisma, userId);
}

export async function ensureKanbanSettings(prisma: PrismaClient, userId: string) {
  const activeOpenStatuses = await prisma.taskStatusOption.findMany({
    where: { ownerId: userId, active: true, done: false },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { key: true, sortOrder: true },
  });

  await prisma.kanbanColumnPreference.createMany({
    data: [
      ...kanbanWorkflowColumns.map((column) => ({
        ownerId: userId,
        columnKey: column.columnKey,
        columnType: "workflow" as const,
        enabled: true,
        sortOrder: column.sortOrder,
        widthPx: kanbanColumnWidth.default,
      })),
      ...activeOpenStatuses.map((status) => ({
        ownerId: userId,
        columnKey: `status:${status.key}`,
        columnType: "status" as const,
        enabled: true,
        sortOrder: 100 + status.sortOrder,
        widthPx: kanbanColumnWidth.default,
      })),
    ],
    skipDuplicates: true,
  });
}

export function clampKanbanWidth(value: number) {
  if (!Number.isFinite(value)) return kanbanColumnWidth.default;
  return Math.min(kanbanColumnWidth.max, Math.max(kanbanColumnWidth.min, Math.trunc(value)));
}

export async function ensureSelfEmployee(prisma: PrismaClient, userId: string) {
  await ensureUserSettings(prisma, userId);
  return prisma.employee.findUniqueOrThrow({
    where: { ownerId_key: { ownerId: userId, key: "self" } },
    select: { id: true },
  });
}

export function dashboardNumber(
  config: unknown,
  key: string,
  fallback: number,
  options: { min?: number; max?: number } = {},
) {
  const value =
    typeof config === "object" && config && key in config
      ? Number((config as Record<string, unknown>)[key])
      : NaN;
  if (!Number.isFinite(value)) return fallback;
  const min = options.min ?? 1;
  const max = options.max ?? 100;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
