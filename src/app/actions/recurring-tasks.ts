"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";

import { getManagerChain } from "@/lib/approvals";
import {
  canActAsDelegatedManager,
  hasPermission,
  requireActiveUser,
  type CurrentUser,
} from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { materializeDueRecurringTasks } from "@/lib/recurrence";
import { legacyRepeatUnitForPattern, normalizeRepeatWeekdays } from "@/lib/recurrence-utils";
import { ensureSelfEmployee, ensureUserSettings } from "@/lib/settings";
import { formArray, formBoolean, idSchema, optionalDate, recurringTaskFormSchema } from "@/lib/validation";

function recurringTaskPayload(formData: FormData) {
  return recurringTaskFormSchema.parse({
    id: formData.get("id") || undefined,
    title: formData.get("title"),
    description: formData.get("description") || "",
    projectId: formData.get("projectId"),
    priority: formData.get("priority"),
    repeatEvery: formData.get("repeatEvery") || 1,
    repeatPattern: formData.get("repeatPattern") || "daily",
    repeatWeekdays: formArray(formData, "repeatWeekdays"),
    firstOccurrence: formData.get("firstOccurrence") || "",
    durationDays: formData.get("durationDays") || 1,
    repeatNoticeDays: formData.get("repeatNoticeDays") || 7,
    repeatEndsAt: formData.get("repeatEndsAt") || "",
    active: formBoolean(formData, "active"),
    employeeIds: formArray(formData, "employeeIds"),
  });
}

type RecurringTaskPayload = ReturnType<typeof recurringTaskPayload>;

async function currentProjectIdForUser(userId: string) {
  await ensureUserSettings(prisma, userId);
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { currentProjectId: true },
  });
  if (!owner?.currentProjectId) redirect("/settings/projects");

  const project = await prisma.project.findFirst({
    where: { id: owner.currentProjectId, active: true },
    select: { id: true },
  });
  if (!project) redirect("/settings/projects");

  return project.id;
}

async function activeProjectIdForSubmitted(user: CurrentUser, submittedProjectId: string) {
  const projectId = submittedProjectId || (await currentProjectIdForUser(user.id));
  const project = await prisma.project.findFirst({
    where: { id: projectId, active: true },
    select: { id: true },
  });
  if (!project) redirect("/recurring-tasks");
  return project.id;
}

async function canUseProjectForOwnCreate(user: CurrentUser, projectId: string) {
  if (hasPermission(user, "task.view.all") || hasPermission(user, "project.manage")) return true;
  if (user.currentProjectId === projectId) return true;

  const delegation = await prisma.teamDelegation.findFirst({
    where: { assistantId: user.id, projectId, active: true },
    select: { id: true },
  });
  return Boolean(delegation);
}

async function ensureEmployeeProject(employeeId: string, projectId: string) {
  await prisma.employeeProject.upsert({
    where: { employeeId_projectId: { employeeId, projectId } },
    update: {},
    create: { employeeId, projectId },
  });
}

async function employeeIdsForOwner(ownerId: string, projectId: string) {
  const selfEmployee = await ensureSelfEmployee(prisma, ownerId);
  await ensureEmployeeProject(selfEmployee.id, projectId);
  return [selfEmployee.id];
}

async function selectedEmployeesForProject(employeeIds: string[], projectId: string) {
  const uniqueEmployeeIds = Array.from(new Set(employeeIds));
  const employees = await prisma.employee.findMany({
    where: { id: { in: uniqueEmployeeIds }, active: true },
    select: {
      id: true,
      key: true,
      ownerId: true,
      linkedUserId: true,
      linkStatus: true,
      projects: { where: { projectId }, select: { projectId: true } },
    },
    orderBy: [{ ownerId: "asc" }, { name: "asc" }, { id: "asc" }],
  });

  if (
    employees.length !== uniqueEmployeeIds.length ||
    employees.some((employee) => employee.projects.length === 0)
  ) {
    redirect("/recurring-tasks");
  }

  return { uniqueEmployeeIds, employees };
}

async function assertEmployeesAssignableByActor(
  user: CurrentUser,
  employeeCatalogOwnerId: string,
  employees: Array<{ key: string; linkedUserId: string | null }>,
) {
  if (hasPermission(user, "task.view.all") || hasPermission(user, "team.manage.all")) return;

  const managerChain = await getManagerChain(user.id);
  const managerIds = new Set(managerChain.map((manager) => manager.id));
  const hasForbiddenManager = employees.some((employee) => employee.linkedUserId && managerIds.has(employee.linkedUserId));
  const hasDelegatedManagerSelf =
    employeeCatalogOwnerId !== user.id &&
    employees.some((employee) => employee.key === "self" && employee.linkedUserId === employeeCatalogOwnerId);

  if (hasForbiddenManager || hasDelegatedManagerSelf) redirect("/recurring-tasks");
}

