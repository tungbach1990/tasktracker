"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";

import {
  finalizeApprovalIfComplete,
  firstOpenStatusId,
  getCurrentApprovalForReviewer,
  getManagerChain,
  startCompletionApproval,
  startRegistrationApproval,
} from "@/lib/approvals";
import {
  canActAsDelegatedManager,
  canDeleteTask,
  canEditTask,
  canUpdateTaskExecution,
  canViewTask,
  hasPermission,
  requireActiveUser,
  type CurrentUser,
} from "@/lib/authz";
import { dateKey, parseDueHistory } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { legacyRepeatUnitForPattern, normalizeRepeatWeekdays } from "@/lib/recurrence-utils";
import { ensureSelfEmployee, ensureUserSettings } from "@/lib/settings";
import { childTaskFormSchema, formArray, formBoolean, idSchema, optionalDate, taskFormSchema } from "@/lib/validation";

function taskPayload(formData: FormData) {
  return taskFormSchema.parse({
    title: formData.get("title"),
    description: formData.get("description") || "",
    result: formData.get("result") || "",
    feedback: formData.get("feedback") || "",
    kind: formData.get("kind") || "assigned",
    parentId: "",
    projectId: formData.get("projectId"),
    statusId: formData.get("statusId"),
    priority: formData.get("priority"),
    startDate: formData.get("startDate") || "",
    dueDate: formData.get("dueDate") || "",
    sortOrder: formData.get("sortOrder") || 100,
    repeats: formBoolean(formData, "repeats"),
    repeatEvery: formData.get("repeatEvery") || 1,
    repeatUnit: formData.get("repeatUnit") || "day",
    repeatPattern: formData.get("repeatPattern") || "daily",
    repeatWeekdays: formArray(formData, "repeatWeekdays"),
    repeatEndsAt: formData.get("repeatEndsAt") || "",
    repeatNoticeDays: formData.get("repeatNoticeDays") || 7,
    occurrence: formData.get("occurrence") || "",
    employeeIds: formArray(formData, "employeeIds"),
  });
}

function childTaskPayload(formData: FormData) {
  return childTaskFormSchema.parse({
    title: formData.get("title"),
    description: formData.get("description") || "",
    result: formData.get("result") || "",
    feedback: formData.get("feedback") || "",
    parentId: formData.get("parentId"),
    statusId: formData.get("statusId"),
    priority: formData.get("priority"),
    startDate: formData.get("startDate") || "",
    dueDate: formData.get("dueDate") || "",
    sortOrder: formData.get("sortOrder") || 100,
    employeeIds: formArray(formData, "employeeIds"),
  });
}

type TaskPayload = ReturnType<typeof taskPayload>;

function taskOwnerId(task: { ownerId?: string | null; createdById: string }) {
  return task.ownerId ?? task.createdById;
}

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

function projectIdForUpdate(user: CurrentUser, submittedProjectId: string, previousProjectId: string) {
  return (hasPermission(user, "task.view.all") || hasPermission(user, "project.manage")) && submittedProjectId
    ? submittedProjectId
    : previousProjectId;
}

async function employeeIdsForOwner(ownerId: string, submittedEmployeeIds: string[], projectId?: string) {
  if (submittedEmployeeIds.length > 0) return submittedEmployeeIds;
  const selfEmployee = await ensureSelfEmployee(prisma, ownerId);
  if (projectId) await ensureEmployeeProject(selfEmployee.id, projectId);
  return [selfEmployee.id];
}

async function activeProjectIdForSubmitted(user: CurrentUser, submittedProjectId: string) {
  const projectId = submittedProjectId || (await currentProjectIdForUser(user.id));
  const project = await prisma.project.findFirst({
    where: { id: projectId, active: true },
    select: { id: true },
  });
  if (!project) redirect("/tasks");
  return project.id;
}

async function ensureEmployeeProject(employeeId: string, projectId: string) {
  await prisma.employeeProject.upsert({
    where: { employeeId_projectId: { employeeId, projectId } },
    update: {},
    create: { employeeId, projectId },
  });
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

async function assertEmployeesAssignableByActor(
  user: CurrentUser,
  ownerId: string,
  employees: Array<{ id: string; key: string; linkedUserId: string | null }>,
) {
  if (hasPermission(user, "task.view.all") || hasPermission(user, "team.manage.all")) return;

  const managerChain = await getManagerChain(user.id);
  const managerIds = new Set(managerChain.map((manager) => manager.id));
  const hasForbiddenManager = employees.some((employee) => employee.linkedUserId && managerIds.has(employee.linkedUserId));
  const hasDelegatedManagerSelf =
    ownerId !== user.id &&
    employees.some((employee) => employee.key === "self" && employee.linkedUserId === ownerId);

  if (hasForbiddenManager || hasDelegatedManagerSelf) redirect("/tasks");
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
    redirect("/tasks");
  }

  return { uniqueEmployeeIds, employees };
}

