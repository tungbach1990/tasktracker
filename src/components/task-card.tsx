import type { Employee, Project, Task, TaskEmployee, TaskStatusOption } from "@prisma/client";
import Link from "next/link";
import {
  Archive,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleArrowRight,
  Folder,
  GitBranch,
  Repeat2,
  RotateCcw,
  UserRound,
} from "lucide-react";

import { archiveTaskAction, changeTaskStatusAction, markTaskDoneAction, reopenTaskAction, updateTaskDueAction } from "@/app/actions/tasks";
import { PriorityBadge, StatusBadge } from "@/components/badge";
import { isTaskFinalDone } from "@/lib/approvals";
import { workflowStatusLabels } from "@/lib/constants";
import { dateInputValue, dueExtendMetrics, isOverdue, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type ChildTaskForCard = Pick<Task, "id" | "workflowStatus" | "completedAt"> &
  Partial<Pick<Task, "title" | "priority" | "dueDate">> & {
    status: Pick<TaskStatusOption, "done"> & Partial<Pick<TaskStatusOption, "label" | "color">>;
    employees?: Array<TaskEmployee & { employee: Employee }>;
    children?: Array<Pick<Task, "id" | "workflowStatus" | "completedAt"> & { status: Pick<TaskStatusOption, "done"> }>;
  };

type TaskWithProject = Task & {
  project: Project;
  status: TaskStatusOption;
  performer?: { username: string; displayName: string } | null;
  createdBy?: { username: string; displayName: string } | null;
  parent?: Pick<Task, "id" | "title"> | null;
  recurringTask?: { id: string; title: string } | null;
  children?: ChildTaskForCard[];
  employees: Array<TaskEmployee & { employee: Employee }>;
};

export function TaskCard({
  task,
  statuses = [],
  compact = false,
  canUpdate = false,
  canArchive = false,
  teamRollupLabel,
}: {
  task: TaskWithProject;
  statuses?: TaskStatusOption[];
  compact?: boolean;
  canUpdate?: boolean;
  canArchive?: boolean;
  teamRollupLabel?: string;
}) {
  const nextStatus = nextTaskStatus(task.statusId, statuses);
  const finalDone = isTaskFinalDone(task);
  const overdue = !finalDone && isOverdue(task.status, task.dueDate);
  const childTotal = task.children?.length ?? 0;
  const childDone = task.children?.filter((child) => isTaskFinalDone(child)).length ?? 0;
  const extend = dueExtendMetrics(task.dueHistory, task.dueDate);
  const canQuickDone = canUpdate && !finalDone && task.workflowStatus === "active" && childDone === childTotal;

  return (
    <article
      className={cn(
        "rounded-lg border bg-white p-4 shadow-sm",
        overdue ? "border-red-200" : "border-slate-200",
        priorityCardClass(task.priority),
      )}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <Link
            href={`/tasks/${task.id}`}
            className="block truncate text-sm font-semibold text-slate-950 hover:text-blue-700"
          >
            {task.title}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {task.parent ? (
              <Link href={`/tasks/${task.parent.id}`} className="inline-flex items-center gap-1 hover:text-blue-700">
                <GitBranch size={13} aria-hidden="true" />
                Nhiệm vụ cha: {task.parent.title}
              </Link>
            ) : childTotal ? (
              <span className="inline-flex items-center gap-1">
                <GitBranch size={13} aria-hidden="true" />
                Nhiệm vụ cha
              </span>
            ) : null}
            {childTotal ? <span>{childDone}/{childTotal} nhiệm vụ con xong</span> : null}
          </div>
          {!compact && task.description ? (
            <p className="mt-1 line-clamp-2 text-sm text-slate-500">{task.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={task.status} />
          {task.workflowStatus !== "active" ? <WorkflowBadge workflowStatus={task.workflowStatus} /> : null}
          <PriorityBadge priority={task.priority} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-100 px-2">
          <Folder size={14} aria-hidden="true" />
          {task.project.name}
        </span>
        <span
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-2",
            overdue ? "bg-red-50 text-red-700" : "bg-slate-100",
          )}
        >
          <CalendarDays size={14} aria-hidden="true" />
          {shortDate(task.dueDate)}
        </span>
        {extend.shouldShow ? (
          <span
            className="inline-flex h-7 items-center rounded-md bg-amber-50 px-2 text-amber-800"
            title={extend.timeline.join(" -> ")}
          >
            Gia hạn: +{extend.days} ngày / {extend.count} lần
          </span>
        ) : null}
        {task.recurringTask ? (
          <span
            className="inline-flex h-7 items-center gap-1 rounded-md bg-sky-50 px-2 text-sky-700"
            title={task.recurringTask.title}
          >
            <Repeat2 size={14} aria-hidden="true" />
            Từ nhiệm vụ thường xuyên
          </span>
        ) : null}
        {teamRollupLabel ? (
          <span className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-100 px-2">
            <UserRound size={14} aria-hidden="true" />
            Quản lý trực tiếp: {teamRollupLabel}
          </span>
        ) : (
          <span className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-100 px-2">
            <UserRound size={14} aria-hidden="true" />
            {task.employees.length ? task.employees.map((item) => item.employee.name).join(", ") : "Chưa gán"}
          </span>
        )}
      </div>

      {childTotal ? (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase text-slate-500">Nhiệm vụ con</span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              {childDone}/{childTotal} xong
            </span>
          </div>
          <div className="grid gap-2">
            {task.children?.map((child) => (
              <ChildTaskRow key={child.id} child={child} canUpdate={canUpdate} teamRollupLabel={teamRollupLabel} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {canUpdate ? (
          <form action={updateTaskDueAction} className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700">
            <input type="hidden" name="id" value={task.id} />
            <CalendarDays size={14} aria-hidden="true" />
            <input
              type="date"
              name="dueDate"
              defaultValue={dateInputValue(task.dueDate)}
              className="h-6 bg-transparent text-xs outline-none"
              title="Cập nhật hạn hoàn thành"
            />
            <button type="submit" className="font-medium hover:text-blue-700">
              Lưu hạn
            </button>
          </form>
        ) : null}
        <Link
          href={`/tasks/${task.id}`}
          className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <CircleArrowRight size={14} aria-hidden="true" />
          Mở
        </Link>
        {canUpdate && (finalDone || task.workflowStatus === "pending_completion" || task.workflowStatus === "completion_rejected") ? (
          <form action={reopenTaskAction}>
            <input type="hidden" name="id" value={task.id} />
            <button
              type="submit"
              className="inline-flex h-8 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
            >
              <RotateCcw size={14} aria-hidden="true" />
              Mở lại
            </button>
          </form>
        ) : null}
        {canQuickDone ? (
          <form action={markTaskDoneAction}>
            <input type="hidden" name="id" value={task.id} />
            <button
              type="submit"
              className="inline-flex h-8 items-center gap-2 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-700"
            >
              <CheckCircle2 size={14} aria-hidden="true" />
              {childTotal ? "Gửi hoàn thành" : "Hoàn thành"}
            </button>
          </form>
        ) : null}
        {canArchive && finalDone ? (
          <form action={archiveTaskAction}>
            <input type="hidden" name="id" value={task.id} />
            <button
              type="submit"
              className="inline-flex h-8 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-800 hover:bg-amber-100"
              title="Lưu trữ nhiệm vụ đã hoàn thành"
            >
              <Archive size={14} aria-hidden="true" />
              Lưu trữ
            </button>
          </form>
        ) : null}
        {canUpdate && !task.status.done && task.workflowStatus === "active" && nextStatus ? (
          <form action={changeTaskStatusAction}>
            <input type="hidden" name="id" value={task.id} />
            <input type="hidden" name="statusId" value={nextStatus.id} />
            <button
              type="submit"
              className="inline-flex h-8 items-center gap-2 rounded-md bg-slate-950 px-3 text-xs font-medium text-white hover:bg-slate-800"
            >
              <Check size={14} aria-hidden="true" />
              Tiếp theo
            </button>
          </form>
        ) : null}
      </div>
    </article>
  );
}

function ChildTaskRow({
  child,
  canUpdate,
  teamRollupLabel,
}: {
  child: ChildTaskForCard;
  canUpdate: boolean;
  teamRollupLabel?: string;
}) {
  const finalDone = isTaskFinalDone(child);
  const directChildTotal = child.children?.length ?? 0;
  const directChildDone = child.children?.filter((item) => isTaskFinalDone(item)).length ?? 0;
  const canQuickDone = canUpdate && !finalDone && child.workflowStatus === "active" && directChildDone === directChildTotal;
  const status = {
    label: child.status.label ?? (child.status.done ? "Đã xong" : "Mở"),
    color: child.status.color ?? (child.status.done ? "emerald" : "slate"),
    done: child.status.done,
  };
  const overdue = !finalDone && isOverdue(status, child.dueDate);
  const employees = child.employees ?? [];
  const employeeNames = employees.length ? employees.map((item) => item.employee.name).join(", ") : "Chưa gán";

  return (
    <div
      className={cn(
        "grid gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 sm:grid-cols-[1fr_auto] sm:items-center",
        child.priority ? priorityChildClass(child.priority) : "",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/tasks/${child.id}`} className="truncate text-sm font-medium text-slate-900 hover:text-blue-700">
            {child.title ?? "Nhiệm vụ con"}
          </Link>
          <span
            className={cn(
              "inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold",
              childTaskStateClass(child, finalDone),
            )}
          >
            {childTaskStateLabel(child, finalDone)}
          </span>
          {child.workflowStatus !== "active" ? <WorkflowBadge workflowStatus={child.workflowStatus} /> : null}
          {directChildTotal ? (
            <span className="text-xs text-slate-500">
              {directChildDone}/{directChildTotal} con xong
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
          <span className={cn("inline-flex items-center gap-1", overdue ? "text-red-700" : "")}>
            <CalendarDays size={13} aria-hidden="true" />
            {shortDate(child.dueDate)}
          </span>
          <span className="inline-flex items-center gap-1">
            <UserRound size={13} aria-hidden="true" />
            {teamRollupLabel ? `Quản lý trực tiếp: ${teamRollupLabel}` : employeeNames}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {canQuickDone ? (
          <form action={markTaskDoneAction}>
            <input type="hidden" name="id" value={child.id} />
            <button
              type="submit"
              className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2 text-xs font-semibold text-white hover:bg-emerald-700"
              title={directChildTotal ? "Gửi hoàn thành" : "Hoàn thành"}
            >
              <CheckCircle2 size={13} aria-hidden="true" />
              {directChildTotal ? "Gửi xong" : "Xong"}
            </button>
          </form>
        ) : null}
        <StatusBadge status={status} />
        {child.priority ? <PriorityBadge priority={child.priority} /> : null}
      </div>
    </div>
  );
}

function WorkflowBadge({ workflowStatus }: { workflowStatus: Task["workflowStatus"] }) {
  const colors: Record<Task["workflowStatus"], string> = {
    active: "bg-slate-100 text-slate-700",
    pending_registration: "bg-amber-50 text-amber-700",
    registration_rejected: "bg-red-50 text-red-700",
    pending_completion: "bg-blue-100 text-blue-800 ring-1 ring-blue-200",
    final_done: "bg-emerald-50 text-emerald-700",
    completion_rejected: "bg-red-50 text-red-700",
  };

  return (
    <span className={cn("inline-flex h-6 items-center rounded-md px-2 text-xs font-semibold", colors[workflowStatus])}>
      {workflowStatus === "pending_completion" ? "Chờ phê duyệt" : workflowStatusLabels[workflowStatus]}
    </span>
  );
}

function childTaskStateLabel(child: Pick<Task, "workflowStatus">, finalDone: boolean) {
  if (finalDone) return "Đã xong";
  if (child.workflowStatus === "pending_completion") return "Chờ duyệt hoàn thành";
  if (child.workflowStatus === "completion_rejected") return "Cần làm lại";
  if (child.workflowStatus === "pending_registration") return "Chờ duyệt đăng ký";
  if (child.workflowStatus === "registration_rejected") return "Cần gửi lại";
  return "Đang mở";
}

function childTaskStateClass(child: Pick<Task, "workflowStatus">, finalDone: boolean) {
  if (finalDone) return "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200";
  if (child.workflowStatus === "pending_completion") return "bg-blue-100 text-blue-800 ring-1 ring-blue-200";
  if (child.workflowStatus === "completion_rejected") return "bg-red-50 text-red-700 ring-1 ring-red-200";
  if (child.workflowStatus === "pending_registration") return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  if (child.workflowStatus === "registration_rejected") return "bg-red-50 text-red-700 ring-1 ring-red-200";
  return "bg-white text-slate-600";
}

function nextTaskStatus(statusId: string, statuses: TaskStatusOption[]) {
  const index = statuses.findIndex((item) => item.id === statusId);
  if (index < 0 || index >= statuses.length - 1) return null;
  const current = statuses[index];
  return statuses.slice(index + 1).find((item) => item.ownerId === current.ownerId) ?? null;
}

function priorityCardClass(priority: Task["priority"]) {
  if (priority === "urgent") return "border-l-4 border-l-red-500";
  if (priority === "high") return "border-l-4 border-l-orange-400";
  return "";
}

function priorityChildClass(priority: Task["priority"]) {
  if (priority === "urgent") return "border-l-4 border-l-red-500 bg-red-50/40";
  if (priority === "high") return "border-l-4 border-l-orange-400 bg-orange-50/40";
  return "";
}
