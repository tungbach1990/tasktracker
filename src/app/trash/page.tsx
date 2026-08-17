import type { Prisma } from "@prisma/client";
import { Archive, CalendarDays, Folder, RotateCcw, UserRound } from "lucide-react";

import { restoreTaskAction } from "@/app/actions/tasks";
import { CountBadge, PriorityBadge, StatusBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { AppShell } from "@/components/shell";
import { hasPermission, requireActiveUser } from "@/lib/authz";
import { dateTime, shortDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { archivedTaskScopeWhere } from "@/lib/queries";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TrashPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireActiveUser();
  const params = await searchParams;
  const scope = typeof params.scope === "string" ? params.scope : "";
  const canViewTeam = hasPermission(user, "team.view.downline");
  const canViewAll = hasPermission(user, "task.view.all");
  const canDeleteTasks = hasPermission(user, "task.delete");
  const baseWhere = await archivedTaskScopeWhere(user, scope);
  const where: Prisma.TaskWhereInput = { AND: [baseWhere] };

  const tasks = await prisma.task.findMany({
    where,
    include: {
      project: true,
      status: true,
      parent: { select: { id: true, title: true, deletedAt: true } },
      createdBy: { select: { id: true, username: true, displayName: true } },
      employees: {
        include: {
          employee: {
            include: {
              linkedUser: { select: { id: true, username: true, displayName: true } },
            },
          },
        },
      },
    },
    orderBy: [{ deletedAt: "desc" }, { updatedAt: "desc" }, { title: "asc" }],
  });

  return (
    <AppShell user={user}>
      <PageHeader
        title="Thùng rác"
        description="Các nhiệm vụ đã lưu trữ hoặc xóa mềm. Khôi phục sẽ đưa nhiệm vụ quay lại đúng trạng thái trước đó."
      />

      <form className="mb-5 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[minmax(0,220px)_auto]">
        <select name="scope" defaultValue={scope} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
          <option value="">Có thể xem</option>
          <option value="own">Của tôi</option>
          <option value="assigned">Giao cho tôi</option>
          {canViewTeam ? <option value="team">Đội nhóm</option> : null}
          {canViewAll ? <option value="all">Tất cả</option> : null}
        </select>
        <button type="submit" className="h-10 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800">
          Lọc
        </button>
      </form>

      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold text-slate-950">Nhiệm vụ đã lưu trữ</h2>
        <CountBadge>{tasks.length}</CountBadge>
      </div>

      <div className="grid gap-3">
        {tasks.length ? (
          tasks.map((task) => {
            const canRestore = canArchiveTrashTask(user.id, canDeleteTasks, canViewAll, task);
            const employeeNames = task.employees.length
              ? task.employees.map((item) => item.employee.name).join(", ")
              : "Chưa gán";

            return (
              <article key={task.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Archive size={16} className="shrink-0 text-slate-500" aria-hidden="true" />
                      <h3 className="truncate text-sm font-semibold text-slate-950">{task.title}</h3>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <StatusBadge status={task.status} />
                      <PriorityBadge priority={task.priority} />
                    </div>
                  </div>
                  {canRestore ? (
                    <form action={restoreTaskAction}>
                      <input type="hidden" name="id" value={task.id} />
                      <button
                        type="submit"
                        className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700"
                      >
                        <RotateCcw size={15} aria-hidden="true" />
                        Khôi phục
                      </button>
                    </form>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-100 px-2">
                    <Folder size={14} aria-hidden="true" />
                    {task.project.name}
                  </span>
                  <span className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-100 px-2">
                    <CalendarDays size={14} aria-hidden="true" />
                    Hạn: {shortDate(task.dueDate)}
                  </span>
                  <span className="inline-flex h-7 items-center gap-1 rounded-md bg-amber-50 px-2 text-amber-800">
                    <Archive size={14} aria-hidden="true" />
                    Lưu trữ: {task.deletedAt ? dateTime(task.deletedAt) : "-"}
                  </span>
                  <span className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-100 px-2">
                    <UserRound size={14} aria-hidden="true" />
                    Người tạo: {task.createdBy.displayName || task.createdBy.username}
                  </span>
                  <span className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-100 px-2">
                    <UserRound size={14} aria-hidden="true" />
                    Người nhận việc: {employeeNames}
                  </span>
                  {task.parent ? (
                    <span className="inline-flex h-7 items-center rounded-md bg-slate-100 px-2">
                      Nhiệm vụ cha: {task.parent.title}
                      {task.parent.deletedAt ? " (đang trong thùng rác)" : ""}
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            Không có nhiệm vụ nào trong thùng rác.
          </div>
        )}
      </div>
    </AppShell>
  );
}

function canArchiveTrashTask(
  userId: string,
  canDeleteTasks: boolean,
  canViewAll: boolean,
  task: { createdById: string; ownerId: string | null },
) {
  return canDeleteTasks && (canViewAll || task.createdById === userId || (task.ownerId ?? task.createdById) === userId);
}
