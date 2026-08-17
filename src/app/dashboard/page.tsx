import Link from "next/link";
import { CalendarClock, CheckCircle2, Clock3, FastForward, Flame, ListTodo, PlayCircle, Plus, TriangleAlert, UsersRound } from "lucide-react";

import { approveTaskApprovalAction, rejectTaskApprovalAction } from "@/app/actions/tasks";
import { AppShell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { TaskCard } from "@/components/task-card";
import { CountBadge, PriorityBadge, StatusBadge } from "@/components/badge";
import { getApprovalQueueForUser, isTaskFinalDone } from "@/lib/approvals";
import { dashboardNumber } from "@/lib/settings";
import { isDueToday, isOverdue, shortDate } from "@/lib/format";
import { hasPermission, requireActiveUser } from "@/lib/authz";
import { getDashboardData } from "@/lib/queries";
import { isPriorityFocus } from "@/lib/task-priority";
import { getDirectReportLookup } from "@/lib/team";

export default async function DashboardPage() {
  const user = await requireActiveUser();
  const dashboard = await getDashboardData(user);
  const approvalQueue = await getApprovalQueueForUser(user.id);
  const teamSummary = await getTeamSummary(user, dashboard.tasks);
  const enabledPreferences = dashboard.preferences.filter((preference) => preference.enabled);
  const canUpdate = hasPermission(user, "task.update");
  const canDeleteTasks = hasPermission(user, "task.delete");
  const canViewAll = hasPermission(user, "task.view.all");
  const canArchiveTaskIds = new Set(
    dashboard.tasks
      .filter((task) => canArchiveTask(user.id, canDeleteTasks, canViewAll, task))
      .map((task) => task.id),
  );

  const upcomingPreference = dashboard.preferences.find((item) => item.sectionKey === "upcoming");
  const priorityPreference = dashboard.preferences.find((item) => item.sectionKey === "priority_focus");
  const afterPreference = dashboard.preferences.find((item) => item.sectionKey === "after_upcoming");
  const startAfterPreference = dashboard.preferences.find((item) => item.sectionKey === "start_after");
  const recentPreference = dashboard.preferences.find((item) => item.sectionKey === "recent_open");
  const upcomingLimit = dashboardNumber(upcomingPreference?.config, "limit", 8, { min: 1, max: 100 });
  const priorityLimit = dashboardNumber(priorityPreference?.config, "limit", 8, { min: 1, max: 100 });
  const afterLimit = dashboardNumber(afterPreference?.config, "limit", 8, { min: 1, max: 100 });
  const startAfterLimit = dashboardNumber(startAfterPreference?.config, "limit", 8, { min: 1, max: 100 });
  const startAfterDays = dashboardNumber(startAfterPreference?.config, "days", 0, { min: 0, max: 365 });
  const recentLimit = dashboardNumber(recentPreference?.config, "limit", 8, { min: 1, max: 100 });

  const openTasks = dashboard.tasks.filter((task) => !isTaskFinalDone(task) && task.workflowStatus !== "pending_registration");
  const priorityTasks = openTasks.filter((task) => isPriorityFocus(task.priority)).slice(0, priorityLimit);
  const overdueTasks = openTasks.filter((task) => isOverdue(task.status, task.dueDate));
  const todayTasks = openTasks.filter((task) => isDueToday(task.status, task.dueDate));
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const upcomingCutoff = new Date();
  upcomingCutoff.setHours(0, 0, 0, 0);
  upcomingCutoff.setDate(upcomingCutoff.getDate() + dashboard.upcomingDays);
  const startAfterCutoff = new Date();
  startAfterCutoff.setHours(0, 0, 0, 0);
  startAfterCutoff.setDate(startAfterCutoff.getDate() + startAfterDays);
  const upcomingTasks = openTasks
    .filter(
      (task) =>
        task.dueDate &&
        task.dueDate > todayStart &&
        task.dueDate <= upcomingCutoff &&
        !isDueToday(task.status, task.dueDate),
    )
    .slice(0, upcomingLimit);
  const afterUpcomingTasks = openTasks
    .filter((task) => task.dueDate && task.dueDate > upcomingCutoff)
    .slice(0, afterLimit);
  const startAfterTasks = openTasks
    .filter((task) => task.startDate && task.startDate > startAfterCutoff)
    .slice(0, startAfterLimit);

  return (
    <AppShell user={user}>
      <PageHeader
        title="Tổng quan"
        description="Theo dõi hạn hoàn thành, trạng thái và người nhận việc theo cấu hình riêng của bạn."
        actions={
          hasPermission(user, "task.create") ? (
            <Link
              href="/tasks?new=1"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <Plus size={16} aria-hidden="true" />
              Tạo nhiệm vụ
            </Link>
          ) : null
        }
      />

      <section className="grid gap-6">
        {enabledPreferences.map((preference) => {
          if (preference.sectionKey === "metrics") {
            return <MetricsSection key={preference.id} dashboard={dashboard} />;
          }
          if (preference.sectionKey === "priority_focus") {
            return <TaskSection key={preference.id} title={preference.label} tasks={priorityTasks} statuses={dashboard.statuses} canUpdate={canUpdate} canArchiveTaskIds={canArchiveTaskIds} teamRollupByTaskId={teamSummary.directReportLabelByTaskId} icon={<Flame size={16} aria-hidden="true" />} />;
          }
          if (preference.sectionKey === "overdue") {
            return <TaskSection key={preference.id} title={preference.label} tasks={overdueTasks} statuses={dashboard.statuses} canUpdate={canUpdate} canArchiveTaskIds={canArchiveTaskIds} teamRollupByTaskId={teamSummary.directReportLabelByTaskId} />;
          }
          if (preference.sectionKey === "today") {
            return <TaskSection key={preference.id} title={preference.label} tasks={todayTasks} statuses={dashboard.statuses} canUpdate={canUpdate} canArchiveTaskIds={canArchiveTaskIds} teamRollupByTaskId={teamSummary.directReportLabelByTaskId} />;
          }
          if (preference.sectionKey === "upcoming") {
            return <TaskSection key={preference.id} title={preference.label} tasks={upcomingTasks} statuses={dashboard.statuses} canUpdate={canUpdate} canArchiveTaskIds={canArchiveTaskIds} teamRollupByTaskId={teamSummary.directReportLabelByTaskId} />;
          }
          if (preference.sectionKey === "after_upcoming") {
            return <TaskSection key={preference.id} title={preference.label} tasks={afterUpcomingTasks} statuses={dashboard.statuses} canUpdate={canUpdate} canArchiveTaskIds={canArchiveTaskIds} teamRollupByTaskId={teamSummary.directReportLabelByTaskId} />;
          }
          if (preference.sectionKey === "start_after") {
            return <TaskSection key={preference.id} title={preference.label} tasks={startAfterTasks} statuses={dashboard.statuses} canUpdate={canUpdate} canArchiveTaskIds={canArchiveTaskIds} teamRollupByTaskId={teamSummary.directReportLabelByTaskId} />;
          }
          if (preference.sectionKey === "status_summary") {
            return <StatusSummarySection key={preference.id} title={preference.label} dashboard={dashboard} />;
          }
          if (preference.sectionKey === "recent_open") {
            return <RecentOpenSection key={preference.id} title={preference.label} tasks={openTasks.slice(0, recentLimit)} />;
          }
          if (preference.sectionKey === "team_summary") {
            return <TeamSummarySection key={preference.id} title={preference.label} rows={teamSummary.rows} />;
          }

          return null;
        })}
        <ApprovalSection approvals={approvalQueue} />
      </section>
    </AppShell>
  );
}

type DashboardTask = Awaited<ReturnType<typeof getDashboardData>>["tasks"][number];

type TeamSummaryRow = {
  key: string;
  label: string;
  self: boolean;
  total: number;
  overdue: number;
  today: number;
  done: number;
  urgent: number;
  high: number;
  tasks: DashboardTask[];
};

async function getTeamSummary(user: { id: string; username: string; displayName: string }, tasks: DashboardTask[]) {
  const directReportByUser = await getDirectReportLookup(user.id);

  const rows = new Map<string, TeamSummaryRow>();
  const directReportLabelByTaskId = new Map<string, string>();
  for (const task of tasks) {
    const ownerId = task.ownerId ?? task.createdById;
    const isSelfTask = ownerId === user.id;
    let rowKey: string;
    let rowLabel: string;

    if (isSelfTask) {
      rowKey = `self:${user.id}`;
      rowLabel = `Của tôi (${user.displayName || user.username})`;
    } else {
      const directReport = directReportByUser.get(ownerId);
      if (!directReport) continue;
      rowKey = directReport.id;
      rowLabel = directReport.displayName || directReport.username;
      directReportLabelByTaskId.set(task.id, rowLabel);
    }

    const current =
      rows.get(rowKey) ??
      {
        key: rowKey,
        label: rowLabel,
        self: isSelfTask,
        total: 0,
        overdue: 0,
        today: 0,
        done: 0,
        urgent: 0,
        high: 0,
        tasks: [],
      };
    current.total += 1;
    if (isTaskFinalDone(task)) current.done += 1;
    if (!isTaskFinalDone(task) && task.priority === "urgent") current.urgent += 1;
    if (!isTaskFinalDone(task) && task.priority === "high") current.high += 1;
    if (isOverdue(task.status, task.dueDate)) current.overdue += 1;
    if (isDueToday(task.status, task.dueDate)) current.today += 1;
    current.tasks.push(task);
    rows.set(rowKey, current);
  }

  return {
    rows: Array.from(rows.values()).sort((a, b) => {
      if (a.self !== b.self) return a.self ? -1 : 1;
      return b.total - a.total || a.label.localeCompare(b.label);
    }),
    directReportLabelByTaskId,
  };
}

function TeamSummarySection({
  title,
  rows,
}: {
  title: string;
  rows: TeamSummaryRow[];
}) {
  const totalTasks = rows.reduce((sum, row) => sum + row.total, 0);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-md bg-slate-100 text-slate-700">
          <UsersRound size={16} aria-hidden="true" />
        </div>
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <CountBadge>{totalTasks}</CountBadge>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <div key={row.key} className="rounded-md border border-slate-200 px-3 py-2">
            <div className="truncate text-sm font-semibold text-slate-900">
              {row.self ? row.label : `Quản lý trực tiếp: ${row.label}`}
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
              <span>{row.total} tổng</span>
              <span>{row.overdue} quá hạn</span>
              <span>{row.today} hôm nay</span>
              <span>{row.done} xong</span>
              <span>{row.urgent} khẩn cấp</span>
              <span>{row.high} ưu tiên cao</span>
            </div>
            <div className="mt-3 grid gap-2">
              {row.tasks.slice(0, 5).map((task) => (
                <Link
                  key={task.id}
                  href={`/tasks/${task.id}`}
                  className="rounded-md border border-slate-200 px-2 py-2 hover:bg-slate-50"
                >
                  <div className="truncate text-sm font-medium text-slate-950">{task.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <StatusBadge status={task.status} />
                    <PriorityBadge priority={task.priority} />
                    <span>{task.project.name}</span>
                    <span>Hạn: {shortDate(task.dueDate)}</span>
                  </div>
                </Link>
              ))}
              {row.tasks.length > 5 ? (
                <Link href="/team" className="text-xs font-medium text-blue-700 hover:text-blue-900">
                  Xem thêm {row.tasks.length - 5} trong cây đội nhóm
                </Link>
              ) : null}
            </div>
          </div>
        ))}
        {rows.length === 0 ? <p className="text-sm text-slate-500">Không có nhiệm vụ đội nhóm hiển thị.</p> : null}
      </div>
    </section>
  );
}

