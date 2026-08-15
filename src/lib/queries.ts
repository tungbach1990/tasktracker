import type { Prisma } from "@prisma/client";

import { getManagerChain, isTaskFinalDone } from "@/lib/approvals";
import { hasPermission, taskAccessWhere, type CurrentUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { dashboardNumber, ensureUserSettings } from "@/lib/settings";
import { compareOperationalPriority } from "@/lib/task-priority";
import { getDownlineUserIds, hasActiveDelegation } from "@/lib/team";

export async function visibleTaskWhere(user: CurrentUser): Promise<Prisma.TaskWhereInput> {
  return taskAccessWhere(user);
}

export async function taskScopeWhere(user: CurrentUser, scope: string): Promise<Prisma.TaskWhereInput> {
  const notDeleted: Prisma.TaskWhereInput = { deletedAt: null };
  if (scope === "own") return { AND: [notDeleted, { OR: [{ ownerId: user.id }, { ownerId: null, createdById: user.id }] }] };
  if (scope === "assigned") {
    return {
      AND: [
        notDeleted,
        {
          OR: [
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
          ],
        },
      ],
    };
  }
  if (scope === "team") {
    if (!hasPermission(user, "team.view.downline")) return { id: { in: [] } };
    const downlineIds = await getDownlineUserIds(user.id);
    return downlineIds.length
      ? {
          AND: [
            notDeleted,
            {
              OR: [
                { ownerId: { in: downlineIds } },
                { ownerId: null, createdById: { in: downlineIds } },
              ],
            },
          ],
        }
      : { id: { in: [] } };
  }
  if (scope === "all" && hasPermission(user, "task.view.all")) return notDeleted;

  return visibleTaskWhere(user);
}

export async function getDashboardData(user: CurrentUser) {
  await ensureUserSettings(prisma, user.id);
  const where = await visibleTaskWhere(user);

  const [tasks, preferences] = await Promise.all([
    prisma.task.findMany({
      where: { AND: [where, { parentId: null }] },
      include: {
        project: true,
        status: true,
        createdBy: { select: { id: true, username: true, displayName: true } },
        parent: { select: { id: true, title: true } },
        children: {
          where: { deletedAt: null },
          include: {
            status: true,
            employees: { include: { employee: true } },
            children: {
              where: { deletedAt: null },
              include: {
                status: true,
              },
              orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }, { title: "asc" }],
            },
          },
          orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }, { title: "asc" }],
        },
        employees: { include: { employee: true } },
      },
      orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.dashboardSectionPreference.findMany({
      where: { ownerId: user.id },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
  ]);
  const statusOwnerIds = Array.from(new Set([user.id, ...tasks.map((task) => task.ownerId ?? task.createdById)]));
  const statuses = await prisma.taskStatusOption.findMany({
    where: { ownerId: { in: statusOwnerIds } },
    orderBy: [{ ownerId: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
  });
  tasks.sort(compareOperationalPriority);
  for (const task of tasks) {
    task.children.sort(compareOperationalPriority);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcomingPreference = preferences.find((item) => item.sectionKey === "upcoming");
  const upcomingDays = dashboardNumber(upcomingPreference?.config, "days", 7, { min: 1, max: 365 });
  const nextDate = new Date(today);
  nextDate.setDate(nextDate.getDate() + upcomingDays);
  const startAfterPreference = preferences.find((item) => item.sectionKey === "start_after");
  const startAfterDays = dashboardNumber(startAfterPreference?.config, "days", 0, { min: 0, max: 365 });
  const startAfterDate = new Date(today);
  startAfterDate.setDate(startAfterDate.getDate() + startAfterDays);

  const openTasks = tasks.filter((task) => !isTaskFinalDone(task) && task.workflowStatus !== "pending_registration");

  const statusRows = new Map<string, { status: (typeof statuses)[number]; count: number }>();
  for (const status of statuses) {
    if (!statusRows.has(status.key)) statusRows.set(status.key, { status, count: 0 });
  }
  for (const task of tasks) {
    const key = task.status.key;
    const current = statusRows.get(key) ?? { status: task.status, count: 0 };
    current.count += 1;
    statusRows.set(key, current);
  }

  return {
    tasks,
    statuses,
    preferences,
    upcomingDays,
    startAfterDays,
    counts: {
      total: tasks.length,
      overdue: openTasks.filter((task) => task.dueDate && task.dueDate < today).length,
      today: openTasks.filter(
        (task) =>
          task.dueDate &&
          task.dueDate.toISOString().slice(0, 10) === today.toISOString().slice(0, 10),
      ).length,
      upcoming: openTasks.filter(
        (task) => task.dueDate && task.dueDate > today && task.dueDate <= nextDate,
      ).length,
      afterUpcoming: openTasks.filter((task) => task.dueDate && task.dueDate > nextDate).length,
      startAfter: openTasks.filter((task) => task.startDate && task.startDate > startAfterDate).length,
      done: tasks.filter((task) => isTaskFinalDone(task)).length,
    },
    byStatus: Array.from(statusRows.values()),
  };
}

async function filterAssignableEmployeesForActor<
  T extends { key: string; linkedUserId: string | null },
>(
  actor: CurrentUser,
  ownerId: string,
  employees: T[],
) {
  if (hasPermission(actor, "task.view.all") || hasPermission(actor, "team.manage.all")) {
    return employees;
  }

  const managerChain = await getManagerChain(actor.id);
  const forbiddenLinkedUserIds = new Set(managerChain.map((manager) => manager.id));

  return employees.filter((employee) => {
    if (employee.linkedUserId && forbiddenLinkedUserIds.has(employee.linkedUserId)) return false;
    if (ownerId !== actor.id && employee.key === "self" && employee.linkedUserId === ownerId) return false;
    return true;
  });
}

async function taskReferenceDataForOwner(
  ownerId: string,
  canChooseProject: boolean,
  excludeTaskId?: string,
  projectIds?: string[],
  actor?: CurrentUser,
) {
  await ensureUserSettings(prisma, ownerId);
  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { currentProjectId: true, displayName: true, username: true },
  });
  const projectWhere: Prisma.ProjectWhereInput = projectIds?.length
    ? { id: { in: projectIds }, active: true }
    : canChooseProject
      ? { active: true }
      : owner?.currentProjectId
        ? { id: owner.currentProjectId, active: true }
        : { active: true };

  const [projects, employees, statuses, parentTasks] = await Promise.all([
    prisma.project.findMany({
      where: projectWhere,
      orderBy: { name: "asc" },
    }),
    prisma.employee.findMany({
      where: {
        ownerId,
        active: true,
        linkStatus: "confirmed",
        linkedUserId: { not: null },
        projects: projectIds?.length ? { some: { projectId: { in: projectIds } } } : undefined,
      },
      include: {
        linkedUser: { select: { id: true, username: true, displayName: true } },
        projects: {
          include: { project: true },
          orderBy: { project: { name: "asc" } },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.taskStatusOption.findMany({
      where: { ownerId, active: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
    prisma.task.findMany({
      where: {
        createdById: ownerId,
        deletedAt: null,
        parentId: null,
        id: excludeTaskId ? { not: excludeTaskId } : undefined,
      },
      include: {
        project: true,
        status: true,
      },
      orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }, { title: "asc" }],
    }),
  ]);

  const visibleEmployees = actor
    ? await filterAssignableEmployeesForActor(actor, ownerId, employees)
    : employees;

  return {
    owner: owner
      ? { id: ownerId, displayName: owner.displayName, username: owner.username }
      : { id: ownerId, displayName: "", username: "" },
    canChooseProject,
    projects,
    employees: visibleEmployees,
    statuses,
    parentTasks,
  };
}

type TaskAssignmentStatusContextInput = {
  owner: { id: string; username: string; displayName: string };
  employees: Array<{
    linkedUserId: string | null;
    linkedUser?: { id: string; username: string; displayName: string } | null;
  }>;
};

export async function getLinkedEmployeeStatusContexts(contexts: TaskAssignmentStatusContextInput[]) {
  const existingOwnerIds = new Set(contexts.map((context) => context.owner.id));
  const linkedUsers = new Map<string, { id: string; username: string; displayName: string }>();

  for (const context of contexts) {
    for (const employee of context.employees) {
      if (!employee.linkedUserId || existingOwnerIds.has(employee.linkedUserId)) continue;
      if (employee.linkedUser) {
        linkedUsers.set(employee.linkedUser.id, employee.linkedUser);
      }
    }
  }

  if (linkedUsers.size === 0) return [];

  await Promise.all(Array.from(linkedUsers.keys()).map((userId) => ensureUserSettings(prisma, userId)));
  const statuses = await prisma.taskStatusOption.findMany({
    where: { ownerId: { in: Array.from(linkedUsers.keys()) }, active: true },
    orderBy: [{ ownerId: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
  });
  const statusesByOwner = new Map<string, typeof statuses>();
  for (const status of statuses) {
    const ownerStatuses = statusesByOwner.get(status.ownerId) ?? [];
    ownerStatuses.push(status);
    statusesByOwner.set(status.ownerId, ownerStatuses);
  }

  return Array.from(linkedUsers.values()).map((owner) => ({
    owner,
    canChooseProject: false,
    projects: [],
    employees: [],
    statuses: statusesByOwner.get(owner.id) ?? [],
  }));
}

export async function getTaskReferenceData(user: CurrentUser, excludeTaskId?: string, settingsOwnerId = user.id, projectId?: string) {
  const canUseRequestedOwner =
    settingsOwnerId === user.id ||
    hasPermission(user, "task.view.all") ||
    hasPermission(user, "project.manage") ||
    Boolean(projectId && (await hasActiveDelegation(settingsOwnerId, user.id, projectId)));
  const ownerId = canUseRequestedOwner ? settingsOwnerId : user.id;
  const canChooseProject = hasPermission(user, "task.view.all") || hasPermission(user, "project.manage");

  return taskReferenceDataForOwner(ownerId, canChooseProject, excludeTaskId, !canChooseProject && projectId ? [projectId] : undefined, user);
}

export async function getTaskDelegationContexts(user: CurrentUser) {
  const delegations = await prisma.teamDelegation.findMany({
    where: { assistantId: user.id, active: true, project: { active: true } },
    include: {
      manager: { select: { id: true, username: true, displayName: true } },
      project: true,
    },
    orderBy: [{ project: { name: "asc" } }, { manager: { displayName: "asc" } }, { manager: { username: "asc" } }],
  });
  if (delegations.length === 0) return [];

  const contexts = [];
  for (const delegation of delegations) {
    const referenceData = await taskReferenceDataForOwner(delegation.managerId, false, undefined, [delegation.projectId], user);
    contexts.push({
      owner: delegation.manager,
      canChooseProject: false,
      projects: referenceData.projects,
      employees: referenceData.employees,
      statuses: referenceData.statuses,
    });
  }

  return contexts;
}

export async function getSettingsData(userId: string) {
  await ensureUserSettings(prisma, userId);

  const [settingsOwner, projects, statuses, dashboardSections, kanbanColumns] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        currentProjectId: true,
        currentProject: true,
      },
    }),
    prisma.project.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.taskStatusOption.findMany({
      where: { ownerId: userId },
      orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { label: "asc" }],
      include: { _count: { select: { tasks: true } } },
    }),
    prisma.dashboardSectionPreference.findMany({
      where: { ownerId: userId },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
    prisma.kanbanColumnPreference.findMany({
      where: { ownerId: userId },
      orderBy: [{ sortOrder: "asc" }, { columnKey: "asc" }],
    }),
  ]);

  return { currentProject: settingsOwner?.currentProject ?? null, projects, statuses, dashboardSections, kanbanColumns };
}
