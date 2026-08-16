import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { TaskApprovalStatus, TaskApprovalType } from "@prisma/client";
import { CheckCircle2, MessageSquare, Plus, RotateCcw, Trash2 } from "lucide-react";

import {
  addCommentAction,
  approveTaskApprovalAction,
  createChildTaskAction,
  deleteTaskAction,
  markTaskDoneAction,
  rejectTaskApprovalAction,
  reopenTaskAction,
  resubmitRegistrationAction,
} from "@/app/actions/tasks";
import { AppShell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { PriorityBadge, StatusBadge } from "@/components/badge";
import { TaskCard } from "@/components/task-card";
import { TaskForm } from "@/components/task-form";
import { canActOnApprovalForUser, isTaskFinalDone } from "@/lib/approvals";
import { priorities, taskKinds, workflowStatusLabels } from "@/lib/constants";
import { dateTime, shortDate } from "@/lib/format";
import { canActAsDelegatedManager, canDeleteTask, canEditTask, canUpdateTaskExecution, canViewTask, hasPermission, requireActiveUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getTaskReferenceData } from "@/lib/queries";
import { safeUserSelect } from "@/lib/safe-selects";
import { compareOperationalPriority } from "@/lib/task-priority";

type Params = Promise<{ id: string }>;

export default async function TaskDetailPage({ params }: { params: Params }) {
  const user = await requireActiveUser();
  const { id } = await params;
  const allowed = await canViewTask(user, id);
  if (!allowed) redirect("/dashboard");
  const canUpdate = await canUpdateTaskExecution(user, id);
  const canEdit = await canEditTask(user, id);
  const canDelete = await canDeleteTask(user, id);

  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      project: true,
      status: true,
      parent: {
        include: {
          project: true,
          status: true,
          createdBy: { select: { username: true, displayName: true } },
          employees: { include: { employee: true } },
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
        },
      },
      children: {
        where: { deletedAt: null },
        include: {
          project: true,
          status: true,
          createdBy: { select: { username: true, displayName: true } },
          employees: { include: { employee: true } },
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
        },
        orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }, { title: "asc" }],
      },
      employees: { include: { employee: true } },
      comments: {
        include: { user: { select: safeUserSelect } },
        orderBy: { createdAt: "desc" },
      },
      history: {
        include: {
          user: { select: safeUserSelect },
          onBehalfOf: { select: safeUserSelect },
        },
        orderBy: { createdAt: "desc" },
      },
      approvals: {
        include: {
          reviewer: { select: { id: true, username: true, displayName: true } },
          delegatedFor: { select: { id: true, username: true, displayName: true } },
        },
        orderBy: [{ type: "asc" }, { round: "asc" }, { level: "asc" }],
      },
      createdBy: { select: safeUserSelect },
      updatedBy: { select: safeUserSelect },
    },
  });

  if (!task) notFound();
  task.children.sort(compareOperationalPriority);
  task.parent?.children.sort(compareOperationalPriority);
  const taskOwnerId = task.ownerId ?? task.createdById;

  const canEditTaskDetails = canEdit;
  const canCreateForTaskOwner = hasPermission(user, "task.create") || (await canActAsDelegatedManager(user.id, taskOwnerId, task.projectId));
  const canManageChildren = canCreateForTaskOwner && canEdit;
  const canChooseProject = hasPermission(user, "task.view.all") || hasPermission(user, "project.manage");
  const referenceData = canEditTaskDetails || canManageChildren
    ? await getTaskReferenceData(user, id, taskOwnerId, task.projectId)
    : null;
  const statusOwnerIds = Array.from(new Set([taskOwnerId, ...task.children.map((child) => child.ownerId ?? child.createdById)]));
  const cardStatuses = await prisma.taskStatusOption.findMany({
    where: { ownerId: { in: statusOwnerIds } },
    orderBy: [{ ownerId: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
  });
  const currentApprovalIds = new Set<string>();
  for (const approval of task.approvals) {
    if (await canActOnApprovalForUser(approval, user.id)) {
      currentApprovalIds.add(approval.id);
    }
  }

  const finalDone = isTaskFinalDone(task);
  const childTotal = task.children.length;
  const childDone = task.children.filter((child) => isTaskFinalDone(child)).length;
  const canQuickDone =
    canUpdate &&
    !finalDone &&
    task.workflowStatus === "active" &&
    childDone === childTotal;

  return (
    <AppShell user={user}>
      <PageHeader
        title={task.title}
        description={`${task.project.name} - tạo bởi ${task.createdBy.displayName || task.createdBy.username}`}
        actions={
          <Link
            href="/tasks"
            className="inline-flex h-10 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Quay lại danh sách
          </Link>
        }
      />

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={task.status} />
                {task.workflowStatus !== "active" ? (
                  <span className="inline-flex h-6 items-center rounded-md bg-blue-50 px-2 text-xs font-semibold text-blue-700">
                    {workflowStatusLabels[task.workflowStatus]}
                  </span>
                ) : null}
                <PriorityBadge priority={task.priority} />
              </div>
              <div className="flex flex-wrap gap-2">
                {canQuickDone ? (
                  <form action={markTaskDoneAction}>
                    <input type="hidden" name="id" value={task.id} />
                    <button
                      type="submit"
                      className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                      <CheckCircle2 size={15} aria-hidden="true" />
                      {childTotal ? "Gửi hoàn thành" : "Hoàn thành"}
                    </button>
                  </form>
                ) : null}
                {canUpdate && (finalDone || task.workflowStatus === "pending_completion" || task.workflowStatus === "completion_rejected") ? (
                  <form action={reopenTaskAction}>
                    <input type="hidden" name="id" value={task.id} />
                    <button
                      type="submit"
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      <RotateCcw size={15} aria-hidden="true" />
                      Mở lại
                    </button>
                  </form>
                ) : null}
              </div>
            </div>

            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <Info label="Dự án" value={task.project.name} />
              <Info label="Loại nghiệp vụ" value={taskKinds.find((kind) => kind.value === task.kind)?.label ?? task.kind} />
              <Info label="Quy trình" value={workflowStatusLabels[task.workflowStatus]} />
              {task.parent ? <Info label="Nhiệm vụ cha" value={task.parent.title} /> : null}
              <Info label="Nhiệm vụ con" value={`${childDone}/${childTotal} xong`} />
              <Info
                label="Người nhận việc"
                value={
                  task.employees.length
                    ? task.employees.map((employee) => employee.employee.name).join(", ")
                    : "Chưa gán"
                }
              />
              <Info label="Người tạo" value={task.createdBy.displayName || task.createdBy.username} />
              <Info label="Bắt đầu" value={shortDate(task.startDate)} />
              <Info label="Hạn hoàn thành" value={shortDate(task.dueDate)} />
              <Info
                label="Lặp lại"
                value={task.repeats ? `Mỗi ${task.repeatEvery} ${task.repeatUnit}` : "Không"}
              />
              {task.repeats ? <Info label="Ngày lặp" value={shortDate(task.occurrence)} /> : null}
              <Info label="Hoàn thành" value={task.completedAt ? shortDate(task.completedAt) : "Chưa hoàn thành"} />
              <Info label="Cập nhật" value={dateTime(task.updatedAt)} />
            </dl>
          </section>

          <ContentBlock title="Mô tả nhiệm vụ" value={task.description} empty="Chưa có mô tả." />
          <ContentBlock title="Kết quả thực hiện" value={task.result} empty="Chưa có kết quả thực hiện." />
          <ContentBlock title="Phản hồi/cách làm" value={task.feedback} empty="Chưa có phản hồi hoặc cách làm." />

          <ApprovalTimeline approvals={task.approvals} currentApprovalIds={currentApprovalIds} />

          {task.kind === "self_registered" && task.workflowStatus === "registration_rejected" ? (
            <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <h2 className="text-base font-semibold text-amber-900">Đăng ký bị từ chối</h2>
              <p className="mt-1 text-sm text-amber-800">Cập nhật nội dung nếu cần, sau đó gửi lại để duyệt.</p>
              <form action={resubmitRegistrationAction} className="mt-3">
                <input type="hidden" name="id" value={task.id} />
                <button type="submit" className="h-9 rounded-md bg-amber-700 px-3 text-sm font-semibold text-white hover:bg-amber-800">
                  Gửi lại đăng ký
                </button>
              </form>
            </section>
          ) : null}

          <section>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-950">Nhiệm vụ con</h2>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                {childDone}/{childTotal} xong
              </span>
            </div>
            <div className="grid gap-3">
              {task.children.map((child) => (
                <TaskCard key={child.id} task={child} statuses={cardStatuses} compact canUpdate={canUpdate} />
              ))}
              {task.children.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
                  Chưa có nhiệm vụ con.
                </div>
              ) : null}
            </div>
          </section>

          {canManageChildren && referenceData ? (
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <Plus size={16} aria-hidden="true" />
                <h2 className="text-base font-semibold text-slate-950">Thêm nhiệm vụ con</h2>
              </div>
              <ChildTaskForm
                parentId={task.id}
                projectId={task.projectId}
                employees={referenceData.employees}
                statuses={referenceData.statuses}
              />
            </section>
          ) : null}

          {canEditTaskDetails && referenceData ? (
            <section>
              <h2 className="mb-3 text-base font-semibold text-slate-950">Chỉnh sửa nhiệm vụ</h2>
              <TaskForm
                task={task}
                projects={canChooseProject ? referenceData.projects : [task.project]}
                employees={referenceData.employees}
                statuses={referenceData.statuses}
                canChooseProject={canChooseProject}
              />
            </section>
          ) : null}
        </div>

        <aside className="space-y-6">
          {canUpdate ? (
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-950">Bình luận</h2>
              <form action={addCommentAction} className="mt-3 space-y-3">
                <input type="hidden" name="id" value={task.id} />
                <textarea
                  name="body"
                  rows={4}
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                <button
                  type="submit"
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  <MessageSquare size={15} aria-hidden="true" />
                  Thêm bình luận
                </button>
              </form>
            </section>
          ) : null}

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-950">Bình luận gần đây</h2>
            <div className="mt-3 space-y-3">
              {task.comments.map((comment) => (
                <div key={comment.id} className="rounded-md border border-slate-200 p-3">
                  <div className="text-xs text-slate-500">
                    {comment.user.displayName || comment.user.username} - {dateTime(comment.createdAt)}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{comment.body}</p>
                </div>
              ))}
              {task.comments.length === 0 ? <p className="text-sm text-slate-500">Chưa có bình luận.</p> : null}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-950">Lịch sử</h2>
            <div className="mt-3 space-y-3">
              {task.history.map((event) => (
                <div key={event.id} className="rounded-md bg-slate-50 p-3">
                  <div className="text-sm font-medium text-slate-700">{historyActionLabel(event.action)}</div>
                  <div className="text-xs text-slate-500">
                    {event.user.displayName || event.user.username} - {dateTime(event.createdAt)}
                    {event.onBehalfOf
                      ? ` - làm thay ${event.onBehalfOf.displayName || event.onBehalfOf.username}`
                      : ""}
                  </div>
                </div>
              ))}
              {task.history.length === 0 ? <p className="text-sm text-slate-500">Chưa có lịch sử.</p> : null}
            </div>
          </section>

          {canDelete ? (
            <section className="rounded-lg border border-red-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-red-700">Vùng nguy hiểm</h2>
              <form action={deleteTaskAction} className="mt-3">
                <input type="hidden" name="id" value={task.id} />
                <button
                  type="submit"
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700"
                >
                  <Trash2 size={15} aria-hidden="true" />
                  Xóa nhiệm vụ
                </button>
              </form>
            </section>
          ) : null}
        </aside>
      </section>
    </AppShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-800">{value}</dd>
    </div>
  );
}