function ApprovalSection({ approvals }: { approvals: Awaited<ReturnType<typeof getApprovalQueueForUser>> }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-md bg-blue-50 text-blue-700">
          <CheckCircle2 size={16} aria-hidden="true" />
        </div>
        <h2 className="text-base font-semibold text-slate-950">Phê duyệt</h2>
        <CountBadge>{approvals.length}</CountBadge>
      </div>
      <div className="grid gap-3">
        {approvals.map((approval) => (
          <div key={approval.id} className="rounded-md border border-slate-200 p-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <Link href={`/tasks/${approval.taskId}`} className="truncate text-sm font-semibold text-slate-950 hover:text-blue-700">
                  {approval.task.title}
                </Link>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>{approval.type === "registration" ? "Duyệt đăng ký" : "Duyệt hoàn thành"}</span>
                  <span>Cấp {approval.level}</span>
                  {approval.delegatedFor ? (
                    <span className="font-medium text-amber-700">
                      Trợ lý cho {approval.delegatedFor.displayName || approval.delegatedFor.username}
                    </span>
                  ) : null}
                  <PriorityBadge priority={approval.task.priority} />
                  <span>Người duyệt: {approval.reviewer.displayName || approval.reviewer.username}</span>
                  <span>Dự án: {approval.task.project.name}</span>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:min-w-80">
                <form action={approveTaskApprovalAction} className="flex gap-2">
                  <input type="hidden" name="approvalId" value={approval.id} />
                  <input
                    name="note"
                    placeholder="Ghi chú"
                    className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm"
                  />
                  <button type="submit" className="h-9 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700">
                    Duyệt
                  </button>
                </form>
                <form action={rejectTaskApprovalAction} className="flex gap-2">
                  <input type="hidden" name="approvalId" value={approval.id} />
                  <input
                    name="note"
                    required
                    placeholder="Lý do từ chối"
                    className="h-9 min-w-0 flex-1 rounded-md border border-red-200 px-3 text-sm"
                  />
                  <button type="submit" className="h-9 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50">
                    Từ chối
                  </button>
                </form>
              </div>
            </div>
          </div>
        ))}
        {approvals.length === 0 ? <p className="text-sm text-slate-500">Không có phê duyệt đang chờ bạn.</p> : null}
      </div>
    </section>
  );
}

