import type {
  Prisma,
  PrismaClient,
  Task,
  TaskApproval,
  TaskApprovalType,
  TaskStatusOption,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { compareOperationalPriority } from "@/lib/task-priority";
import { confirmedTeamStatuses } from "@/lib/team";

type Db = PrismaClient | Prisma.TransactionClient;

type ChainUser = {
  id: string;
  username: string;
  displayName: string;
};

type ApprovalReviewer = {
  reviewer: ChainUser;
  delegatedFor: ChainUser | null;
  status: "pending" | "skipped";
  note: string;
};

export async function getManagerChain(userId: string, db: Db = prisma) {
  const chain: ChainUser[] = [];
  const visited = new Set<string>([userId]);
  let currentUserId = userId;

  while (true) {
    const relation = await db.teamRelation.findFirst({
      where: {
        reportId: currentUserId,
        status: { in: confirmedTeamStatuses },
      },
      include: {
        manager: {
          select: { id: true, username: true, displayName: true },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    if (!relation || visited.has(relation.managerId)) break;
    chain.push(relation.manager);
    visited.add(relation.managerId);
    currentUserId = relation.managerId;
  }

  return chain;
}

async function getActiveAssistantReviewers(managerId: string, projectId: string, db: Db = prisma) {
  const delegations = await db.teamDelegation.findMany({
    where: { managerId, projectId, active: true },
    include: {
      assistant: {
        select: { id: true, username: true, displayName: true },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return delegations.map((delegation) => delegation.assistant);
}

async function hasActiveDelegationInDb(managerId: string, assistantId: string, projectId: string, db: Db = prisma) {
  const delegation = await db.teamDelegation.findFirst({
    where: { managerId, assistantId, projectId, active: true },
    select: { id: true },
  });

  return Boolean(delegation);
}

export async function userHasDbPermission(userId: string, permissionKey: string, db: Db = prisma) {
  const role = await db.userRole.findFirst({
    where: {
      userId,
      role: {
        permissions: {
          some: { permission: { key: permissionKey } },
        },
      },
    },
    select: { roleId: true },
  });

  return Boolean(role);
}

export async function reconcileSkippedDoneApprovalsForUser(userId: string, db: Db = prisma) {
  void userId;
  void db;
  return 0;
}

export async function reconcileSkippedDoneApprovalsForUsersWithPermission(db: Db = prisma) {
  void db;
  return 0;
}

export async function firstOpenStatusId(ownerId: string, db: Db = prisma) {
  const status = await db.taskStatusOption.findFirst({
    where: { ownerId, active: true, done: false },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { id: true },
  });
  return status?.id ?? null;
}

export async function firstDoneStatusId(ownerId: string, db: Db = prisma) {
  const status = await db.taskStatusOption.findFirst({
    where: { ownerId, active: true, done: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { id: true },
  });
  return status?.id ?? null;
}

async function nextRound(taskId: string, type: TaskApprovalType, db: Db) {
  const aggregate = await db.taskApproval.aggregate({
    where: { taskId, type },
    _max: { round: true },
  });
  return (aggregate._max.round ?? 0) + 1;
}

async function buildApprovalReviewers(userId: string, type: TaskApprovalType, projectId: string, db: Db) {
  const chain = await getManagerChain(userId, db);
  const regularReviewerIds = new Set(chain.map((reviewer) => reviewer.id));
  const insertedDelegations = new Set<string>();
  const reviewers: ApprovalReviewer[] = [];

  for (const manager of chain) {
    const managerCanApproveCompletion = type !== "completion" || (await userHasDbPermission(manager.id, "task.done.approve", db));
    const assistants = managerCanApproveCompletion ? await getActiveAssistantReviewers(manager.id, projectId, db) : [];

    for (const assistant of assistants) {
      const key = `${manager.id}:${assistant.id}`;
      if (assistant.id === manager.id || regularReviewerIds.has(assistant.id) || insertedDelegations.has(key)) continue;
      insertedDelegations.add(key);
      reviewers.push({
        reviewer: assistant,
        delegatedFor: manager,
        status: "pending",
        note: "",
      });
    }

    reviewers.push({
      reviewer: manager,
      delegatedFor: null,
      status: managerCanApproveCompletion ? "pending" : "skipped",
      note: managerCanApproveCompletion ? "" : "Skipped: missing task.done.approve",
    });
  }

  return reviewers;
}

export async function startRegistrationApproval(
  taskId: string,
  performerId: string,
  projectId: string,
  actorId: string,
  onBehalfOfId: string | null = null,
  db: Db = prisma,
) {
  const reviewers = await buildApprovalReviewers(performerId, "registration", projectId, db);
  const round = await nextRound(taskId, "registration", db);

  if (reviewers.length === 0) {
    await db.task.update({
      where: { id: taskId },
      data: {
        workflowStatus: "active",
        history: {
          create: {
            action: "registration_auto_approved",
            userId: actorId,
            onBehalfOfId,
            after: { performerId, round },
          },
        },
      },
    });
    return { round, pendingCount: 0 };
  }

  for (const [index, item] of reviewers.entries()) {
    await db.taskApproval.create({
      data: {
        taskId,
        type: "registration",
        round,
        level: index + 1,
        reviewerId: item.reviewer.id,
        delegatedForId: item.delegatedFor?.id ?? null,
      },
    });
  }

  return { round, pendingCount: reviewers.length };
}

export async function startCompletionApproval(
  task: Pick<Task, "id" | "statusId" | "createdById" | "performerId" | "workflowStatus">,
  actorId: string,
  doneStatusId: string,
  projectId: string,
  onBehalfOfId: string | null = null,
  db: Db = prisma,
) {
  const reviewers = await buildApprovalReviewers(task.performerId, "completion", projectId, db);
  const round = await nextRound(task.id, "completion", db);
  let pendingCount = 0;

  await db.task.update({
    where: { id: task.id },
    data: {
      statusId: doneStatusId,
      workflowStatus: "pending_completion",
      completedAt: null,
      updatedById: actorId,
      history: {
        create: {
          action: "completion_submitted",
          userId: actorId,
          onBehalfOfId,
          before: { statusId: task.statusId, workflowStatus: task.workflowStatus },
          after: { statusId: doneStatusId, workflowStatus: "pending_completion", round },
        },
      },
    },
  });

  for (const [index, item] of reviewers.entries()) {
    if (item.status === "pending") pendingCount += 1;
    await db.taskApproval.create({
      data: {
        taskId: task.id,
        type: "completion",
        round,
        level: index + 1,
        reviewerId: item.reviewer.id,
        delegatedForId: item.delegatedFor?.id ?? null,
        status: item.status,
        note: item.note,
        actedAt: item.status === "pending" ? null : new Date(),
      },
    });
  }

  if (pendingCount === 0) {
    await db.task.update({
      where: { id: task.id },
      data: {
        workflowStatus: "final_done",
        completedAt: new Date(),
        updatedById: actorId,
        history: {
          create: {
            action: "completion_auto_approved",
            userId: actorId,
            onBehalfOfId,
            after: { round },
          },
        },
      },
    });
  }

  return { round, pendingCount };
}

export async function isCurrentApproval(approval: Pick<TaskApproval, "id" | "taskId" | "type" | "round" | "level" | "status">, db: Db = prisma) {
  if (approval.status !== "pending") return false;
  const lowerBlocking = await db.taskApproval.count({
    where: {
      taskId: approval.taskId,
      type: approval.type,
      round: approval.round,
      level: { lt: approval.level },
      status: { in: ["pending", "rejected"] },
    },
  });
  return lowerBlocking === 0;
}

export async function canActOnApprovalForUser(
  approval: Pick<TaskApproval, "id" | "taskId" | "type" | "round" | "level" | "status" | "reviewerId" | "delegatedForId">,
  actorId: string,
  db: Db = prisma,
) {
  if (approval.status !== "pending") return false;
  if (approval.reviewerId !== actorId) return false;
  if (approval.delegatedForId) {
    const task = await db.task.findUnique({
      where: { id: approval.taskId },
      select: { projectId: true },
    });
    return task ? hasActiveDelegationInDb(approval.delegatedForId, actorId, task.projectId, db) : false;
  }
  if (approval.type !== "completion") return true;

  return userHasDbPermission(actorId, "task.done.approve", db);
}

export async function getCurrentApprovalForReviewer(approvalId: string, reviewerId: string, db: Db = prisma) {
  const approval = await db.taskApproval.findFirst({
    where: { id: approvalId, reviewerId, status: "pending" },
    include: { task: true },
  });
  if (!approval) return null;
  return (await canActOnApprovalForUser(approval, reviewerId, db)) ? approval : null;
}

export async function finalizeApprovalIfComplete(
  approval: Pick<TaskApproval, "taskId" | "type" | "round">,
  actorId: string,
  onBehalfOfId: string | null = null,
  db: Db = prisma,
) {
  const remaining = await db.taskApproval.count({
    where: {
      taskId: approval.taskId,
      type: approval.type,
      round: approval.round,
      status: "pending",
    },
  });
  if (remaining > 0) return false;

  if (approval.type === "registration") {
    await db.task.update({
      where: { id: approval.taskId },
      data: {
        workflowStatus: "active",
        updatedById: actorId,
        history: {
          create: {
            action: "registration_approved_final",
            userId: actorId,
            onBehalfOfId,
            after: { round: approval.round },
          },
        },
      },
    });
    return true;
  }

  await db.task.update({
    where: { id: approval.taskId },
    data: {
      workflowStatus: "final_done",
      completedAt: new Date(),
      updatedById: actorId,
      history: {
        create: {
          action: "completion_approved_final",
          userId: actorId,
          onBehalfOfId,
          after: { round: approval.round },
        },
      },
    },
  });
  return true;
}

export async function getApprovalQueueForUser(userId: string, db: Db = prisma) {
  const approvals = await db.taskApproval.findMany({
    where: {
      reviewerId: userId,
      status: "pending",
    },
    include: {
      reviewer: { select: { id: true, username: true, displayName: true } },
      delegatedFor: { select: { id: true, username: true, displayName: true } },
      task: {
        include: {
          project: true,
          status: true,
          performer: { select: { id: true, username: true, displayName: true } },
          createdBy: { select: { id: true, username: true, displayName: true } },
          employees: { include: { employee: true } },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { level: "asc" }],
  });

  const current = [];
  for (const approval of approvals) {
    if (await canActOnApprovalForUser(approval, userId, db)) current.push(approval);
  }

  return current.sort(
    (a, b) =>
      compareOperationalPriority(a.task, b.task) ||
      a.level - b.level ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

export async function getApprovalQueueCountForUser(userId: string, db: Db = prisma) {
  const approvals = await db.taskApproval.findMany({
    where: {
      reviewerId: userId,
      status: "pending",
    },
    select: {
      id: true,
      taskId: true,
      type: true,
      round: true,
      level: true,
      status: true,
      reviewerId: true,
      delegatedForId: true,
    },
  });

  let count = 0;
  for (const approval of approvals) {
    if (await canActOnApprovalForUser(approval, userId, db)) count += 1;
  }
  return count;
}

export function isTaskFinalDone(task: Pick<Task, "workflowStatus" | "completedAt"> & { status: Pick<TaskStatusOption, "done"> }) {
  void task.completedAt;
  void task.status;
  return task.workflowStatus === "final_done";
}

export function isTaskOpenForWork(task: Pick<Task, "workflowStatus"> & { status: Pick<TaskStatusOption, "done"> }) {
  return !task.status.done && task.workflowStatus !== "pending_registration";
}
