import type { Prisma } from "@prisma/client";
import { Prisma as PrismaRuntime } from "@prisma/client";

import { firstOpenStatusId, isTaskFinalDone } from "@/lib/approvals";
import { taskAccessWhere, type CurrentUser } from "@/lib/authz";
import { dateFromKey, dateKey } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import {
  addDaysKey,
  daysBetweenKeys,
  legacyRepeatUnitForPattern,
  nextOccurrenceKey,
  normalizeRepeatWeekdays,
  occurrenceReferenceKey,
} from "@/lib/recurrence-utils";

export const recurrenceCreateCap = 30;

type RecurringSeed = Prisma.TaskGetPayload<{
  include: {
    status: true;
    employees: true;
  };
}>;

export async function ensureRecurringOccurrencesForVisibleTasks(
  user: CurrentUser,
  accessWhere?: Prisma.TaskWhereInput,
) {
  const visibleWhere = accessWhere ?? (await taskAccessWhere(user));
  const visibleSeeds = await prisma.task.findMany({
    where: {
      AND: [
        visibleWhere,
        {
          deletedAt: null,
          parentId: null,
          repeats: true,
          seriesId: { not: null },
          occurrence: { not: null },
        },
      ],
    },
    select: { seriesId: true },
  });

  const seriesIds = Array.from(
    new Set(
      visibleSeeds
        .map((task) => task.seriesId)
        .filter((seriesId): seriesId is string => Boolean(seriesId)),
    ),
  );
  if (seriesIds.length === 0) return 0;

  const seriesTasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      parentId: null,
      repeats: true,
      seriesId: { in: seriesIds },
      occurrence: { not: null },
    },
    include: {
      status: true,
      employees: true,
    },
    orderBy: [{ seriesId: "asc" }, { occurrence: "asc" }, { createdAt: "asc" }],
  });

  const tasksBySeries = new Map<string, RecurringSeed[]>();
  for (const task of seriesTasks) {
    if (!task.seriesId) continue;
    const group = tasksBySeries.get(task.seriesId) ?? [];
    group.push(task);
    tasksBySeries.set(task.seriesId, group);
  }

  const todayKey = dateKey(new Date());
  let created = 0;

  for (const [seriesId, tasks] of tasksBySeries) {
    if (created >= recurrenceCreateCap || tasks.length === 0) break;
    const anchor = tasks[0];
    const existingByOccurrence = new Map(
      tasks
        .filter((task) => task.occurrence)
        .map((task) => [`${seriesId}:${dateKey(task.occurrence)}`, task] as const),
    );
    let seed = tasks[tasks.length - 1];

    for (let guard = 0; guard < recurrenceCreateCap && created < recurrenceCreateCap; guard += 1) {
      if (!seed.occurrence) break;
      const nextKey = nextOccurrenceKey(seed.occurrence, {
        repeatEvery: seed.repeatEvery,
        repeatPattern: seed.repeatPattern,
        repeatWeekdays: seed.repeatWeekdays,
        anchor: anchor.occurrence,
      });
      if (!nextKey) break;

      const repeatEndsAtKey = dateKey(seed.repeatEndsAt);
      if (repeatEndsAtKey && nextKey > repeatEndsAtKey) break;

      const noticeCutoffKey = addDaysKey(todayKey, Math.max(0, Math.trunc(seed.repeatNoticeDays || 0))) ?? todayKey;
      const shouldCreate = isTaskFinalDone(seed) || nextKey <= noticeCutoffKey;
      if (!shouldCreate) break;

      const existing = existingByOccurrence.get(`${seriesId}:${nextKey}`);
      if (existing) {
        seed = existing;
        continue;
      }

      const openStatusId = await firstOpenStatusId(taskOwnerId(seed));
      if (!openStatusId) break;

      const nextOccurrence = dateFromKey(nextKey);
      const createdTask = await prisma.task.create({
        data: {
          title: seed.title,
          description: seed.description,
          result: "",
          feedback: "",
          taskType: seed.taskType,
          kind: seed.kind,
          workflowStatus: "active",
          parentId: null,
          projectId: seed.projectId,
          statusId: openStatusId,
          priority: seed.priority,
          startDate: shiftDateByOccurrence(seed.startDate, seed.occurrence, nextKey),
          dueDate: shiftDateByOccurrence(seed.dueDate, seed.occurrence, nextKey),
          dueHistory: [],
          sortOrder: seed.sortOrder,
          repeats: true,
          repeatEvery: seed.repeatEvery,
          repeatUnit: legacyRepeatUnitForPattern(seed.repeatPattern),
          repeatPattern: seed.repeatPattern,
          repeatWeekdays: repeatWeekdaysInput(seed.repeatWeekdays),
          repeatEndsAt: seed.repeatEndsAt,
          repeatNoticeDays: seed.repeatNoticeDays,
          seriesId,
          occurrence: nextOccurrence,
          completedAt: null,
          performerId: seed.performerId,
          ownerId: taskOwnerId(seed),
          createdById: seed.createdById,
          updatedById: user.id,
          employees: {
            createMany: {
              data: seed.employees.map((employee) => ({ employeeId: employee.employeeId })),
              skipDuplicates: true,
            },
          },
          history: {
            create: {
              action: "recurrence_created",
              userId: user.id,
              after: {
                seriesId,
                occurrence: nextKey,
                sourceTaskId: seed.id,
              },
            },
          },
        },
        include: {
          status: true,
          employees: true,
        },
      });

      await cloneRecurringChildren(seed.id, createdTask.id, seed.occurrence, nextKey, user.id);
      existingByOccurrence.set(`${seriesId}:${nextKey}`, createdTask);
      seed = createdTask;
      created += 1;
    }
  }

  return created;
}