async function resolveSelectedEmployeeAssignment(
  user: CurrentUser,
  projectId: string,
  submittedEmployeeIds: string[],
  options: { requireCreatePermission?: boolean } = {},
) {
  const { uniqueEmployeeIds, employees } = await selectedEmployeesForProject(submittedEmployeeIds, projectId);
  if (
    employees.some((employee) => employee.linkStatus !== "confirmed" || !employee.linkedUserId)
  ) {
    redirect("/tasks");
  }

  const employeeCatalogOwnerIds = Array.from(new Set(employees.map((employee) => employee.ownerId)));
  if (employeeCatalogOwnerIds.length !== 1) redirect("/tasks");
  const employeeCatalogOwnerId = employeeCatalogOwnerIds[0];

  const linkedUserIds = Array.from(
    new Set(employees.map((employee) => employee.linkedUserId).filter((id): id is string => Boolean(id))),
  );
  if (linkedUserIds.length !== 1) redirect("/tasks");
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
  } else if (
    !hasGlobalAssignmentPermission &&
    !delegatedForCatalogOwner
  ) {
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

async function resolveDefaultOwnerAssignment(user: CurrentUser, ownerId: string, projectId: string) {
  const employeeIds = await employeeIdsForOwner(ownerId, [], projectId);
  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds }, ownerId, active: true },
    select: { id: true, key: true, linkedUserId: true },
  });
  if (employees.length !== employeeIds.length) redirect("/tasks");
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

async function resolveCreateContext(user: CurrentUser, data: TaskPayload) {
  const projectId = await activeProjectIdForSubmitted(user, data.projectId);

  if (data.employeeIds.length === 0) {
    if (!hasPermission(user, "task.create") || !(await canUseProjectForOwnCreate(user, projectId))) {
      redirect("/dashboard");
    }
    return resolveDefaultOwnerAssignment(user, user.id, projectId);
  }

  return resolveSelectedEmployeeAssignment(user, projectId, data.employeeIds, { requireCreatePermission: true });
}

async function validateUserSettingsSelection(
  userId: string,
  data: { statusId: string },
  projectId: string,
  employeeIds: string[],
  options: { requireActiveProject?: boolean; employeeCatalogOwnerId?: string } = {},
) {
  await ensureUserSettings(prisma, userId);
  const requireActiveProject = options.requireActiveProject ?? true;
  const employeeCatalogOwnerId = options.employeeCatalogOwnerId ?? userId;
  const [project, status, employeeCount] = await Promise.all([
    prisma.project.findFirst({
      where: {
        id: projectId,
        active: requireActiveProject ? true : undefined,
      },
    }),
    prisma.taskStatusOption.findFirst({ where: { id: data.statusId, ownerId: userId, active: true } }),
    employeeIds.length
      ? prisma.employee.count({
          where: {
            id: { in: employeeIds },
            ownerId: employeeCatalogOwnerId,
            active: true,
            projects: { some: { projectId } },
          },
        })
      : Promise.resolve(0),
  ]);

  if (!project || !status || employeeCount !== employeeIds.length) {
    redirect("/tasks");
  }

  return { project, status };
}

async function assertTaskCanUseDoneStatus(taskId: string, done: boolean) {
  if (!done) return;

  const incompleteChildren = await prisma.task.count({
    where: {
      parentId: taskId,
      deletedAt: null,
      workflowStatus: { not: "final_done" },
    },
  });
  if (incompleteChildren > 0) redirect(`/tasks/${taskId}`);
}

async function assertTaskDueAllowsChildren(taskId: string, dueDate: Date | null) {
  if (!dueDate) return;

  const latestChild = await prisma.task.findFirst({
    where: {
      parentId: taskId,
      deletedAt: null,
      dueDate: { not: null },
    },
    orderBy: { dueDate: "desc" },
    select: { dueDate: true },
  });

  if (latestChild?.dueDate && latestChild.dueDate > dueDate) redirect(`/tasks/${taskId}`);
}

async function firstStatusByDone(ownerId: string, done: boolean) {
  return prisma.taskStatusOption.findFirst({
    where: { ownerId, active: true, done },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { id: true },
  });
}

async function cancelPendingCompletionApprovals(taskId: string, note: string) {
  await prisma.taskApproval.updateMany({
    where: { taskId, type: "completion", status: "pending" },
    data: {
      status: "rejected",
      note,
      actedAt: new Date(),
    },
  });
}

async function taskHasChildren(taskId: string) {
  return (await prisma.task.count({ where: { parentId: taskId, deletedAt: null } })) > 0;
}