async function resolveSelectedEmployeeAssignment(
  user: CurrentUser,
  projectId: string,
  submittedEmployeeIds: string[],
  options: { requireCreatePermission?: boolean } = {},
) {
  const { uniqueEmployeeIds, employees } = await selectedEmployeesForProject(submittedEmployeeIds, projectId);
  if (employees.some((employee) => employee.linkStatus !== "confirmed" || !employee.linkedUserId)) {
    redirect("/recurring-tasks");
  }

  const employeeCatalogOwnerIds = Array.from(new Set(employees.map((employee) => employee.ownerId)));
  if (employeeCatalogOwnerIds.length !== 1) redirect("/recurring-tasks");
  const employeeCatalogOwnerId = employeeCatalogOwnerIds[0];

  const linkedUserIds = Array.from(
    new Set(employees.map((employee) => employee.linkedUserId).filter((id): id is string => Boolean(id))),
  );
  if (linkedUserIds.length !== 1) redirect("/recurring-tasks");
  const ownerId = linkedUserIds[0];
  const hasGlobalAssignmentPermission = hasPermission(user, "task.view.all") || hasPermission(user, "team.manage.all");
  const delegatedForCatalogOwner =
    employeeCatalogOwnerId !== user.id &&
    (await canActAsDelegatedManager(user.id, employeeCatalogOwnerId, projectId));

  if (employeeCatalogOwnerId === user.id) {
    if (
      options.requireCreatePermission !== false &&
      (!hasPermission(user, "task.create") || !(await canUseProjectForOwnCreate(user, projectId)))
    ) {
      redirect("/dashboard");
    }
  } else if (!hasGlobalAssignmentPermission && !delegatedForCatalogOwner) {
    redirect("/dashboard");
  }

  await assertEmployeesAssignableByActor(user, employeeCatalogOwnerId, employees);
  await ensureUserSettings(prisma, ownerId);

  return {
    ownerId,
    performerId: ownerId,
    projectId,
    employeeIds: uniqueEmployeeIds,
    employeeCatalogOwnerId,
    onBehalfOfId: delegatedForCatalogOwner ? employeeCatalogOwnerId : null,
  };
}

async function onBehalfOfIdForActor(actorId: string, ownerId: string, projectId: string) {
  if (actorId === ownerId) return null;
  return (await canActAsDelegatedManager(actorId, ownerId, projectId)) ? ownerId : null;
}

async function resolveDefaultOwnerAssignment(user: CurrentUser, ownerId: string, projectId: string) {
  const employeeIds = await employeeIdsForOwner(ownerId, projectId);
  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds }, ownerId, active: true },
    select: { id: true, key: true, linkedUserId: true },
  });
  if (employees.length !== employeeIds.length) redirect("/recurring-tasks");
  await assertEmployeesAssignableByActor(user, ownerId, employees);
  await ensureUserSettings(prisma, ownerId);

  return {
    ownerId,
    performerId: ownerId,
    projectId,
    employeeIds,
    employeeCatalogOwnerId: ownerId,
    onBehalfOfId: await onBehalfOfIdForActor(user.id, ownerId, projectId),
  };
}

async function resolveCreateContext(user: CurrentUser, data: RecurringTaskPayload) {
  const projectId = await activeProjectIdForSubmitted(user, data.projectId);

  if (data.employeeIds.length === 0) {
    if (!hasPermission(user, "task.create") || !(await canUseProjectForOwnCreate(user, projectId))) {
      redirect("/dashboard");
    }
    return resolveDefaultOwnerAssignment(user, user.id, projectId);
  }

  return resolveSelectedEmployeeAssignment(user, projectId, data.employeeIds, { requireCreatePermission: true });
}

async function resolveUpdateContext(
  user: CurrentUser,
  previous: { ownerId: string; projectId: string },
  data: RecurringTaskPayload,
) {
  const projectId =
    (hasPermission(user, "task.view.all") || hasPermission(user, "project.manage")) && data.projectId
      ? await activeProjectIdForSubmitted(user, data.projectId)
      : previous.projectId;

  if (data.employeeIds.length === 0) {
    return resolveDefaultOwnerAssignment(user, previous.ownerId, projectId);
  }

  return resolveSelectedEmployeeAssignment(user, projectId, data.employeeIds, { requireCreatePermission: false });
}

