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

export async function startRegistrationApproval(taskId: string, performerId: string, actorId: string, db: Db = prisma) {
  const chain = await getManagerChain(performerId, db);
  const round = await nextRound(taskId, "registration", db);

  if (chain.length === 0) {
    await db.task.update({
      where: { id: taskId },
      data: {
        workflowStatus: "active",
        history: {
          create: {
            action: "registration_auto_approved",
            userId: actorId,
            after: { performerId, round },
          },
        },
      },
    });
    return { round, pendingCount: 0 };
  }

  for (const [index, reviewer] of chain.entries()) {
    await db.taskApproval.create({
      data: {
        taskId,
        type: "registration",
        round,
        level: index + 1,
        reviewerId: reviewer.id,
      },
    });
  }

  return { round, pendingCount: chain.length };
}

export async function startCompletionApproval(
  task: Pick<Task, "id" | "statusId" | "createdById" | "performerId" | "workflowStatus">,
  actorId: string,
  doneStatusId: string,
  db: Db = prisma,
) {
  const chain = await getManagerChain(task.performerId, db);
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
          before: { statusId: task.statusId, workflowStatus: task.workflowStatus },
          after: { statusId: doneStatusId, workflowStatus: "pending_completion", round },
        },
      },
    },
  });

  for (const [index, reviewer] of chain.entries()) {
    const canApprove = await userHasDbPermission(reviewer.id, "task.done.approve", db);
    if (canApprove) pendingCount += 1;
    await db.taskApproval.create({
      data: {
        taskId: task.id,
        type: "completion",
        round,
        level: index + 1,
        reviewerId: reviewer.id,
        status: canApprove ? "pending" : "skipped",
        note: canApprove ? "" : "Skipped: missing task.done.approve",
        actedAt: canApprove ? null : new Date(),
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
  approval: Pick<TaskApproval, "id" | "taskId" | "type" | "round" | "level" | "status" | "reviewerId">,
  actorId: string,
  db: Db = prisma,
) {
  if (approval.status !== "pending") return false;
  if (approval.reviewerId !== actorId) return false;
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