async function submitTaskForCompletion(taskId: string, actorId: string, requestedDoneStatusId?: string) {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { status: true },
  });

  if (task.workflowStatus === "pending_registration") return;
  if (task.workflowStatus === "pending_completion" || task.workflowStatus === "final_done") return;
  if (task.workflowStatus !== "active") return;

  const ownerId = taskOwnerId(task);
  const onBehalfOfId = await onBehalfOfIdForActor(actorId, ownerId, task.projectId);
  const doneStatusId = requestedDoneStatusId || (task.status.done ? task.statusId : (await firstStatusByDone(ownerId, true))?.id);
  if (!doneStatusId) redirect(`/tasks/${taskId}`);
  await assertTaskCanUseDoneStatus(taskId, true);

  if (!(await taskHasChildren(task.id))) {
    await prisma.task.update({
      where: { id: task.id },
      data: {
        statusId: doneStatusId,
        workflowStatus: "final_done",
        completedAt: task.completedAt ?? new Date(),
        updatedById: actorId,
        history: {
          create: {
            action: "completed_leaf_task",
            userId: actorId,
            onBehalfOfId,
            before: { statusId: task.statusId, workflowStatus: task.workflowStatus },
            after: { statusId: doneStatusId, workflowStatus: "final_done" },
          },
        },
      },
    });
    return;
  }

  await startCompletionApproval(
    {
      id: task.id,
      statusId: task.statusId,
      createdById: task.createdById,
      performerId: task.performerId,
      workflowStatus: task.workflowStatus,
    },
    actorId,
    doneStatusId,
    task.projectId,
    onBehalfOfId,
  );
}

async function syncParentCompletion(parentId: string | null | undefined, actorId: string) {
  if (!parentId) return;

  const parent = await prisma.task.findUnique({
    where: { id: parentId },
    include: {
      status: true,
      project: { select: { id: true } },
      children: { where: { deletedAt: null }, select: { id: true, workflowStatus: true } },
    },
  });
  if (!parent || parent.children.length === 0) return;

  const allChildrenDone = parent.children.every((child) => child.workflowStatus === "final_done");
  const hasOpenChild = parent.children.some((child) => child.workflowStatus !== "final_done");

  if (allChildrenDone && !parent.status.done) {
    const doneStatus = await firstStatusByDone(taskOwnerId(parent), true);
    if (doneStatus) {
      await submitTaskForCompletion(parent.id, actorId, doneStatus.id);
    }
  }

  if (
    hasOpenChild &&
    (parent.status.done || parent.workflowStatus === "pending_completion" || parent.workflowStatus === "final_done")
  ) {
    const openStatus = await firstStatusByDone(taskOwnerId(parent), false);
    if (!openStatus) return;
    const onBehalfOfId = await onBehalfOfIdForActor(actorId, taskOwnerId(parent), parent.project.id);

    await cancelPendingCompletionApprovals(parent.id, "Hủy duyệt hoàn thành vì nhiệm vụ con đã mở lại");
    await prisma.task.update({
      where: { id: parent.id },
      data: {
        statusId: openStatus.id,
        workflowStatus: "active",
        completedAt: null,
        updatedById: actorId,
        history: {
          create: {
            action: "auto_reopened_from_child",
            userId: actorId,
            onBehalfOfId,
            before: { statusId: parent.statusId, workflowStatus: parent.workflowStatus },
            after: { statusId: openStatus.id, workflowStatus: "active" },
          },
        },
      },
    });
  }

  await syncParentCompletion(parent.parentId, actorId);
}

function buildDueHistory(previousDue: Date | null | undefined, nextDue: Date | null | undefined, previousHistory: unknown) {
  const previous = dateKey(previousDue);
  const next = dateKey(nextDue);
  if (!previous || previous === next) return previousHistory ?? undefined;

  const history = parseDueHistory(previousHistory);
  if (history[history.length - 1] !== previous) {
    history.push(previous);
  }

  return history;
}

function recurrencePayload(data: TaskPayload, existingSeriesId?: string | null) {
  if (!data.repeats) {
    return {
      repeats: false,
      repeatEvery: 1,
      repeatUnit: "day" as const,
      repeatPattern: "daily" as const,
      repeatWeekdays: Prisma.JsonNull,
      repeatEndsAt: null,
      repeatNoticeDays: 7,
      seriesId: null,
      occurrence: null,
    };
  }

  const repeatWeekdays = normalizeRepeatWeekdays(data.repeatWeekdays);
  return {
    repeats: true,
    repeatEvery: data.repeatEvery,
    repeatUnit: legacyRepeatUnitForPattern(data.repeatPattern),
    repeatPattern: data.repeatPattern,
    repeatWeekdays: repeatWeekdays.length ? repeatWeekdays : Prisma.JsonNull,
    repeatEndsAt: optionalDate(data.repeatEndsAt),
    repeatNoticeDays: data.repeatNoticeDays,
    seriesId: existingSeriesId || crypto.randomUUID(),
    occurrence: optionalDate(data.occurrence) ?? optionalDate(data.startDate) ?? optionalDate(data.dueDate) ?? new Date(),
  };
}

async function defaultOpenStatusId(ownerId: string) {
  const status = await firstStatusByDone(ownerId, false);
  if (!status) redirect("/settings/statuses");
  return status.id;
}

async function onBehalfOfIdForActor(actorId: string, ownerId: string, projectId: string) {
  if (actorId === ownerId) return null;
  return (await canActAsDelegatedManager(actorId, ownerId, projectId)) ? ownerId : null;
}