async function canEditRecurringTask(
  user: CurrentUser,
  template: { createdById: string; ownerId: string; onBehalfOfId: string | null; projectId: string },
) {
  if (hasPermission(user, "task.view.all")) return true;
  if (!hasPermission(user, "task.update") && !template.onBehalfOfId) return false;
  if (template.createdById === user.id || template.ownerId === user.id) return true;
  if (template.onBehalfOfId && (await canActAsDelegatedManager(user.id, template.onBehalfOfId, template.projectId))) return true;
  return false;
}

function recurringData(data: RecurringTaskPayload) {
  const repeatWeekdays = normalizeRepeatWeekdays(data.repeatWeekdays);
  return {
    title: data.title,
    description: data.description,
    priority: data.priority,
    repeatEvery: data.repeatEvery,
    repeatUnit: legacyRepeatUnitForPattern(data.repeatPattern),
    repeatPattern: data.repeatPattern,
    repeatWeekdays: repeatWeekdays.length ? repeatWeekdays : Prisma.JsonNull,
    firstOccurrence: optionalDate(data.firstOccurrence) ?? new Date(),
    repeatEndsAt: optionalDate(data.repeatEndsAt),
    repeatNoticeDays: data.repeatNoticeDays,
    durationDays: data.durationDays,
    active: data.active,
  };
}

function revalidateRecurringViews() {
  revalidatePath("/recurring-tasks");
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  revalidatePath("/kanban");
  revalidatePath("/team");
}

export async function createRecurringTaskAction(formData: FormData) {
  const user = await requireActiveUser();
  const data = recurringTaskPayload(formData);
  const assignment = await resolveCreateContext(user, data);

  await prisma.recurringTask.create({
    data: {
      ...recurringData(data),
      projectId: assignment.projectId,
      ownerId: assignment.ownerId,
      performerId: assignment.performerId,
      createdById: user.id,
      updatedById: user.id,
      onBehalfOfId: assignment.onBehalfOfId,
      employees: {
        createMany: {
          data: assignment.employeeIds.map((employeeId) => ({ employeeId })),
          skipDuplicates: true,
        },
      },
    },
  });

  await materializeDueRecurringTasks(user);
  revalidateRecurringViews();
  redirect("/recurring-tasks");
}

export async function updateRecurringTaskAction(formData: FormData) {
  const user = await requireActiveUser();
  const data = recurringTaskPayload(formData);
  const recurringTaskId = idSchema.parse(data.id);
  const previous = await prisma.recurringTask.findUnique({
    where: { id: recurringTaskId },
    select: {
      id: true,
      ownerId: true,
      createdById: true,
      onBehalfOfId: true,
      projectId: true,
    },
  });
  if (!previous || !(await canEditRecurringTask(user, previous))) redirect("/dashboard");

  const assignment = await resolveUpdateContext(user, previous, data);
  await prisma.$transaction([
    prisma.recurringTaskEmployee.deleteMany({ where: { recurringTaskId } }),
    prisma.recurringTask.update({
      where: { id: recurringTaskId },
      data: {
        ...recurringData(data),
        projectId: assignment.projectId,
        ownerId: assignment.ownerId,
        performerId: assignment.performerId,
        updatedById: user.id,
        onBehalfOfId: assignment.onBehalfOfId,
        employees: {
          createMany: {
            data: assignment.employeeIds.map((employeeId) => ({ employeeId })),
            skipDuplicates: true,
          },
        },
      },
    }),
  ]);

  await materializeDueRecurringTasks(user);
  revalidateRecurringViews();
}

export async function toggleRecurringTaskActiveAction(formData: FormData) {
  const user = await requireActiveUser();
  const id = idSchema.parse(formData.get("id"));
  const active = formBoolean(formData, "active");
  const template = await prisma.recurringTask.findUnique({
    where: { id },
    select: {
      id: true,
      ownerId: true,
      createdById: true,
      onBehalfOfId: true,
      projectId: true,
      archivedAt: true,
    },
  });
  if (!template || template.archivedAt || !(await canEditRecurringTask(user, template))) redirect("/dashboard");

  await prisma.recurringTask.update({
    where: { id },
    data: {
      active,
      updatedById: user.id,
    },
  });

  if (active) await materializeDueRecurringTasks(user);
  revalidateRecurringViews();
}

export async function archiveRecurringTaskAction(formData: FormData) {
  const user = await requireActiveUser();
  const id = idSchema.parse(formData.get("id"));
  const template = await prisma.recurringTask.findUnique({
    where: { id },
    select: {
      id: true,
      ownerId: true,
      createdById: true,
      onBehalfOfId: true,
      projectId: true,
    },
  });
  if (!template || !(await canEditRecurringTask(user, template))) redirect("/dashboard");

  await prisma.recurringTask.update({
    where: { id },
    data: {
      active: false,
      archivedAt: new Date(),
      updatedById: user.id,
    },
  });

  revalidateRecurringViews();
}