function MetricsSection({ dashboard }: { dashboard: Awaited<ReturnType<typeof getDashboardData>> }) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
      <Metric title="Tổng" value={dashboard.counts.total} icon={<ListTodo size={18} />} />
      <Metric title="Quá hạn" value={dashboard.counts.overdue} icon={<TriangleAlert size={18} />} tone="red" />
      <Metric title="Hôm nay" value={dashboard.counts.today} icon={<Clock3 size={18} />} tone="blue" />
      <Metric title={`Trong ${dashboard.upcomingDays} ngày tới`} value={dashboard.counts.upcoming} icon={<CalendarClock size={18} />} tone="amber" />
      <Metric title="Sau khoảng sắp tới" value={dashboard.counts.afterUpcoming} icon={<FastForward size={18} />} tone="violet" />
      <Metric title={`Bắt đầu sau +${dashboard.startAfterDays} ngày`} value={dashboard.counts.startAfter} icon={<PlayCircle size={18} />} tone="sky" />
      <Metric title="Đã xong" value={dashboard.counts.done} icon={<CheckCircle2 size={18} />} tone="green" />
    </section>
  );
}

function Metric({
  title,
  value,
  icon,
  tone = "slate",
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  tone?: "slate" | "red" | "blue" | "amber" | "green" | "violet" | "sky";
}) {
  const colors = {
    slate: "bg-slate-100 text-slate-700",
    red: "bg-red-50 text-red-700",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    green: "bg-emerald-50 text-emerald-700",
    violet: "bg-violet-50 text-violet-700",
    sky: "bg-sky-50 text-sky-700",
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`mb-4 flex size-9 items-center justify-center rounded-md ${colors[tone]}`}>
        {icon}
      </div>
      <div className="text-2xl font-semibold text-slate-950">{value}</div>
      <div className="text-sm text-slate-500">{title}</div>
    </div>
  );
}