function revalidateTaskViews(taskId: string, parentId?: string | null) {
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  revalidatePath("/kanban");
  revalidatePath("/team");
  revalidatePath("/approvals");
  revalidatePath(`/tasks/${taskId}`);
  if (parentId) revalidatePath(`/tasks/${parentId}`);
}

export async function createTaskAction(formData: FormData) {
  const user = await requireActiveUser();
  const data = taskPayload(formData);
  const { ownerId, performerId, projectId, employeeIds, employeeCatalogOwnerId, onBehalfOfId } =
    await resolveCreateContext(user, data);
  const { status } = await validateUserSettingsSelection(ownerId, data, projectId, employeeIds, {
    employeeCatalogOwnerId,
  });
  const createStatusId =
    data.kind === "self_registered" && status.done
      ? await defaultOpenStatusId(ownerId)
      : data.statusId;

  const task = await prisma.task.create({
    data: {
      title: data.title,
      description: data.description,
      result: data.result,
      feedback: data.feedback,
      taskType: "big",
      kind: data.kind,
      workflowStatus: data.kind === "self_registered" ? "pending_registration" : "active",
      parentId: null,
      projectId,
      statusId: createStatusId,
      priority: data.priority,
      startDate: optionalDate(data.startDate),
      dueDate: optionalDate(data.dueDate),
      sortOrder: data.sortOrder,
      ...recurrencePayload(data),
      completedAt: null,
      performerId,
      ownerId,
      createdById: user.id,
      updatedById: user.id,
      employees: {
        createMany: {
          data: employeeIds.map((employeeId) => ({ employeeId })),
          skipDuplicates: true,
        },
      },
      history: {
        create: {
          action: "created",
          userId: user.id,
          onBehalfOfId,
          after: {
            title: data.title,
            statusId: createStatusId,
            priority: data.priority,
            kind: data.kind,
            performerId,
            ownerId,
            repeats: data.repeats,
            repeatPattern: data.repeatPattern,
            repeatWeekdays: data.repeatWeekdays,
            repeatEndsAt: data.repeatEndsAt,
            repeatNoticeDays: data.repeatNoticeDays,
            employeeIds,
          },
        },
      },
    },
  });

  if (data.kind === "self_registered") {
    await startRegistrationApproval(task.id, performerId, projectId, user.id, onBehalfOfId);
  } else if (status.done) {
    await submitTaskForCompletion(task.id, user.id, createStatusId);
  }

  revalidateTaskViews(task.id);
  redirect(`/tasks/${task.id}`);
}

export async function createChildTaskAction(formData: FormData) {
  const user = await requireActiveUser();

  const data = childTaskPayload(formData);
  const allowed = await canViewTask(user, data.parentId);
  if (!allowed) redirect("/dashboard");

  const parent = await prisma.task.findUniqueOrThrow({
    where: { id: data.parentId },
    include: {
      employees: true,
    },
  });
  const ownerId = taskOwnerId(parent);
  const onBehalfOfId = await onBehalfOfIdForActor(user.id, ownerId, parent.projectId);
  if (!hasPermission(user, "task.create") && !onBehalfOfId) redirect("/dashboard");
  if (ownerId !== user.id && !hasPermission(user, "task.view.all") && !onBehalfOfId) redirect(`/tasks/${parent.id}`);

  const dueDate = optionalDate(data.dueDate);
  if (dueDate && parent.dueDate && dueDate > parent.dueDate) redirect(`/tasks/${parent.id}`);

  const assignment =
    data.employeeIds.length > 0
      ? await resolveSelectedEmployeeAssignment(user, parent.projectId, data.employeeIds, {
          requireCreatePermission: true,
        })
      : await resolveDefaultOwnerAssignment(user, ownerId, parent.projectId);
  const { status } = await validateUserSettingsSelection(assignment.ownerId, data, parent.projectId, assignment.employeeIds, {
    requireActiveProject: false,
    employeeCatalogOwnerId: assignment.employeeCatalogOwnerId,
  });

  const child = await prisma.task.create({
    data: {
      title: data.title,
      description: data.description,
      result: data.result,
      feedback: data.feedback,
      taskType: "small",
      kind: parent.kind,
      workflowStatus: "active",
      parentId: parent.id,
      projectId: parent.projectId,
      statusId: data.statusId,
      priority: data.priority,
      startDate: optionalDate(data.startDate),
      dueDate,
      dueHistory: [],
      sortOrder: data.sortOrder,
      repeats: false,
      repeatEvery: 1,
      repeatUnit: "day",
      repeatPattern: "daily",
      repeatWeekdays: Prisma.JsonNull,
      repeatEndsAt: null,
      repeatNoticeDays: 7,
      seriesId: null,
      occurrence: null,
      completedAt: null,
      performerId: assignment.performerId,
      ownerId: assignment.ownerId,
      createdById: user.id,
      updatedById: user.id,
      employees: {
        createMany: {
          data: assignment.employeeIds.map((employeeId) => ({ employeeId })),
          skipDuplicates: true,
        },
      },
      history: {
        create: {
          action: "child_created",
          userId: user.id,
          onBehalfOfId: assignment.onBehalfOfId,
          after: {
            parentId: parent.id,
            title: data.title,
            statusId: data.statusId,
            priority: data.priority,
            performerId: assignment.performerId,
            ownerId: assignment.ownerId,
            employeeIds: assignment.employeeIds,
          },
        },
      },
    },
  });

  if (status.done) {
    await submitTaskForCompletion(child.id, user.id, data.statusId);
  }
  await syncParentCompletion(parent.id, user.id);

  revalidateTaskViews(child.id, parent.id);
}

