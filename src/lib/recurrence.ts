import { Prisma } from "@prisma/client";

import { firstOpenStatusId } from "@/lib/approvals";
import { hasPermission, type CurrentUser } from "@/lib/authz";
import { dateFromKey, dateKey } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { addDaysKey, legacyRepeatUnitForPattern, nextOccurrenceKey } from "@/lib/recurrence-utils";
import { ensureUserSettings } from "@/lib/settings";
import { getActiveDelegationsForAssistant, getDownlineUserIds } from "@/lib/team";

export const recurrenceMaterializeCap = 30;

export async function materializeDueRecurringTasks(user: CurrentUser, today: Date = new Date()) {
  const todayKey = dateKey(today);
  const todayDate = dateFromKey(todayKey);
  if (!todayDate) return { created: 0 };

  const accessWhere = await recurringTaskAccessWhere(user);
  const templates = await prisma.recurringTask.findMany({
    where: {
      AND: [
        accessWhere,
        {
          active: true,
          archivedAt: null,
          firstOccurrence: { lte: todayDate },
          project: { active: true },
        },
      ],
    },
    include: {
      employees: true,
    },
    orderBy: [{ firstOccurrence: "asc" }, { createdAt: "asc" }],
  });

  if (templates.length === 0) return { created: 0 };

  const existingTasks = await prisma.task.findMany({
    where: {
      recurringTaskId: { in: templates.map((template) => template.id) },
      recurrenceOccurrence: { not: null },
    },
    select: { recurringTaskId: true, recurrenceOccurrence: true },
  });
  const existingKeys = new Set(
    existingTasks
      .map((task) =>
        task.recurringTaskId && task.recurrenceOccurrence
          ? recurrenceTaskOccurrenceKey(task.recurringTaskId, dateKey(task.recurrenceOccurrence))
          : "",
      )
      .filter(Boolean),
  );

  let created = 0;
  for (const template of templates) {
    const occurrenceKeys = dueOccurrenceKeys(template, todayKey);
    for (const occurrenceKey of occurrenceKeys) {
      if (created >= recurrenceMaterializeCap) return { created };
      const mapKey = recurrenceTaskOccurrenceKey(template.id, occurrenceKey);
      if (existingKeys.has(mapKey)) continue;

      const startDate = dateFromKey(occurrenceKey);
      const durationDays = Math.max(1, Math.trunc(template.durationDays || 1));
      const dueDate = dateFromKey(addDaysKey(occurrenceKey, durationDays) ?? occurrenceKey);
      if (!startDate || !dueDate) continue;

      await ensureUserSettings(prisma, template.ownerId);
      const statusId = await firstOpenStatusId(template.ownerId);
      if (!statusId) continue;

      try {
        await prisma.task.create({
          data: {
            title: template.title,
            description: template.description,
            result: "",
            feedback: "",
            taskType: "big",
            kind: "assigned",
            workflowStatus: "active",
            parentId: null,
            projectId: template.projectId,
            statusId,
            priority: template.priority,
            startDate,
            dueDate,
            dueHistory: [],
            sortOrder: 100,
            repeats: false,
            repeatEvery: 1,
            repeatUnit: "day",
            repeatPattern: "daily",
            repeatWeekdays: Prisma.JsonNull,
            repeatEndsAt: null,
            repeatNoticeDays: 7,
            seriesId: null,
            occurrence: null,
            recurringTaskId: template.id,
            recurrenceOccurrence: startDate,
            completedAt: null,
            deletedAt: null,
            performerId: template.performerId,
            ownerId: template.ownerId,
            createdById: template.createdById,
            updatedById: template.updatedById ?? template.createdById,
            employees: {
              createMany: {
                data: template.employees.map((employee) => ({ employeeId: employee.employeeId })),
                skipDuplicates: true,
              },
            },
            history: {
              create: {
                action: "recurring_task_materialized",
                userId: template.createdById,
                onBehalfOfId: template.onBehalfOfId,
                after: {
                  recurringTaskId: template.id,
                  occurrenceDate: occurrenceKey,
                  durationDays,
                },
              },
            },
          },
        });
        created += 1;
        existingKeys.add(mapKey);
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        existingKeys.add(mapKey);
      }
    }
  }

  return { created };
}