function TaskSection({
  title,
  tasks,
  statuses,
  canUpdate,
  canArchiveTaskIds,
  teamRollupByTaskId,
  icon,
}: {
  title: string;
  tasks: Awaited<ReturnType<typeof getDashboardData>>["tasks"];
  statuses: Awaited<ReturnType<typeof getDashboardData>>["statuses"];
  canUpdate: boolean;
  canArchiveTaskIds?: Set<string>;
  teamRollupByTaskId?: Map<string, string>;
  icon?: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        {icon ? <span className="text-red-600">{icon}</span> : null}
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <CountBadge>{tasks.length}</CountBadge>
      </div>
      <div className="grid gap-3">
        {tasks.length ? (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              statuses={statuses}
              compact
              canUpdate={canUpdate}
              canArchive={canArchiveTaskIds?.has(task.id) ?? false}
              teamRollupLabel={teamRollupByTaskId?.get(task.id)}
            />
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            Không có task.
          </div>
        )}
      </div>
    </section>
  );
}

function canArchiveTask(
  userId: string,
  canDeleteTasks: boolean,
  canViewAll: boolean,
  task: { createdById: string; ownerId: string | null },
) {
  return canDeleteTasks && (canViewAll || task.createdById === userId || (task.ownerId ?? task.createdById) === userId);
}

function StatusSummarySection({
  title,
  dashboard,
}: {
  title: string;
  dashboard: Awaited<ReturnType<typeof getDashboardData>>;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <CountBadge>{dashboard.tasks.length}</CountBadge>
      </div>
      <div className="space-y-3">
        {dashboard.byStatus.map(({ status, count }) => (
          <div key={status.id}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-slate-600">{status.label}</span>
              <span className="font-semibold">{count}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-blue-600"
                style={{
                  width: `${dashboard.tasks.length ? (count / dashboard.tasks.length) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentOpenSection({
  title,
  tasks,
}: {
  title: string;
  tasks: Awaited<ReturnType<typeof getDashboardData>>["tasks"];
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <CountBadge>{tasks.length}</CountBadge>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tasks.map((task) => (
          <Link
            key={task.id}
            href={`/tasks/${task.id}`}
            className="block rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50"
          >
            <div className="truncate text-sm font-medium text-slate-950">{task.title}</div>
            <div className="mt-1 text-xs text-slate-500">{task.project.name}</div>
          </Link>
        ))}
        {tasks.length === 0 ? <p className="text-sm text-slate-500">Không có task mở.</p> : null}
      </div>
    </section>
  );
}