export async function updateTaskAction(formData: FormData) {
  const user = await requireActiveUser();

  const taskId = idSchema.parse(formData.get("id"));
  const allowed = await canEditTask(user, taskId);
  if (!allowed) redirect("/dashboard");

  const previous = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      employees: true,
      parent: { select: { id: true, dueDate: true } },
      status: true,
    },
  });
  const data = taskPayload(formData);
  const settingsOwnerId = taskOwnerId(previous);
  const projectId = projectIdForUpdate(user, data.projectId, previous.projectId);
  const assignment =
    data.employeeIds.length > 0
      ? await resolveSelectedEmployeeAssignment(user, projectId, data.employeeIds, {
          requireCreatePermission: false,
        })
      : await resolveDefaultOwnerAssignment(user, settingsOwnerId, projectId);
  const { status } = await validateUserSettingsSelection(assignment.ownerId, data, projectId, assignment.employeeIds, {
    requireActiveProject: projectId !== previous.projectId,
    employeeCatalogOwnerId: assignment.employeeCatalogOwnerId,
  });
  await assertTaskCanUseDoneStatus(taskId, status.done);
  const nextDueDate = optionalDate(data.dueDate);
  if (nextDueDate && previous.parent?.dueDate && nextDueDate > previous.parent.dueDate) {
    redirect(`/tasks/${previous.parent.id}`);
  }
  await assertTaskDueAllowsChildren(taskId, nextDueDate);
  const dueHistory = buildDueHistory(previous.dueDate, nextDueDate, previous.dueHistory);

  await prisma.$transaction([
    prisma.taskEmployee.deleteMany({ where: { taskId } }),
    prisma.task.update({
      where: { id: taskId },
      data: {
        title: data.title,
        description: data.description,
        result: data.result,
        feedback: data.feedback,
        kind: data.kind,
        projectId,
        statusId: status.done ? previous.statusId : data.statusId,
        workflowStatus: status.done
          ? previous.workflowStatus
          : previous.workflowStatus === "pending_registration" || previous.workflowStatus === "registration_rejected"
            ? previous.workflowStatus
            : "active",
        priority: data.priority,
        startDate: optionalDate(data.startDate),
        dueDate: nextDueDate,
        dueHistory,
        sortOrder: data.sortOrder,
        ...recurrencePayload(data, previous.seriesId),
        completedAt: status.done && previous.workflowStatus === "final_done" ? previous.completedAt : null,
        performerId: assignment.performerId,
        ownerId: assignment.ownerId,
        updatedById: user.id,
        employees: {
          createMany: {
            data: assignment.employeeIds.map((employeeId) => ({ employeeId })),
            skipDuplicates: true,
          },
        },
      },
    }),
    prisma.taskHistory.create({
      data: {
        taskId,
        userId: user.id,
        onBehalfOfId: assignment.onBehalfOfId,
        action: "updated",
        before: {
          title: previous.title,
          kind: previous.kind,
          performerId: previous.performerId,
          ownerId: settingsOwnerId,
          parentId: previous.parentId,
          projectId: previous.projectId,
          statusId: previous.statusId,
          priority: previous.priority,
          dueDate: dateKey(previous.dueDate),
          repeats: previous.repeats,
          repeatEvery: previous.repeatEvery,
          repeatUnit: previous.repeatUnit,
          repeatPattern: previous.repeatPattern,
          repeatWeekdays: previous.repeatWeekdays,
          repeatEndsAt: dateKey(previous.repeatEndsAt),
          repeatNoticeDays: previous.repeatNoticeDays,
          occurrence: dateKey(previous.occurrence),
          employeeIds: previous.employees.map((employee) => employee.employeeId),
        },
        after: {
          title: data.title,
          kind: data.kind,
          performerId: assignment.performerId,
          ownerId: assignment.ownerId,
          parentId: previous.parentId,
          projectId,
          statusId: data.statusId,
          priority: data.priority,
          dueDate: dateKey(nextDueDate),
          repeats: data.repeats,
          repeatEvery: data.repeatEvery,
          repeatUnit: legacyRepeatUnitForPattern(data.repeatPattern),
          repeatPattern: data.repeatPattern,
          repeatWeekdays: data.repeatWeekdays,
          repeatEndsAt: data.repeatEndsAt,
          repeatNoticeDays: data.repeatNoticeDays,
          occurrence: data.repeats ? data.occurrence : "",
          employeeIds: assignment.employeeIds,
        },
      },
    }),
  ]);

  if (status.done) {
    await submitTaskForCompletion(taskId, user.id, data.statusId);
  }
  await syncParentCompletion(previous.parentId, user.id);

  revalidateTaskViews(taskId, previous.parentId);
}

