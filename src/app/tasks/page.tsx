import Link from "next/link";
import type { Prisma, TaskPriority } from "@prisma/client";
import { Plus, Repeat2 } from "lucide-react";

import { generateRecurringTasksAction } from "@/app/actions/tasks";
import { AppShell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { TaskCard } from "@/components/task-card";
import { TaskForm } from "@/components/task-form";
import { CountBadge } from "@/components/badge";
import { priorities } from "@/lib/constants";
import { hasPermission, requireActiveUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getTaskDelegationContexts, getTaskReferenceData, taskScopeWhere } from "@/lib/queries";
import { compareOperationalPriority } from "@/lib/task-priority";
import { getDirectReportLookup } from "@/lib/team";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireActiveUser();
  const params = await searchParams;
  const showNew = params.new === "1";
  const project = typeof params.project === "string" ? params.project : "";
  const status = typeof params.status === "string" ? params.status : "";
  const priority = typeof params.priority === "string" ? params.priority : "";
  const employee = typeof params.employee === "string" ? params.employee : typeof params.assignee === "string" ? params.assignee : "";
  const owner = typeof params.owner === "string" ? params.owner : "";
  const scope = typeof params.scope === "string" ? params.scope : "";
  const includeChildren = params.includeChildren === "1";
  const recurringCreated = typeof params.recurring === "string" ? Number(params.recurring) : null;
  const canViewAll = hasPermission(user, "task.view.all");
  const canViewTeam = hasPermission(user, "team.view.downline");

  const { projects, employees, statuses } = await getTaskReferenceData(user);
  const delegationContexts = await getTaskDelegationContexts(user);
  const canCreateOwnTask = hasPermission(user, "task.create");
  const canCreate = canCreateOwnTask || delegationContexts.length > 0;
  const canUpdate = hasPermission(user, "task.update") || delegationContexts.length > 0;
  const canChooseProject = canViewAll || hasPermission(user, "project.manage");
  const directReportByUser = canViewAll || canViewTeam ? await getDirectReportLookup(user.id) : new Map();
  const directBranches = Array.from(
    new Map(
      Array.from(directReportByUser.values()).map((directReport) => [directReport.id, directReport]),
    ).values(),
  ).sort((a, b) =>
    (a.displayName || a.username).localeCompare(b.displayName || b.username),
  );
  const ownerBranchUserIds = owner
    ? Array.from(directReportByUser.entries())
        .filter(([, directReport]) => directReport.id === owner)
        .map(([userId]) => userId)
    : [];
  const baseWhere = await taskScopeWhere(user, scope);
  const where: Prisma.TaskWhereInput = {
    AND: [
      baseWhere,
      includeChildren ? {} : { parentId: null },
      (canViewAll || canViewTeam) && owner
        ? {
            OR: [
              { ownerId: { in: ownerBranchUserIds.length ? ownerBranchUserIds : ["__no_branch__"] } },
              { ownerId: null, createdById: { in: ownerBranchUserIds.length ? ownerBranchUserIds : ["__no_branch__"] } },
            ],
          }
        : {},
      project ? { projectId: project } : {},
      status ? { OR: [{ statusId: status }, { status: { key: status } }] } : {},
      priority ? { priority: priority as TaskPriority } : {},
      employee ? { employees: { some: { employeeId: employee } } } : {},
    ],
  };

  const tasks = await prisma.task.findMany({
    where,
    include: {
      project: true,
      status: true,
      createdBy: { select: { username: true, displayName: true } },
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
    orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }, { updatedAt: "desc" }],
  });
  tasks.sort(compareOperationalPriority);
  for (const task of tasks) {
    task.children.sort(compareOperationalPriority);
  }
  const cardStatuses = await prisma.taskStatusOption.findMany({
    where: { ownerId: { in: Array.from(new Set([user.id, ...tasks.map((task) => task.ownerId ?? task.createdById)])) } },
    orderBy: [{ ownerId: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
  });
  const directReportLabelByTaskId = new Map(
    tasks
      .map((task) => {
        const ownerId = task.ownerId ?? task.createdById;
        const directReport = ownerId === user.id ? null : directReportByUser.get(ownerId);
        return directReport ? [task.id, directReport.displayName || directReport.username] : null;
      })
      .filter((item): item is [string, string] => Boolean(item)),
  );

  return (
    <AppShell user={user}>
      <PageHeader
        title="Nhiệm vụ"
        description="Danh sách nhiệm vụ có lọc theo dự án, người nhận việc, hạn hoàn thành và trạng thái."
        actions={
          canCreate ? (
            <>
              <form action={generateRecurringTasksAction}>
                <button
                  type="submit"
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Repeat2 size={16} aria-hidden="true" />
                  Tạo nhiệm vụ lặp
                </button>
              </form>
              {!showNew ? (
                <Link
                  href="/tasks?new=1"
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  <Plus size={16} aria-hidden="true" />
                  Tạo nhiệm vụ
                </Link>
              ) : null}
            </>
          ) : null
        }
      />

      {Number.isFinite(recurringCreated) ? (
        <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Đã tạo {recurringCreated} nhiệm vụ lặp lại đến hạn.
        </div>
      ) : null}

      {showNew && canCreate ? (
        <section className="mb-6">
          <h2 className="mb-3 text-base font-semibold text-slate-950">Tạo nhiệm vụ</h2>
          <TaskForm
            projects={projects}
            employees={employees}
                statuses={statuses}
                canChooseProject={canChooseProject}
                actingContexts={[
                  ...(canCreateOwnTask
                    ? [
                        {
                          owner: { id: user.id, username: user.username, displayName: user.displayName },
                          canChooseProject,
                          projects,
                          employees,
                          statuses,
                        },
                      ]
                    : []),
                  ...delegationContexts,
                ]}
          />
        </section>
      ) : null}

      <form className="mb-5 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-7">
        <select name="scope" defaultValue={scope} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
          <option value="">Có thể xem</option>
          <option value="own">Của tôi</option>
          <option value="assigned">Giao cho tôi</option>
          {canViewTeam ? <option value="team">Đội nhóm</option> : null}
          {canViewAll ? <option value="all">Tất cả</option> : null}
        </select>
        {canViewAll || canViewTeam ? (
          <select name="owner" defaultValue={owner} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
            <option value="">Tất cả nhánh trực tiếp</option>
            {directBranches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName || item.username}
              </option>
            ))}
          </select>
        ) : null}
        <select name="project" defaultValue={project} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
          <option value="">Tất cả dự án</option>
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
          <option value="">Tất cả trạng thái</option>
          {statuses.map((item) => (
            <option key={item.id} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
        <select name="priority" defaultValue={priority} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
          <option value="">Tất cả độ ưu tiên</option>
          {priorities.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <select name="employee" defaultValue={employee} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
          <option value="">Tất cả nhân viên</option>
          {employees.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm text-slate-700">
          <input type="checkbox" name="includeChildren" value="1" defaultChecked={includeChildren} className="size-4 rounded border-slate-300" />
          Gá»“m nhiá»‡m vá»¥ con
        </label>
        <button type="submit" className="h-10 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800">
          Lọc
        </button>
      </form>

      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold text-slate-950">Kết quả</h2>
        <CountBadge>{tasks.length}</CountBadge>
      </div>

      <div className="grid gap-3">
        {tasks.length ? (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              statuses={cardStatuses}
              canUpdate={canUpdate}
              teamRollupLabel={directReportLabelByTaskId.get(task.id)}
            />
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            Không có nhiệm vụ phù hợp.
          </div>
        )}
      </div>
    </AppShell>
  );
}
