import type { TaskStatusOption } from "@prisma/client";

import { markTaskDoneAction, moveTaskToKanbanColumnAction, reopenTaskAction } from "@/app/actions/tasks";
import { saveKanbanLayoutPatchAction } from "@/app/actions/settings";
import { KanbanBoard, type KanbanBoardColumn, type KanbanBoardStatus, type KanbanBoardTask } from "@/components/kanban-board";
import { AppShell } from "@/components/shell";
import { isTaskFinalDone } from "@/lib/approvals";
import { hasPermission, requireActiveUser } from "@/lib/authz";
import { kanbanColumnWidth, workflowStatusLabels } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { taskScopeWhere } from "@/lib/queries";
import { clampKanbanWidth, ensureKanbanSettings } from "@/lib/settings";
import { compareOperationalPriority } from "@/lib/task-priority";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function KanbanPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireActiveUser();
  await ensureKanbanSettings(prisma, user.id);
  const params = await searchParams;
  const scope = typeof params.scope === "string" ? params.scope : "";
  const canUpdate = hasPermission(user, "task.update");
  const canViewTeam = hasPermission(user, "team.view.downline");
  const canViewAll = hasPermission(user, "task.view.all");
  const where = await taskScopeWhere(user, scope);

  const tasks = await prisma.task.findMany({
    where,
    include: {
      status: true,
      children: {
        where: { deletedAt: null },
        include: { status: true },
        orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }, { title: "asc" }],
      },
    },
    orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }, { updatedAt: "desc" }],
  });
  tasks.sort(compareOperationalPriority);

  const statusOwnerIds = Array.from(new Set([user.id, ...tasks.map((task) => task.ownerId ?? task.createdById)]));
  const statuses = await prisma.taskStatusOption.findMany({
    where: { ownerId: { in: statusOwnerIds }, active: true },
    orderBy: [{ ownerId: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
  });
  const openStatuses = statuses.filter((status) => !status.done);
  const statusColumns = uniqueStatusColumns(openStatuses);

  await prisma.kanbanColumnPreference.createMany({
    data: statusColumns.map((status) => ({
      ownerId: user.id,
      columnKey: `status:${status.key}`,
      columnType: "status" as const,
      enabled: true,
      sortOrder: 100 + status.sortOrder,
      widthPx: kanbanColumnWidth.default,
    })),
    skipDuplicates: true,
  });

  const preferences = await prisma.kanbanColumnPreference.findMany({
    where: { ownerId: user.id },
    orderBy: [{ sortOrder: "asc" }, { columnKey: "asc" }],
  });
  const boardColumns: KanbanBoardColumn[] = preferences.map((column) => ({
    columnKey: column.columnKey,
    columnType: column.columnType,
    label: columnLabel(column.columnKey, statusColumns),
    enabled: column.enabled,
    sortOrder: column.sortOrder,
    widthPx: clampKanbanWidth(column.widthPx),
  }));
  const boardTasks: KanbanBoardTask[] = tasks.map((task) => ({
    id: task.id,
    title: task.title,
    priority: task.priority,
    dueDate: task.dueDate?.toISOString() ?? null,
    sortOrder: task.sortOrder,
    updatedAt: task.updatedAt.toISOString(),
    workflowStatus: task.workflowStatus,
    createdById: task.createdById,
    ownerId: task.ownerId ?? task.createdById,
    columnKey: columnKeyForTask(task),
    finalDone: isTaskFinalDone(task),
    childCount: task.children.length,
    childDoneCount: task.children.filter((child) => isTaskFinalDone(child)).length,
  }));
  const boardStatuses: KanbanBoardStatus[] = statuses.map((status) => ({
    id: status.id,
    key: status.key,
    label: status.label,
    ownerId: status.ownerId,
    done: status.done,
  }));

  return (
    <AppShell user={user} fullHeight mainClassName="p-0 lg:p-0">
      <KanbanBoard
        initialColumns={boardColumns}
        tasks={boardTasks}
        statuses={boardStatuses}
        scope={scope}
        canUpdate={canUpdate}
        canViewTeam={canViewTeam}
        canViewAll={canViewAll}
        saveLayoutAction={saveKanbanLayoutPatchAction}
        markDoneAction={markTaskDoneAction}
        reopenAction={reopenTaskAction}
        moveAction={moveTaskToKanbanColumnAction}
      />
    </AppShell>
  );
}

function columnKeyForTask(task: {
  workflowStatus: "active" | "pending_registration" | "registration_rejected" | "pending_completion" | "final_done" | "completion_rejected";
  completedAt: Date | null;
  status: Pick<TaskStatusOption, "done" | "key">;
}) {
  if (task.workflowStatus === "pending_registration") return "workflow:pending_registration";
  if (task.workflowStatus === "registration_rejected") return "workflow:registration_rejected";
  if (task.workflowStatus === "pending_completion") return "workflow:pending_completion";
  if (isTaskFinalDone(task)) return "workflow:final_done";
  if (task.workflowStatus === "completion_rejected") return "workflow:completion_rejected";
  return `status:${task.status.key}`;
}

function uniqueStatusColumns(statuses: TaskStatusOption[]) {
  const byKey = new Map<string, Pick<TaskStatusOption, "key" | "label" | "sortOrder">>();
  for (const status of statuses) {
    const existing = byKey.get(status.key);
    if (!existing || status.sortOrder < existing.sortOrder) {
      byKey.set(status.key, { key: status.key, label: status.label, sortOrder: status.sortOrder });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

function columnLabel(
  columnKey: string,
  statusColumns: Array<Pick<TaskStatusOption, "key" | "label">>,
) {
  if (columnKey.startsWith("workflow:")) {
    const workflowStatus = columnKey.slice("workflow:".length) as keyof typeof workflowStatusLabels;
    return workflowStatusLabels[workflowStatus] ?? columnKey;
  }

  const statusKey = columnKey.slice("status:".length);
  return statusColumns.find((status) => status.key === statusKey)?.label ?? statusKey;
}