export async function changeTaskStatusAction(formData: FormData) {
  const user = await requireActiveUser();

  const taskId = idSchema.parse(formData.get("id"));
  const statusId = idSchema.parse(formData.get("statusId"));
  const allowed = await canUpdateTaskExecution(user, taskId);
  if (!allowed) redirect("/dashboard");

  const previous = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  const ownerId = taskOwnerId(previous);
  const onBehalfOfId = await onBehalfOfIdForActor(user.id, ownerId, previous.projectId);
  const status = await prisma.taskStatusOption.findFirst({
    where: { id: statusId, ownerId, active: true },
  });
  if (!status) redirect("/tasks");
  if (previous.workflowStatus !== "active" && previous.workflowStatus !== "pending_completion") {
    revalidateTaskViews(taskId, previous.parentId);
    return;
  }
  await assertTaskCanUseDoneStatus(taskId, status.done);

  if (status.done) {
    await submitTaskForCompletion(taskId, user.id, statusId);
    await syncParentCompletion(previous.parentId, user.id);
    revalidateTaskViews(taskId, previous.parentId);
    return;
  }

  if (previous.workflowStatus === "pending_completion") {
    await cancelPendingCompletionApprovals(taskId, "Hủy duyệt hoàn thành vì nhiệm vụ đã chuyển về trạng thái mở");
  }

  await prisma.task.update({
    where: { id: taskId },
    data: {
      statusId,
      workflowStatus: "active",
      completedAt: null,
      updatedById: user.id,
      history: {
        create: {
          action: "status_changed",
          userId: user.id,
          onBehalfOfId,
          before: { statusId: previous.statusId },
          after: { statusId },
        },
      },
    },
  });
  await syncParentCompletion(previous.parentId, user.id);

  revalidateTaskViews(taskId, previous.parentId);
}

export async function moveTaskToKanbanColumnAction(formData: FormData) {
  const user = await requireActiveUser();

  const taskId = idSchema.parse(formData.get("id"));
  const columnKey = String(formData.get("columnKey") || "");
  const statusKey = columnKey.startsWith("status:") ? columnKey.slice("status:".length) : "";
  if (!statusKey) return;

  const allowed = await canUpdateTaskExecution(user, taskId);
  if (!allowed) redirect("/dashboard");

  const previous = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  const ownerId = taskOwnerId(previous);
  const onBehalfOfId = await onBehalfOfIdForActor(user.id, ownerId, previous.projectId);
  const status = await prisma.taskStatusOption.findFirst({
    where: { ownerId, key: statusKey, active: true },
  });
  if (!status) {
    revalidateTaskViews(taskId, previous.parentId);
    return;
  }
  if (previous.workflowStatus !== "active" && previous.workflowStatus !== "pending_completion") {
    revalidateTaskViews(taskId, previous.parentId);
    return;
  }
  await assertTaskCanUseDoneStatus(taskId, status.done);

  if (status.done) {
    await submitTaskForCompletion(taskId, user.id, status.id);
    await syncParentCompletion(previous.parentId, user.id);
    revalidateTaskViews(taskId, previous.parentId);
    return;
  }

  if (previous.workflowStatus === "pending_completion") {
    await cancelPendingCompletionApprovals(taskId, "Hủy duyệt hoàn thành vì nhiệm vụ đã kéo về cột mở");
  }

  await prisma.task.update({
    where: { id: taskId },
    data: {
      statusId: status.id,
      workflowStatus: "active",
      completedAt: null,
      updatedById: user.id,
      history: {
        create: {
          action: "kanban_moved",
          userId: user.id,
          onBehalfOfId,
          before: { statusId: previous.statusId, workflowStatus: previous.workflowStatus },
          after: { statusId: status.id, statusKey, workflowStatus: "active" },
        },
      },
    },
  });
  await syncParentCompletion(previous.parentId, user.id);

  revalidateTaskViews(taskId, previous.parentId);
}

export async function markTaskDoneAction(formData: FormData) {
  const user = await requireActiveUser();

  const taskId = idSchema.parse(formData.get("id"));
  const allowed = await canUpdateTaskExecution(user, taskId);
  if (!allowed) redirect("/dashboard");

  const previous = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { status: true },
  });
  if (previous.workflowStatus === "pending_completion" || previous.workflowStatus === "final_done") {
    revalidateTaskViews(taskId, previous.parentId);
    return;
  }
  if (previous.workflowStatus !== "active") {
    revalidateTaskViews(taskId, previous.parentId);
    return;
  }

  const doneStatus = await firstStatusByDone(taskOwnerId(previous), true);
  if (!doneStatus) redirect(`/tasks/${taskId}`);
  await assertTaskCanUseDoneStatus(taskId, true);

  await submitTaskForCompletion(taskId, user.id, doneStatus.id);
  await syncParentCompletion(previous.parentId, user.id);

  revalidateTaskViews(taskId, previous.parentId);
}