async function cloneRecurringChildren(
  sourceParentId: string,
  targetParentId: string,
  sourceOccurrence: Date | string | null,
  targetOccurrenceKey: string,
  actorId: string,
) {
  const children = await prisma.task.findMany({
    where: { parentId: sourceParentId, deletedAt: null },
    include: { employees: true },
    orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }, { title: "asc" }],
  });

  for (const child of children) {
    const createdChild = await prisma.task.create({
      data: {
        title: child.title,
        description: child.description,
        result: "",
        feedback: "",
        taskType: child.taskType,
        kind: child.kind,
        workflowStatus: "active",
        parentId: targetParentId,
        projectId: child.projectId,
        statusId: child.statusId,
        priority: child.priority,
        startDate: shiftDateByOccurrence(child.startDate, sourceOccurrence, targetOccurrenceKey),
        dueDate: shiftDateByOccurrence(child.dueDate, sourceOccurrence, targetOccurrenceKey),
        dueHistory: [],
        sortOrder: child.sortOrder,
        repeats: false,
        repeatEvery: 1,
        repeatUnit: "day",
        repeatPattern: "daily",
        repeatWeekdays: PrismaRuntime.JsonNull,
        repeatEndsAt: null,
        repeatNoticeDays: 7,
        seriesId: null,
        occurrence: null,
        completedAt: null,
        performerId: child.performerId,
        ownerId: taskOwnerId(child),
        createdById: child.createdById,
        updatedById: actorId,
        employees: {
          createMany: {
            data: child.employees.map((employee) => ({ employeeId: employee.employeeId })),
            skipDuplicates: true,
          },
        },
        history: {
          create: {
            action: "recurrence_child_created",
            userId: actorId,
            after: {
              sourceTaskId: child.id,
              sourceParentId,
              parentId: targetParentId,
              occurrence: targetOccurrenceKey,
            },
          },
        },
      },
    });

    await cloneRecurringChildren(child.id, createdChild.id, sourceOccurrence, targetOccurrenceKey, actorId);
  }
}

function shiftDateByOccurrence(
  date: Date | string | null | undefined,
  sourceOccurrence: Date | string | null | undefined,
  targetOccurrenceKey: string,
) {
  const dateText = dateKey(date);
  const sourceKey = occurrenceReferenceKey({
    occurrence: sourceOccurrence,
    dueDate: date,
    startDate: date,
  });
  if (!dateText || !sourceKey) return null;

  const shifted = addDaysKey(dateText, daysBetweenKeys(sourceKey, targetOccurrenceKey));
  return dateFromKey(shifted);
}

function repeatWeekdaysInput(value: unknown) {
  const weekdays = normalizeRepeatWeekdays(value);
  return weekdays.length ? weekdays : PrismaRuntime.JsonNull;
}

function taskOwnerId(task: { ownerId?: string | null; createdById: string }) {
  return task.ownerId ?? task.createdById;
}
