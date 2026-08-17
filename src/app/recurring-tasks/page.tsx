import Link from "next/link";
import type { Project, RecurringTask, RecurringTaskEmployee } from "@prisma/client";
import { Archive, CalendarClock, Plus } from "lucide-react";

import { archiveRecurringTaskAction } from "@/app/actions/recurring-tasks";
import { CountBadge, PriorityBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { RecurringTaskForm } from "@/components/recurring-task-form";
import { AppShell } from "@/components/shell";
import { canActAsDelegatedManager, hasPermission, requireActiveUser } from "@/lib/authz";
import { dateKey, shortDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { getTaskDelegationContexts, getTaskReferenceData } from "@/lib/queries";
import { materializeDueRecurringTasks, recurringTaskAccessWhere } from "@/lib/recurrence";
import {
  addDaysKey,
  isRecurringTemplateInNoticeWindow,
  nextOccurrenceOnOrAfter,
  recurringTaskSummary,
} from "@/lib/recurrence-utils";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function RecurringTasksPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireActiveUser();
  await materializeDueRecurringTasks(user);
  const params = await searchParams;
  const showNew = params.new === "1";
  const canCreateOwnTask = hasPermission(user, "task.create");
  const canChooseProject = hasPermission(user, "task.view.all") || hasPermission(user, "project.manage");
  const { projects, employees, statuses } = await getTaskReferenceData(user);
  const delegationContexts = await getTaskDelegationContexts(user);
  const createBaseContexts = [
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
  ];
  const canCreate = canCreateOwnTask || delegationContexts.length > 0;
  const accessWhere = await recurringTaskAccessWhere(user);
  const recurringTasks = await prisma.recurringTask.findMany({
    where: accessWhere,
    include: {
      project: true,
      owner: { select: { id: true, username: true, displayName: true } },
      performer: { select: { id: true, username: true, displayName: true } },
      createdBy: { select: { id: true, username: true, displayName: true } },
      onBehalfOf: { select: { id: true, username: true, displayName: true } },
      employees: {
        include: {
          employee: {
            include: {
              linkedUser: { select: { id: true, username: true, displayName: true } },
              projects: { include: { project: true } },
            },
          },
        },
      },
      tasks: {
        where: { deletedAt: null },
        include: { status: true },
        orderBy: [{ recurrenceOccurrence: "desc" }, { createdAt: "desc" }],
        take: 5,
      },
    },
    orderBy: [{ active: "desc" }, { firstOccurrence: "asc" }, { title: "asc" }],
  });
  const editableIds = new Set<string>();
  for (const template of recurringTasks) {
    if (
      hasPermission(user, "task.view.all") ||
      template.createdById === user.id ||
      template.ownerId === user.id ||
      (template.onBehalfOfId && (await canActAsDelegatedManager(user.id, template.onBehalfOfId, template.projectId)))
    ) {
      editableIds.add(template.id);
    }
  }

  return (
    <AppShell user={user}>
      <PageHeader
        title="Nhiệm vụ thường xuyên"
        description="Quản lý các mẫu nhiệm vụ lặp. Khi tới ngày bắt đầu chu kỳ, hệ thống tự tạo nhiệm vụ thường trong danh sách Nhiệm vụ."
        actions={
          canCreate && !showNew ? (
            <Link
              href="/recurring-tasks?new=1"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <Plus size={16} aria-hidden="true" />
              Tạo nhiệm vụ thường xuyên
            </Link>
          ) : null
        }
      />

      {showNew && canCreate ? (
        <section className="mb-6">
          <h2 className="mb-3 text-base font-semibold text-slate-950">Tạo nhiệm vụ thường xuyên</h2>
          <RecurringTaskForm
            projects={projects}
            employees={employees}
            canChooseProject={canChooseProject}
            actingContexts={createBaseContexts}
          />
        </section>
      ) : null}

      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold text-slate-950">Danh sách mẫu</h2>
        <CountBadge>{recurringTasks.length}</CountBadge>
      </div>

      <div className="grid gap-3">
        {recurringTasks.map((template) => (
          <RecurringTaskCard
            key={template.id}
            template={template}
            canEdit={editableIds.has(template.id)}
            projects={projects}
            employees={employees}
            canChooseProject={canChooseProject}
            actingContexts={createBaseContexts}
          />
        ))}
        {recurringTasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            Chưa có nhiệm vụ thường xuyên.
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

type RecurringTaskForPage = RecurringTask & {
  project: Pick<Project, "name">;
  owner: { id: string; username: string; displayName: string };
  createdBy: { id: string; username: string; displayName: string };
  onBehalfOf: { id: string; username: string; displayName: string } | null;
  employees: Array<{
    employeeId: string;
    employee: {
      name: string;
      linkedUser?: { username: string; displayName: string } | null;
      projects?: Array<{ projectId: string; project?: { name: string } }>;
    };
  }>;
  tasks: Array<{
    id: string;
    title: string;
    recurrenceOccurrence: Date | null;
    startDate: Date | null;
    dueDate: Date | null;
    workflowStatus: string;
    status: { label: string };
  }>;
};

function RecurringTaskCard({
  template,
  canEdit,
  projects,
  employees,
  canChooseProject,
  actingContexts,
}: {
  template: RecurringTaskForPage;
  canEdit: boolean;
  projects: Parameters<typeof RecurringTaskForm>[0]["projects"];
  employees: Parameters<typeof RecurringTaskForm>[0]["employees"];
  canChooseProject: boolean;
  actingContexts: Parameters<typeof RecurringTaskForm>[0]["actingContexts"];
}) {
  const todayKey = dateKey(new Date());
  const nextKey = nextOccurrenceOnOrAfter(template);
  const dueKey = nextKey ? addDaysKey(nextKey, template.durationDays) : null;
  const inNoticeWindow = template.active && !template.archivedAt && isRecurringTemplateInNoticeWindow(template);
  const dueToday = template.active && nextKey === todayKey;
  const employeeNames = template.employees.length
    ? template.employees.map((item) => item.employee.name).join(", ")
    : "Chưa gán";

  return (
    <article
      className={[
        "rounded-lg border bg-white p-4 shadow-sm",
        inNoticeWindow || dueToday ? "border-sky-300 bg-sky-50/50 ring-1 ring-sky-100" : "border-slate-200",
        !template.active || template.archivedAt ? "opacity-70" : "",
      ].join(" ")}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-950">{template.title}</h3>
            <PriorityBadge priority={template.priority} />
            {template.active && !template.archivedAt ? (
              <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">Đang hoạt động</span>
            ) : (
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">Đã lưu trữ</span>
            )}
            {dueToday ? (
              <span className="rounded-md bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">Tới kỳ hôm nay</span>
            ) : null}
            {inNoticeWindow && !dueToday ? (
              <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                Sắp tới: {shortDate(nextKey)}
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
            <span>Dự án: {template.project.name}</span>
            <span>Người nhận việc: {employeeNames}</span>
            <span>Người chịu trách nhiệm: {template.owner.displayName || template.owner.username}</span>
            <span>Người tạo: {template.createdBy.displayName || template.createdBy.username}</span>
            {template.onBehalfOf ? (
              <span className="font-medium text-amber-700">
                Làm thay {template.onBehalfOf.displayName || template.onBehalfOf.username}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-slate-600">{recurringTaskSummary(template)}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <CalendarClock size={13} aria-hidden="true" />
              Kỳ tiếp theo: {nextKey ? `${shortDate(nextKey)} - phải xong ${shortDate(dueKey)}` : "Không còn kỳ"}
            </span>
            <span>Đã sinh: {template.tasks.length} nhiệm vụ gần nhất</span>
          </div>
          {template.description ? (
            <p className="mt-2 line-clamp-2 text-sm text-slate-500">{template.description}</p>
          ) : null}
        </div>
        {canEdit && template.active && !template.archivedAt ? (
          <form action={archiveRecurringTaskAction}>
            <input type="hidden" name="id" value={template.id} />
            <button
              type="submit"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Archive size={15} aria-hidden="true" />
              Lưu trữ
            </button>
          </form>
        ) : null}
      </div>

      {template.tasks.length ? (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Nhiệm vụ đã sinh gần đây</div>
          <div className="grid gap-2">
            {template.tasks.map((task) => (
              <Link
                key={task.id}
                href={`/tasks/${task.id}`}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
              >
                <div className="font-medium text-slate-950">{task.title}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>Kỳ: {shortDate(task.recurrenceOccurrence ?? task.startDate)}</span>
                  <span>Hạn: {shortDate(task.dueDate)}</span>
                  <span>Trạng thái: {task.status.label}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {canEdit ? (
        <details className="mt-4 border-t border-slate-100 pt-3">
          <summary className="cursor-pointer text-sm font-semibold text-blue-700">Chỉnh sửa mẫu</summary>
          <div className="mt-3">
            <RecurringTaskForm
              recurringTask={{
                ...template,
                employees: template.employees.map((item) => ({
                  recurringTaskId: template.id,
                  employeeId: item.employeeId,
                })) satisfies RecurringTaskEmployee[],
              }}
              projects={projects}
              employees={employees}
              canChooseProject={canChooseProject}
              actingContexts={actingContexts}
            />
          </div>
        </details>
      ) : null}
    </article>
  );
}