export async function reopenTaskAction(formData: FormData) {
  const user = await requireActiveUser();

  const taskId = idSchema.parse(formData.get("id"));
  const allowed = await canUpdateTaskExecution(user, taskId);
  if (!allowed) redirect("/dashboard");

  const previous = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { status: true },
  });

  if (
    !previous.status.done &&
    previous.workflowStatus !== "pending_completion" &&
    previous.workflowStatus !== "final_done" &&
    previous.workflowStatus !== "completion_rejected"
  ) {
    revalidateTaskViews(taskId, previous.parentId);
    return;
  }

  const openStatus = await firstStatusByDone(taskOwnerId(previous), false);
  if (!openStatus) redirect(`/tasks/${taskId}`);
  const onBehalfOfId = await onBehalfOfIdForActor(user.id, taskOwnerId(previous), previous.projectId);

  await prisma.$transaction([
    prisma.taskApproval.updateMany({
      where: { taskId, type: "completion", status: "pending" },
      data: {
        status: "rejected",
        note: "Hủy duyệt vì nhiệm vụ được mở lại",
        actedAt: new Date(),
      },
    }),
    prisma.task.update({
      where: { id: taskId },
      data: {
        statusId: openStatus.id,
        workflowStatus: "active",
        completedAt: null,
        updatedById: user.id,
        history: {
          create: {
            action: "reopened",
            userId: user.id,
            onBehalfOfId,
            before: {
              statusId: previous.statusId,
              workflowStatus: previous.workflowStatus,
              completedAt: dateKey(previous.completedAt),
            },
            after: { statusId: openStatus.id, workflowStatus: "active", completedAt: null },
          },
        },
      },
    }),
  ]);
  await syncParentCompletion(previous.parentId, user.id);

  revalidateTaskViews(taskId, previous.parentId);
}

export async function approveTaskApprovalAction(formData: FormData) {
  const user = await requireActiveUser();
  const approvalId = idSchema.parse(formData.get("approvalId"));
  const approval = await getCurrentApprovalForReviewer(approvalId, user.id);
  if (!approval) redirect("/dashboard");
  const submittedNote = String(formData.get("note") || "").trim();
  const actorLabel = user.displayName || user.username;

  const [, ownUpdate] = await prisma.$transaction([
    prisma.taskApproval.updateMany({
      where: {
        taskId: approval.taskId,
        type: approval.type,
        round: approval.round,
        level: { lt: approval.level },
        status: "pending",
      },
      data: {
        status: "approved",
        note: `Tự động duyệt bởi cấp cao hơn ${actorLabel} tại cấp ${approval.level}`,
        actedAt: new Date(),
      },
    }),
    prisma.taskApproval.updateMany({
      where: { id: approval.id, status: "pending" },
      data: {
        status: "approved",
        note: submittedNote,
        actedAt: new Date(),
      },
    }),
  ]);
  if (ownUpdate.count !== 1) redirect("/dashboard");

  const onBehalfOfId = approval.delegatedForId ?? null;
  const finalized = await finalizeApprovalIfComplete(approval, user.id, onBehalfOfId);
  if (finalized && approval.type === "completion") {
    await syncParentCompletion(approval.task.parentId, user.id);
  }

  revalidateTaskViews(approval.taskId, approval.task.parentId);
}

export async function rejectTaskApprovalAction(formData: FormData) {
  const user = await requireActiveUser();
  const approvalId = idSchema.parse(formData.get("approvalId"));
  const note = String(formData.get("note") || "").trim();
  const approval = await getCurrentApprovalForReviewer(approvalId, user.id);
  if (!approval) redirect("/dashboard");
  if (!note) redirect(`/tasks/${approval.taskId}`);
  const onBehalfOfId = approval.delegatedForId ?? null;
  const rejectionNote =
    approval.reviewerId === user.id
      ? note
      : `Bị từ chối bởi cấp cao hơn ${user.displayName || user.username}: ${note}`;

  const ownUpdate = await prisma.taskApproval.updateMany({
    where: { id: approval.id, status: "pending" },
    data: {
      status: "rejected",
      note: rejectionNote,
      actedAt: new Date(),
    },
  });
  if (ownUpdate.count !== 1) redirect("/dashboard");
  await prisma.taskApproval.updateMany({
    where: {
      taskId: approval.taskId,
      type: approval.type,
      round: approval.round,
      id: { not: approval.id },
      status: "pending",
    },
    data: {
      status: "rejected",
      note: `Hủy sau khi bị từ chối tại cấp ${approval.level}`,
      actedAt: new Date(),
    },
  });

  if (approval.type === "registration") {
    await prisma.task.update({
      where: { id: approval.taskId },
      data: {
        workflowStatus: "registration_rejected",
        updatedById: user.id,
        history: {
          create: {
            action: "registration_rejected",
            userId: user.id,
            onBehalfOfId,
            after: { round: approval.round, level: approval.level, note: rejectionNote },
          },
        },
      },
    });
  } else {
    const openStatusId = await firstOpenStatusId(taskOwnerId(approval.task));
    if (!openStatusId) redirect(`/tasks/${approval.taskId}`);
    await prisma.task.update({
      where: { id: approval.taskId },
      data: {
        statusId: openStatusId,
        workflowStatus: "completion_rejected",
        completedAt: null,
        updatedById: user.id,
        history: {
          create: {
            action: "completion_rejected",
            userId: user.id,
            onBehalfOfId,
            before: { statusId: approval.task.statusId, workflowStatus: approval.task.workflowStatus },
            after: { statusId: openStatusId, workflowStatus: "completion_rejected", round: approval.round, level: approval.level, note: rejectionNote },
          },
        },
      },
    });
    await syncParentCompletion(approval.task.parentId, user.id);
  }

  revalidateTaskViews(approval.taskId, approval.task.parentId);
}

