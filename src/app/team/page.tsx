import Link from "next/link";
import type { TaskPriority, TaskWorkflowStatus } from "@prisma/client";
import { Check, GitBranch, Send, UserPlus, X } from "lucide-react";

import {
  createDirectReportUserAction,
  requestExistingUserReportAction,
  respondEmployeeLinkAction,
} from "@/app/actions/team";
import { CountBadge, PriorityBadge, StatusBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { AppShell } from "@/components/shell";
import { isTaskFinalDone } from "@/lib/approvals";
import { hasPermission, requireActiveUser } from "@/lib/authz";
import { isDueToday, isOverdue } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { ensureUserSettings } from "@/lib/settings";
import { compareOperationalPriority } from "@/lib/task-priority";
import { confirmedTeamStatuses, getDownlineUserIds } from "@/lib/team";

export default async function TeamPage() {
  const user = await requireActiveUser();
  await ensureUserSettings(prisma, user.id);

  const canManageTeam = hasPermission(user, "team.manage.own") || hasPermission(user, "team.manage.all");
  const canViewDownline = hasPermission(user, "team.view.downline");
  const downlineIds = canViewDownline ? await getDownlineUserIds(user.id) : [];
  const relationManagerIds = Array.from(new Set([user.id, ...downlineIds]));

  const [currentProfile, pendingRequests, outgoingRequests, relations, availableUsers, downlineTasks] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: user.id },
        select: { currentProject: { select: { id: true, name: true } } },
      }),
      prisma.teamRelation.findMany({
        where: { reportId: user.id, status: "pending" },
        include: {
          manager: { select: { id: true, username: true, displayName: true } },
          sourceEmployee: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      canManageTeam
        ? prisma.teamRelation.findMany({
            where: { managerId: user.id, status: "pending" },
            include: {
              report: { select: { id: true, username: true, displayName: true } },
            },
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
      prisma.teamRelation.findMany({
        where: {
          managerId: { in: relationManagerIds },
          status: { in: confirmedTeamStatuses },
        },
        include: {
          report: { select: { id: true, username: true, displayName: true } },
        },
        orderBy: [{ managerId: "asc" }, { report: { displayName: "asc" } }],
      }),
      canManageTeam
        ? prisma.user.findMany({
            where: {
              enabled: true,
              id: { not: user.id },
              teamManagers: {
                none: {
                  status: { in: ["pending", "confirmed", "admin_confirmed"] },
                },
              },
            },
            orderBy: [{ displayName: "asc" }, { username: "asc" }],
            select: { id: true, username: true, displayName: true },
          })
        : Promise.resolve([]),
      downlineIds.length
        ? prisma.task.findMany({
            where: {
              AND: [
                { deletedAt: null },
                {
                  OR: [
                    { ownerId: { in: downlineIds } },
                    { ownerId: null, createdById: { in: downlineIds } },
                  ],
                },
              ],
            },
            include: {
              project: true,
              status: true,
              createdBy: { select: { id: true, username: true, displayName: true } },
            },
            orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
          })
        : Promise.resolve([]),
    ]);
  const activeDelegations = await prisma.teamDelegation.findMany({
    where: { assistantId: user.id, active: true },
    include: {
      manager: { select: { id: true, username: true, displayName: true } },
      project: { select: { id: true, name: true } },
    },
    orderBy: [{ project: { name: "asc" } }, { manager: { displayName: "asc" } }, { manager: { username: "asc" } }],
  });
  const delegatedSupport = await Promise.all(
    activeDelegations.map(async (delegation) => {
      const delegatedDownlineIds = await getDownlineUserIds(delegation.managerId);
      const delegatedUserIds = [delegation.managerId, ...delegatedDownlineIds];
      const tasks = await prisma.task.findMany({
        where: {
          AND: [
            { deletedAt: null },
            { projectId: delegation.projectId },
            {
              OR: [
                { ownerId: { in: delegatedUserIds } },
                { ownerId: null, createdById: { in: delegatedUserIds } },
              ],
            },
          ],
        },
        include: {
          project: true,
          status: true,
          createdBy: { select: { id: true, username: true, displayName: true } },
        },
        orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
        take: 12,
      });
      tasks.sort(compareOperationalPriority);

      return {
        manager: delegation.manager,
        project: delegation.project,
        downlineCount: delegatedDownlineIds.length,
        tasks,
      };
    }),
  );

  const childrenByManager = new Map<string, TeamRelationNode[]>();
  for (const relation of relations) {
    const children = childrenByManager.get(relation.managerId) ?? [];
    children.push(relation);
    childrenByManager.set(relation.managerId, children);
  }

  const tasksByUser = new Map<string, TeamTask[]>();
  for (const task of downlineTasks) {
    const ownerId = task.ownerId ?? task.createdById;
    const tasks = tasksByUser.get(ownerId) ?? [];
    tasks.push(task);
    tasksByUser.set(ownerId, tasks);
  }

  const directReports = childrenByManager.get(user.id) ?? [];

  return (
    <AppShell user={user}>
      <PageHeader
        title="Đội nhóm"
        description="Quản lý cấp dưới trực tiếp, xác nhận quan hệ quản lý và theo dõi nhiệm vụ theo cây nhiều cấp."
      />

      <section className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        {canManageTeam ? (
          <TeamManagementPanel
            currentProject={currentProfile?.currentProject ?? null}
            availableUsers={availableUsers}
            outgoingRequests={outgoingRequests}
            directReports={directReports}
          />
        ) : null}
        <PendingRequests requests={pendingRequests} />
      </section>

      {delegatedSupport.length ? (
        <DelegatedSupportPanel sections={delegatedSupport} />
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <GitBranch size={18} aria-hidden="true" />
          <h2 className="text-base font-semibold text-slate-950">Cây cấp dưới</h2>
          <CountBadge>{downlineIds.length}</CountBadge>
        </div>
        {directReports.length ? (
          <div className="space-y-3">
            {directReports.map((relation) => (
              <TeamNode
                key={relation.id}
                relation={relation}
                childrenByManager={childrenByManager}
                tasksByUser={tasksByUser}
                depth={0}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-500">
            Chưa có cấp dưới đã xác nhận.
          </div>
        )}
      </section>
    </AppShell>
  );
}

function DelegatedSupportPanel({
  sections,
}: {
  sections: Array<{
    manager: UserOption;
    project: { id: string; name: string };
    downlineCount: number;
    tasks: TeamTask[];
  }>;
}) {
  return (
    <section className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold text-blue-950">Đang hỗ trợ</h2>
        <CountBadge>{sections.length}</CountBadge>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {sections.map((section) => (
          <div key={`${section.manager.id}:${section.project.id}`} className="rounded-md border border-blue-100 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-950">
                  {section.manager.displayName || section.manager.username}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  @{section.manager.username} - {section.project.name} - {section.downlineCount} cấp dưới trong phạm vi hỗ trợ
                </div>
              </div>
              <CountBadge>{section.tasks.length}</CountBadge>
            </div>
            <div className="mt-3">
              <TeamTaskList
                title="Nhiệm vụ trong phạm vi hỗ trợ"
                tasks={section.tasks}
                emptyText="Không có nhiệm vụ trong phạm vi hỗ trợ"
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TeamManagementPanel({
  currentProject,
  availableUsers,
  outgoingRequests,
  directReports,
}: {
  currentProject: { id: string; name: string } | null;
  availableUsers: UserOption[];
  outgoingRequests: Array<{ id: string; report: UserOption }>;
  directReports: TeamRelationNode[];
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-950">Quản lý nhân sự trực tiếp</h2>
        <p className="mt-1 text-sm text-slate-500">
          Nhân viên mới là user thật, luôn được tạo với vai trò Thành viên và dùng dự án hiện tại của bạn.
        </p>
        <div className="mt-2 text-xs text-slate-500">
          Dự án hiện tại: <span className="font-semibold text-slate-700">{currentProject?.name ?? "Chưa có dự án"}</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <form action={createDirectReportUserAction} className="rounded-md border border-slate-200 p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">
            <UserPlus size={16} aria-hidden="true" />
            Tạo nhân viên
          </div>
          <div className="grid gap-3">
            <input
              name="displayName"
              required
              placeholder="Tên hiển thị"
              className="h-10 rounded-md border border-slate-300 px-3 text-sm"
            />
            <input
              name="username"
              required
              placeholder="Tên đăng nhập"
              className="h-10 rounded-md border border-slate-300 px-3 text-sm"
            />
            <input
              name="password"
              type="password"
              required
              minLength={8}
              placeholder="Mật khẩu ban đầu"
              className="h-10 rounded-md border border-slate-300 px-3 text-sm"
            />
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <UserPlus size={16} aria-hidden="true" />
              Tạo cấp dưới
            </button>
          </div>
        </form>

        <form action={requestExistingUserReportAction} className="rounded-md border border-slate-200 p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Send size={16} aria-hidden="true" />
            Nhận user đã có
          </div>
          <div className="grid gap-3">
            <select
              name="reportId"
              required
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
              defaultValue=""
            >
              <option value="">Chọn user cần xác nhận</option>
              {availableUsers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName || item.username} (@{item.username})
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">
              User đã tồn tại phải xác nhận trước khi quan hệ quản lý có hiệu lực.
            </p>
            <button
              type="submit"
              disabled={availableUsers.length === 0}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Send size={16} aria-hidden="true" />
              Gửi yêu cầu
            </button>
          </div>
        </form>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <DirectReports title="Cấp dưới trực tiếp" reports={directReports.map((relation) => relation.report)} />
        <DirectReports title="Yêu cầu đã gửi" reports={outgoingRequests.map((relation) => relation.report)} pending />
      </div>
    </section>
  );
}

function DirectReports({
  title,
  reports,
  pending = false,
}: {
  title: string;
  reports: UserOption[];
  pending?: boolean;
}) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase text-slate-500">{title}</div>
        <CountBadge>{reports.length}</CountBadge>
      </div>
      <div className="grid gap-2">
        {reports.map((report) => (
          <div key={report.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="font-medium text-slate-900">{report.displayName || report.username}</div>
            <div className="mt-1 text-xs text-slate-500">
              @{report.username}
              {pending ? " - chờ xác nhận" : ""}
            </div>
          </div>
        ))}
        {reports.length === 0 ? <p className="text-sm text-slate-500">Chưa có dữ liệu.</p> : null}
      </div>
    </div>
  );
}

function PendingRequests({
  requests,
}: {
  requests: Array<{
    id: string;
    manager: { displayName: string; username: string };
    sourceEmployee: { name: string } | null;
  }>;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold text-slate-950">Yêu cầu chờ xác nhận</h2>
        <CountBadge>{requests.length}</CountBadge>
      </div>
      <div className="grid gap-3">
        {requests.map((request) => (
          <div key={request.id} className="rounded-md border border-slate-200 p-3">
            <div className="text-sm font-medium text-slate-900">
              {request.manager.displayName || request.manager.username}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Muốn nhận bạn làm cấp dưới trực tiếp
              {request.sourceEmployee?.name ? ` (${request.sourceEmployee.name})` : ""}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <form action={respondEmployeeLinkAction}>
                <input type="hidden" name="relationId" value={request.id} />
                <input type="hidden" name="decision" value="approve" />
                <button
                  type="submit"
                  className="inline-flex h-8 items-center gap-2 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  <Check size={14} aria-hidden="true" />
                  Xác nhận
                </button>
              </form>
              <form action={respondEmployeeLinkAction}>
                <input type="hidden" name="relationId" value={request.id} />
                <input type="hidden" name="decision" value="decline" />
                <button
                  type="submit"
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  <X size={14} aria-hidden="true" />
                  Từ chối
                </button>
              </form>
            </div>
          </div>
        ))}
        {requests.length === 0 ? <p className="text-sm text-slate-500">Không có yêu cầu chờ xác nhận.</p> : null}
      </div>
    </section>
  );
}

function TeamNode({
  relation,
  childrenByManager,
  tasksByUser,
  depth,
}: {
  relation: TeamRelationNode;
  childrenByManager: Map<string, TeamRelationNode[]>;
  tasksByUser: Map<string, TeamTask[]>;
  depth: number;
}) {
  const directTasks = [...(tasksByUser.get(relation.reportId) ?? [])].sort(compareOperationalPriority);
  const descendantIds = collectDescendantUserIds(relation.reportId, childrenByManager);
  const downlineTasks = descendantIds.flatMap((userId) => tasksByUser.get(userId) ?? []).sort(compareOperationalPriority);
  const totalTasks = [...directTasks, ...downlineTasks].sort(compareOperationalPriority);
  const openTasks = totalTasks.filter((task) => !isTaskFinalDone(task));
  const statusRows = Array.from(
    totalTasks.reduce<Map<string, { status: TeamTask["status"]; count: number }>>((groups, task) => {
      const current = groups.get(task.status.id) ?? { status: task.status, count: 0 };
      current.count += 1;
      groups.set(task.status.id, current);
      return groups;
    }, new Map()).values(),
  );
  const children = childrenByManager.get(relation.reportId) ?? [];

  return (
    <div className="space-y-3" style={{ marginLeft: depth ? 18 : 0 }}>
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-950">
              {relation.report.displayName || relation.report.username}
            </div>
            <div className="mt-1 text-xs text-slate-500">@{relation.report.username}</div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
            <span className="rounded-md bg-white px-2 py-1">{directTasks.length} trực tiếp</span>
            <span className="rounded-md bg-white px-2 py-1">{downlineTasks.length} cấp dưới</span>
            <span className="rounded-md bg-white px-2 py-1">{totalTasks.length} tổng</span>
            <span className="rounded-md bg-white px-2 py-1">
              {totalTasks.filter((task) => isOverdue(task.status, task.dueDate)).length} quá hạn
            </span>
            <span className="rounded-md bg-white px-2 py-1">
              {totalTasks.filter((task) => isDueToday(task.status, task.dueDate)).length} hôm nay
            </span>
            <span className="rounded-md bg-white px-2 py-1">
              {totalTasks.filter((task) => isTaskFinalDone(task)).length} xong
            </span>
            <span className="rounded-md bg-red-50 px-2 py-1 text-red-700">
              {openTasks.filter((task) => task.priority === "urgent").length} khẩn cấp
            </span>
            <span className="rounded-md bg-orange-50 px-2 py-1 text-orange-700">
              {openTasks.filter((task) => task.priority === "high").length} ưu tiên cao
            </span>
          </div>
        </div>
        {statusRows.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {statusRows.map((row) => (
              <span key={row.status.id} className="inline-flex items-center gap-1">
                <StatusBadge status={row.status} />
                <span className="text-xs font-semibold text-slate-500">{row.count}</span>
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <TeamTaskList title="Nhiệm vụ trực tiếp" tasks={directTasks} emptyText="0 nhiệm vụ trực tiếp" />
          <TeamTaskList title="Nhiệm vụ cấp dưới" tasks={downlineTasks} emptyText="0 nhiệm vụ cấp dưới" />
        </div>
      </div>
      {children.map((child) => (
        <TeamNode
          key={child.id}
          relation={child}
          childrenByManager={childrenByManager}
          tasksByUser={tasksByUser}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

type UserOption = {
  id: string;
  username: string;
  displayName: string;
};

type TeamRelationNode = {
  id: string;
  managerId: string;
  reportId: string;
  report: UserOption;
};

type TeamTask = {
  id: string;
  title: string;
  dueDate: Date | null;
  priority: TaskPriority;
  sortOrder: number;
  updatedAt: Date;
  workflowStatus: TaskWorkflowStatus;
  completedAt: Date | null;
  ownerId: string | null;
  createdById: string;
  createdBy: { id: string; username: string; displayName: string };
  project: { name: string };
  status: { id: string; label: string; color: string; done: boolean };
};

function collectDescendantUserIds(
  userId: string,
  childrenByManager: Map<string, TeamRelationNode[]>,
) {
  const result: string[] = [];
  const stack = [...(childrenByManager.get(userId) ?? [])];

  while (stack.length > 0) {
    const relation = stack.shift();
    if (!relation) continue;
    result.push(relation.reportId);
    stack.push(...(childrenByManager.get(relation.reportId) ?? []));
  }

  return result;
}

function TeamTaskList({
  title,
  tasks,
  emptyText,
}: {
  title: string;
  tasks: TeamTask[];
  emptyText: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase text-slate-500">{title}</div>
        <CountBadge>{tasks.length}</CountBadge>
      </div>
      <div className="grid gap-2">
        {tasks.map((task) => (
          <Link
            key={task.id}
            href={`/tasks/${task.id}`}
            className="rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-950">{task.title}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                <span>{task.project.name}</span>
                <span>Hạn: {task.dueDate ? task.dueDate.toISOString().slice(0, 10) : "Không có hạn"}</span>
                <span>Người tạo: {task.createdBy.displayName || task.createdBy.username}</span>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge status={task.status} />
              <PriorityBadge priority={task.priority} />
            </div>
          </Link>
        ))}
        {tasks.length === 0 ? <div className="text-sm text-slate-500">{emptyText}</div> : null}
      </div>
    </div>
  );
}