function ContentBlock({ title, value, empty }: { title: string; value: string; empty: string }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      {value ? (
        <div className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-4 text-sm leading-6 text-slate-700">
          {value}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">{empty}</p>
      )}
    </section>
  );
}

type ApprovalForTimeline = {
  id: string;
  type: TaskApprovalType;
  round: number;
  level: number;
  status: TaskApprovalStatus;
  note: string;
  actedAt: Date | null;
  reviewerId: string;
  reviewer: { id: string; username: string; displayName: string };
  delegatedForId: string | null;
  delegatedFor: { id: string; username: string; displayName: string } | null;
};

function ApprovalTimeline({
  approvals,
  currentApprovalIds,
}: {
  approvals: ApprovalForTimeline[];
  currentApprovalIds: Set<string>;
}) {
  const colors: Record<TaskApprovalStatus, string> = {
    pending: "bg-amber-50 text-amber-700",
    approved: "bg-emerald-50 text-emerald-700",
    rejected: "bg-red-50 text-red-700",
    skipped: "bg-slate-100 text-slate-600",
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold text-slate-950">Phê duyệt</h2>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
          {approvals.length}
        </span>
      </div>
      <div className="grid gap-3">
        {approvals.map((approval) => (
          <div key={approval.id} className="rounded-md border border-slate-200 p-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    {approval.type === "registration" ? "Duyệt đăng ký" : "Duyệt hoàn thành"} vòng {approval.round} / cấp {approval.level}
                  </span>
                  <span className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-semibold ${colors[approval.status]}`}>
                    {approvalStatusLabel(approval.status)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Người duyệt: {approval.reviewer.displayName || approval.reviewer.username}
                  {approval.actedAt ? ` - ${dateTime(approval.actedAt)}` : ""}
                </div>
                {approval.delegatedFor ? (
                  <div className="mt-1 text-xs font-medium text-amber-700">
                    Trợ lý cho {approval.delegatedFor.displayName || approval.delegatedFor.username}
                  </div>
                ) : null}
                {approval.note ? <p className="mt-2 text-sm text-slate-700">{approval.note}</p> : null}
              </div>
              {currentApprovalIds.has(approval.id) ? (
                <div className="grid gap-2 sm:min-w-80">
                  <form action={approveTaskApprovalAction} className="flex gap-2">
                    <input type="hidden" name="approvalId" value={approval.id} />
                    <input name="note" placeholder="Ghi chú" className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm" />
                    <button type="submit" className="h-9 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700">
                      Duyệt
                    </button>
                  </form>
                  <form action={rejectTaskApprovalAction} className="flex gap-2">
                    <input type="hidden" name="approvalId" value={approval.id} />
                    <input name="note" required placeholder="Lý do từ chối" className="h-9 min-w-0 flex-1 rounded-md border border-red-200 px-3 text-sm" />
                    <button type="submit" className="h-9 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50">
                      Từ chối
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {approvals.length === 0 ? <p className="text-sm text-slate-500">Chưa có vòng phê duyệt.</p> : null}
      </div>
    </section>
  );
}

function ChildTaskForm({
  parentId,
  projectId,
  employees,
  statuses,
}: {
  parentId: string;
  projectId: string;
  employees: Awaited<ReturnType<typeof getTaskReferenceData>>["employees"];
  statuses: Awaited<ReturnType<typeof getTaskReferenceData>>["statuses"];
}) {
  const visibleEmployees = employees.filter((employee) =>
    employee.projects.some((scope) => scope.projectId === projectId),
  );

  return (
    <form action={createChildTaskAction} className="grid gap-3 lg:grid-cols-2">
      <input type="hidden" name="parentId" value={parentId} />
      <label className="block lg:col-span-2">
        <span className="text-xs font-semibold uppercase text-slate-500">Tiêu đề</span>
        <input name="title" required className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm" />
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-slate-500">Trạng thái</span>
        <select name="statusId" defaultValue={statuses[0]?.id} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-slate-500">Độ ưu tiên</span>
        <select name="priority" defaultValue="normal" className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">
          {priorities.map((priority) => (
            <option key={priority.value} value={priority.value}>
              {priority.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-slate-500">Ngày bắt đầu</span>
        <input name="startDate" type="date" className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm" />
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-slate-500">Hạn hoàn thành</span>
        <input name="dueDate" type="date" className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm" />
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-slate-500">Thứ tự</span>
        <input name="sortOrder" type="number" defaultValue={100} min={0} max={10000} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm" />
      </label>
      <label className="block lg:col-span-2">
        <span className="text-xs font-semibold uppercase text-slate-500">Mô tả nhiệm vụ con</span>
        <textarea name="description" rows={3} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <div className="lg:col-span-2">
        <div className="text-xs font-semibold uppercase text-slate-500">Người nhận việc</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {visibleEmployees.map((employee) => (
            <label key={employee.id} className="flex min-h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm">
              <input type="checkbox" name="employeeIds" value={employee.id} className="size-4 rounded border-slate-300" />
              <span>{employee.linkedUser?.username ? `${employee.name} (@${employee.linkedUser.username})` : employee.name}</span>
            </label>
          ))}
          {visibleEmployees.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500">
              Chưa có nhân viên thuộc dự án này.
            </div>
          ) : null}
        </div>
      </div>
      <div className="lg:col-span-2">
        <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800">
          <Plus size={16} aria-hidden="true" />
          Thêm nhiệm vụ con
        </button>
      </div>
    </form>
  );
}

function approvalStatusLabel(status: TaskApprovalStatus) {
  const labels: Record<TaskApprovalStatus, string> = {
    pending: "Đang chờ",
    approved: "Đã duyệt",
    rejected: "Từ chối",
    skipped: "Bỏ qua",
  };
  return labels[status];
}

function historyActionLabel(action: string) {
  const labels: Record<string, string> = {
    created: "Tạo nhiệm vụ",
    child_created: "Tạo nhiệm vụ con",
    updated: "Cập nhật nhiệm vụ",
    status_changed: "Đổi trạng thái",
    kanban_moved: "Di chuyển Kanban",
    completed_leaf_task: "Hoàn thành nhiệm vụ",
    completion_submitted: "Gửi duyệt hoàn thành",
    completion_approved_final: "Hoàn thành được duyệt",
    completion_rejected: "Hoàn thành bị từ chối",
    reopened: "Mở lại nhiệm vụ",
    auto_reopened_from_child: "Tự mở lại từ nhiệm vụ con",
    commented: "Thêm bình luận",
    registration_resubmitted: "Gửi lại đăng ký",
    registration_rejected: "Đăng ký bị từ chối",
    recurrence_created: "Tạo nhiệm vụ lặp",
    recurrence_child_created: "Tạo nhiệm vụ con lặp",
    obsidian_imported: "Nhập nhiệm vụ từ Obsidian",
    obsidian_child_imported: "Nhập nhiệm vụ con từ Obsidian",
  };
  return labels[action] ?? action;
}