export async function resubmitRegistrationAction(formData: FormData) {
  const user = await requireActiveUser();
  const taskId = idSchema.parse(formData.get("id"));
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: {
      id: true,
      kind: true,
      workflowStatus: true,
      performerId: true,
      ownerId: true,
      createdById: true,
      projectId: true,
      parentId: true,
    },
  });

  const canResubmit =
    task.kind === "self_registered" &&
    task.workflowStatus === "registration_rejected" &&
    (task.performerId === user.id || taskOwnerId(task) === user.id || hasPermission(user, "task.view.all"));
  if (!canResubmit) redirect(`/tasks/${taskId}`);

  await prisma.task.update({
    where: { id: taskId },
    data: {
      workflowStatus: "pending_registration",
      updatedById: user.id,
      history: {
        create: {
          action: "registration_resubmitted",
          userId: user.id,
        },
      },
    },
  });
  await startRegistrationApproval(taskId, task.performerId, task.projectId, user.id);

  revalidateTaskViews(taskId, task.parentId);
}

export async function updateTaskDueAction(formData: FormData) {
  const user = await requireActiveUser();

  const taskId = idSchema.parse(formData.get("id"));
  const dueDate = optionalDate(String(formData.get("dueDate") || ""));
  const allowed = await canEditTask(user, taskId);
  if (!allowed) redirect("/dashboard");

  const previous = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      parent: { select: { id: true, dueDate: true } },
    },
  });
  const onBehalfOfId = await onBehalfOfIdForActor(user.id, taskOwnerId(previous), previous.projectId);

  if (dueDate && previous.parent?.dueDate && dueDate > previous.parent.dueDate) {
    redirect(`/tasks/${previous.parent.id}`);
  }
  await assertTaskDueAllowsChildren(taskId, dueDate);

  const dueHistory = buildDueHistory(previous.dueDate, dueDate, previous.dueHistory);
  await prisma.task.update({
    where: { id: taskId },
    data: {
      dueDate,
      dueHistory,
      updatedById: user.id,
      history: {
        create: {
          action: "due_changed",
          userId: user.id,
          onBehalfOfId,
          before: { dueDate: dateKey(previous.dueDate) },
          after: { dueDate: dateKey(dueDate) },
        },
      },
    },
  });

  revalidateTaskViews(taskId, previous.parentId);
}

export async function deleteTaskAction(formData: FormData) {
  const user = await requireActiveUser();
  if (!hasPermission(user, "task.delete")) redirect("/dashboard");

  const taskId = idSchema.parse(formData.get("id"));
  const allowed = await canDeleteTask(user, taskId);
  if (!allowed) redirect("/dashboard");

  const previous = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { parentId: true, deletedAt: true },
  });

  if (!previous.deletedAt) {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        deletedAt: new Date(),
        updatedById: user.id,
        history: {
          create: {
            action: "moved_to_trash",
            userId: user.id,
          },
        },
      },
    });
  }
  await syncParentCompletion(previous.parentId, user.id);

  revalidateTaskViews(taskId, previous.parentId);
  redirect("/tasks");
}

export async function addCommentAction(formData: FormData) {
  const user = await requireActiveUser();

  const taskId = idSchema.parse(formData.get("id"));
  const body = String(formData.get("body") || "").trim();
  if (!body) return;

  const allowed = await canViewTask(user, taskId);
  if (!allowed) redirect("/dashboard");
  const canUpdate = await canUpdateTaskExecution(user, taskId);
  if (!canUpdate) redirect("/dashboard");
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { ownerId: true, createdById: true, projectId: true },
  });
  const onBehalfOfId = await onBehalfOfIdForActor(user.id, taskOwnerId(task), task.projectId);

  await prisma.taskComment.create({
    data: {
      taskId,
      userId: user.id,
      body,
    },
  });

  await prisma.taskHistory.create({
    data: {
      taskId,
      userId: user.id,
      action: "commented",
      onBehalfOfId,
      after: { body },
    },
  });

  revalidatePath(`/tasks/${taskId}`);
}