export async function recurringTaskAccessWhere(user: CurrentUser): Promise<Prisma.RecurringTaskWhereInput> {
  if (hasPermission(user, "task.view.all")) return {};

  const filters: Prisma.RecurringTaskWhereInput[] = [];

  if (hasPermission(user, "task.view.own")) {
    filters.push({
      OR: [{ ownerId: user.id }, { createdById: user.id }],
    });
  }

  filters.push(
    { performerId: user.id },
    {
      employees: {
        some: {
          employee: {
            linkedUserId: user.id,
            linkStatus: "confirmed",
          },
        },
      },
    },
  );

  if (hasPermission(user, "team.view.downline")) {
    const downlineIds = await getDownlineUserIds(user.id);
    if (downlineIds.length > 0) {
      filters.push({ ownerId: { in: downlineIds } });
    }
  }

  filters.push(...(await delegatedRecurringTaskFilters(user.id)));

  return filters.length > 0 ? { OR: filters } : { id: { in: [] } };
}

function dueOccurrenceKeys(
  template: {
    firstOccurrence: Date | string;
    repeatEvery: number;
    repeatPattern: "daily" | "weekdays" | "weekly" | "monthly" | "quarterly" | "yearly";
    repeatWeekdays: unknown;
    repeatEndsAt: Date | string | null;
  },
  todayKey: string,
) {
  const keys: string[] = [];
  const firstKey = dateKey(template.firstOccurrence);
  const endsKey = dateKey(template.repeatEndsAt);
  if (!firstKey || firstKey > todayKey) return keys;

  let currentKey = firstKey;
  for (let guard = 0; guard < 3660; guard += 1) {
    if (endsKey && currentKey > endsKey) break;
    if (currentKey > todayKey) break;
    keys.push(currentKey);

    const nextKey = nextOccurrenceKey(currentKey, {
      repeatEvery: template.repeatEvery,
      repeatPattern: template.repeatPattern,
      repeatWeekdays: template.repeatWeekdays,
      anchor: firstKey,
    });
    if (!nextKey || nextKey === currentKey) break;
    currentKey = nextKey;
  }

  return keys;
}

async function delegatedRecurringTaskFilters(assistantId: string) {
  const delegations = await getActiveDelegationsForAssistant(assistantId);
  const filters: Prisma.RecurringTaskWhereInput[] = [];

  for (const delegation of delegations) {
    const { managerId, projectId } = delegation;
    const permissions = await permissionKeysForUser(managerId);

    if (permissions.includes("task.view.all")) {
      filters.push({ projectId });
      continue;
    }

    filters.push(
      { projectId, ownerId: managerId },
      { projectId, performerId: managerId },
      { projectId, createdById: managerId },
      {
        projectId,
        employees: {
          some: {
            employee: {
              linkedUserId: managerId,
              linkStatus: "confirmed",
            },
          },
        },
      },
    );

    if (permissions.includes("team.view.downline")) {
      const downlineIds = await getDownlineUserIds(managerId);
      if (downlineIds.length > 0) {
        filters.push({ projectId, ownerId: { in: downlineIds } });
      }
    }
  }

  return filters;
}

async function permissionKeysForUser(userId: string) {
  const roles = await prisma.userRole.findMany({
    where: { userId },
    include: {
      role: {
        include: {
          permissions: {
            include: { permission: true },
          },
        },
      },
    },
  });

  return Array.from(
    new Set(
      roles.flatMap((userRole) =>
        userRole.role.permissions.map((rolePermission) => rolePermission.permission.key),
      ),
    ),
  );
}

function recurrenceTaskOccurrenceKey(recurringTaskId: string, occurrenceKey: string) {
  return `${recurringTaskId}:${occurrenceKey}`;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function nonRecurringTaskPayload() {
  return {
    repeats: false,
    repeatEvery: 1,
    repeatUnit: legacyRepeatUnitForPattern("daily"),
    repeatPattern: "daily" as const,
    repeatWeekdays: Prisma.JsonNull,
    repeatEndsAt: null,
    repeatNoticeDays: 7,
    seriesId: null,
    occurrence: null,
  };
}
