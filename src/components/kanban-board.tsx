"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TaskPriority } from "@prisma/client";
import { CheckCircle2, Columns3, ExternalLink, MoveRight, RotateCcw } from "lucide-react";

import { CountBadge } from "@/components/badge";
import { kanbanColumnWidth, priorityLabel } from "@/lib/constants";
import { compareOperationalPriority } from "@/lib/task-priority";

type FormAction = (formData: FormData) => Promise<void>;

export type KanbanBoardColumn = {
  columnKey: string;
  columnType: "workflow" | "status";
  label: string;
  enabled: boolean;
  sortOrder: number;
  widthPx: number;
};

export type KanbanBoardTask = {
  id: string;
  title: string;
  priority: TaskPriority;
  dueDate: string | null;
  sortOrder: number;
  updatedAt: string;
  workflowStatus:
    | "active"
    | "pending_registration"
    | "registration_rejected"
    | "pending_completion"
    | "final_done"
    | "completion_rejected";
  createdById: string;
  ownerId: string;
  columnKey: string;
  finalDone: boolean;
  parentId: string | null;
  parentTitle: string | null;
  parentParentId: string | null;
  depthHint: number;
  isParent: boolean;
  childCount: number;
  childDoneCount: number;
};

export type KanbanBoardStatus = {
  id: string;
  key: string;
  label: string;
  ownerId: string;
  done: boolean;
};

type HierarchyMode = "all" | "parents" | "children";

const hierarchyModeOptions: Array<{ value: HierarchyMode; label: string }> = [
  { value: "all", label: "Tất cả" },
  { value: "parents", label: "Nhiệm vụ cha" },
  { value: "children", label: "Nhiệm vụ con" },
];

export function KanbanBoard({
  initialColumns,
  tasks,
  statuses,
  scope,
  canUpdate,
  canViewTeam,
  canViewAll,
  saveLayoutAction,
  markDoneAction,
  reopenAction,
  moveAction,
}: {
  initialColumns: KanbanBoardColumn[];
  tasks: KanbanBoardTask[];
  statuses: KanbanBoardStatus[];
  scope: string;
  canUpdate: boolean;
  canViewTeam: boolean;
  canViewAll: boolean;
  saveLayoutAction: FormAction;
  markDoneAction: FormAction;
  reopenAction: FormAction;
  moveAction: FormAction;
}) {
  const router = useRouter();
  const [columns, setColumns] = useState(initialColumns);
  const [boardTasks, setBoardTasks] = useState(tasks);
  const [resizingKey, setResizingKey] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dropColumnKey, setDropColumnKey] = useState<string | null>(null);
  const [hierarchyMode, setHierarchyMode] = useState<HierarchyMode>("all");
  const [isPending, startTransition] = useTransition();
  const cleanupResizeRef = useRef<() => void>(() => {});

  useEffect(() => {
    setColumns(initialColumns);
  }, [initialColumns]);

  useEffect(() => {
    setBoardTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    return () => cleanupResizeRef.current();
  }, []);

  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.sortOrder - b.sortOrder || a.columnKey.localeCompare(b.columnKey)),
    [columns],
  );
  const visibleColumns = sortedColumns.filter((column) => column.enabled);
  const filteredTasks = useMemo(
    () =>
      boardTasks.filter((task) => {
        if (hierarchyMode === "parents") return task.isParent;
        if (hierarchyMode === "children") return Boolean(task.parentId);
        return true;
      }),
    [boardTasks, hierarchyMode],
  );
  const enabledColumnKeys = useMemo(
    () => new Set(columns.filter((column) => column.enabled).map((column) => column.columnKey)),
    [columns],
  );
  const hiddenTaskCount = filteredTasks.filter((task) => !enabledColumnKeys.has(task.columnKey)).length;
  const taskCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of filteredTasks) {
      counts.set(task.columnKey, (counts.get(task.columnKey) ?? 0) + 1);
    }
    return counts;
  }, [filteredTasks]);
  const draggingTask = draggingTaskId ? boardTasks.find((task) => task.id === draggingTaskId) : null;

  function saveColumnPatch(columnKey: string, patch: { widthPx?: number; enabled?: boolean }) {
    const formData = new FormData();
    formData.set("columnKey", columnKey);
    if (patch.widthPx !== undefined) formData.set("widthPx", String(clampWidth(patch.widthPx)));
    if (patch.enabled !== undefined) formData.set("enabled", patch.enabled ? "true" : "false");

    startTransition(() => {
      void saveLayoutAction(formData);
    });
  }

  function toggleColumn(columnKey: string, enabled: boolean) {
    setColumns((current) =>
      current.map((column) => (column.columnKey === columnKey ? { ...column, enabled } : column)),
    );
    saveColumnPatch(columnKey, { enabled });
  }

  function startColumnResize(event: React.PointerEvent<HTMLButtonElement>, column: KanbanBoardColumn) {
    event.preventDefault();
    cleanupResizeRef.current();

    const startX = event.clientX;
    const startWidth = clampWidth(column.widthPx);
    let latestWidth = startWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setResizingKey(column.columnKey);

    const onMove = (moveEvent: PointerEvent) => {
      latestWidth = clampWidth(startWidth + moveEvent.clientX - startX);
      setColumns((current) =>
        current.map((item) =>
          item.columnKey === column.columnKey ? { ...item, widthPx: latestWidth } : item,
        ),
      );
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onFinish);
      window.removeEventListener("pointercancel", onFinish);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setResizingKey(null);
      cleanupResizeRef.current = () => {};
    };

    const onFinish = () => {
      cleanup();
      saveColumnPatch(column.columnKey, { widthPx: latestWidth });
    };

    cleanupResizeRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onFinish);
    window.addEventListener("pointercancel", onFinish);
  }

  function taskCanDropOnColumn(task: KanbanBoardTask, column: KanbanBoardColumn) {
    if (!canUpdate || task.columnKey === column.columnKey) return false;

    if (column.columnType === "status") {
      if (task.workflowStatus !== "active" && task.workflowStatus !== "pending_completion") {
        return false;
      }

      const statusKey = column.columnKey.replace("status:", "");
      return statuses.some((status) => status.ownerId === task.ownerId && status.key === statusKey && !status.done);
    }

    if (column.columnKey === "workflow:pending_completion" || column.columnKey === "workflow:final_done") {
      if (
        task.finalDone ||
        task.workflowStatus !== "active"
      ) {
        return false;
      }

      return (
        task.childDoneCount === task.childCount &&
        statuses.some((status) => status.ownerId === task.ownerId && status.done)
      );
    }

    return false;
  }

  function moveTaskByDrag(task: KanbanBoardTask, column: KanbanBoardColumn) {
    const nextTask = taskAfterMove(task, column.columnKey);
    setBoardTasks((current) => current.map((item) => (item.id === task.id ? nextTask : item)));

    const formData = new FormData();
    formData.set("id", task.id);
    if (column.columnType === "status") formData.set("columnKey", column.columnKey);

    startTransition(() => {
      void (async () => {
        if (column.columnType === "status") {
          await moveAction(formData);
        } else {
          await markDoneAction(formData);
        }
        router.refresh();
      })();
    });
  }

  function handleTaskDragStart(event: React.DragEvent<HTMLElement>, task: KanbanBoardTask) {
    if (!canUpdate) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    event.dataTransfer.setData("application/x-task-id", task.id);
    setDraggingTaskId(task.id);
  }

  function handleTaskDragEnd() {
    setDraggingTaskId(null);
    setDropColumnKey(null);
  }

  function handleColumnDragOver(event: React.DragEvent<HTMLElement>, column: KanbanBoardColumn) {
    if (!draggingTask || !taskCanDropOnColumn(draggingTask, column)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropColumnKey(column.columnKey);
  }

  function handleColumnDragLeave(event: React.DragEvent<HTMLElement>, column: KanbanBoardColumn) {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    setDropColumnKey((current) => (current === column.columnKey ? null : current));
  }

  function handleColumnDrop(event: React.DragEvent<HTMLElement>, column: KanbanBoardColumn) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("application/x-task-id") || event.dataTransfer.getData("text/plain") || draggingTaskId;
    const task = boardTasks.find((item) => item.id === taskId);
    setDraggingTaskId(null);
    setDropColumnKey(null);

    if (!task || !taskCanDropOnColumn(task, column)) return;
    moveTaskByDrag(task, column);
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-100">
      <div className="shrink-0 border-b border-slate-200 bg-slate-100 px-4 py-3 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-normal text-slate-950">Kanban</h1>
            <p className="mt-1 text-sm text-slate-500">Sắp xếp nhiệm vụ theo cột tùy biến của riêng bạn.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <form action="/kanban" method="get" className="flex items-center gap-2">
              <select
                name="scope"
                defaultValue={scope}
                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="">Có thể xem</option>
                <option value="own">Của tôi</option>
                <option value="assigned">Giao cho tôi</option>
                {canViewTeam ? <option value="team">Đội nhóm</option> : null}
                {canViewAll ? <option value="all">Tất cả</option> : null}
              </select>
              <button
                type="submit"
                className="h-9 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Lọc
              </button>
            </form>

            <div className="inline-flex h-9 overflow-hidden rounded-md border border-slate-300 bg-white">
              {hierarchyModeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setHierarchyMode(option.value)}
                  className={
                    hierarchyMode === option.value
                      ? "bg-slate-950 px-3 text-sm font-semibold text-white"
                      : "px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>

            <details className="relative">
              <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                <Columns3 size={16} aria-hidden="true" />
                Cột
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-80 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
                <div className="max-h-[min(60vh,420px)] overflow-y-auto pr-1">
                  {sortedColumns.map((column) => (
                    <label
                      key={column.columnKey}
                      className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={column.enabled}
                        onChange={(event) => toggleColumn(column.columnKey, event.target.checked)}
                        className="mt-0.5 size-4 rounded border-slate-300"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-slate-800">{column.label}</span>
                        <span className="block truncate text-xs text-slate-500">{column.columnKey}</span>
                      </span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-500">
                        {taskCounts.get(column.columnKey) ?? 0}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </details>

            <Link
              href="/settings/kanban"
              className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cài đặt
            </Link>

            {hiddenTaskCount > 0 ? (
              <div className="inline-flex h-9 items-center rounded-md bg-amber-50 px-3 text-sm font-semibold text-amber-800">
                Đang ẩn: {hiddenTaskCount}
              </div>
            ) : null}
            {isPending ? <div className="text-xs font-medium text-slate-500">Đang lưu...</div> : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-3 lg:p-4">
        <div className="h-full min-h-0 overflow-auto">
          <div className="flex h-full min-w-full w-max gap-3">
            {visibleColumns.map((column) => {
              const widthPx = clampWidth(column.widthPx);
              const columnTasks = sortColumnTasks(
                filteredTasks.filter((task) => task.columnKey === column.columnKey),
              );
              const isDropTarget = dropColumnKey === column.columnKey;

              return (
                <section
                  key={column.columnKey}
                  data-kanban-column-key={column.columnKey}
                  onDragOver={(event) => handleColumnDragOver(event, column)}
                  onDragLeave={(event) => handleColumnDragLeave(event, column)}
                  onDrop={(event) => handleColumnDrop(event, column)}
                  className={
                    isDropTarget
                      ? "flex h-full shrink-0 flex-col overflow-hidden rounded-lg border border-blue-300 bg-blue-50/60"
                      : "flex h-full shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                  }
                  style={{ width: widthPx, minWidth: widthPx, maxWidth: widthPx }}
                >
                  <div className="relative shrink-0 border-b border-slate-200 bg-white px-3 py-2 pr-5">
                    <div className="flex min-h-8 items-center justify-between gap-2">
                      <h2 className="min-w-0 truncate text-sm font-semibold text-slate-950">{column.label}</h2>
                      <CountBadge>{columnTasks.length}</CountBadge>
                    </div>
                    <button
                      type="button"
                      aria-label={`Đổi độ rộng ${column.label}`}
                      title="Đổi độ rộng cột"
                      onPointerDown={(event) => startColumnResize(event, column)}
                      className="absolute inset-y-0 right-0 flex w-3 touch-none cursor-col-resize items-center justify-center rounded-r-lg text-slate-300 hover:bg-blue-50 hover:text-blue-500"
                    >
                      <span
                        className={
                          resizingKey === column.columnKey
                            ? "h-8 w-1 rounded-full bg-blue-500"
                            : "h-8 w-0.5 rounded-full bg-current"
                        }
                      />
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-2 pr-1">
                    <div className="grid gap-2 pr-1">
                      {columnTasks.map((task) => (
                        <KanbanTaskCard
                          key={task.id}
                          task={task}
                          statuses={statuses}
                          canUpdate={canUpdate}
                          dragging={draggingTaskId === task.id}
                          markDoneAction={markDoneAction}
                          reopenAction={reopenAction}
                          moveAction={moveAction}
                          onDragStart={handleTaskDragStart}
                          onDragEnd={handleTaskDragEnd}
                        />
                      ))}
                      {columnTasks.length === 0 ? (
                        <div className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                          Không có nhiệm vụ.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </section>
              );
            })}

            {visibleColumns.length === 0 ? (
              <div className="flex h-full min-w-[320px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                Tất cả cột đang bị ẩn. Mở Cột để bật lại.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function KanbanTaskCard({
  task,
  statuses,
  canUpdate,
  dragging,
  markDoneAction,
  reopenAction,
  moveAction,
  onDragStart,
  onDragEnd,
}: {
  task: KanbanBoardTask;
  statuses: KanbanBoardStatus[];
  canUpdate: boolean;
  dragging: boolean;
  markDoneAction: FormAction;
  reopenAction: FormAction;
  moveAction: FormAction;
  onDragStart: (event: React.DragEvent<HTMLElement>, task: KanbanBoardTask) => void;
  onDragEnd: () => void;
}) {
  const canQuickDone =
    canUpdate &&
    !task.finalDone &&
    task.workflowStatus === "active" &&
    task.childDoneCount === task.childCount;
  const canReopen = canUpdate && (task.finalDone || task.workflowStatus === "pending_completion" || task.workflowStatus === "completion_rejected");
  const canMove = canUpdate && !task.finalDone && (task.workflowStatus === "active" || task.workflowStatus === "pending_completion");
  const ownerOpenStatuses = statuses.filter((status) => status.ownerId === task.ownerId && !status.done);
  const isChild = Boolean(task.parentId);
  const isParent = task.isParent || task.childCount > 0;
  const hierarchyLabel = isChild && isParent ? "Con / Cha" : isChild ? "Con" : isParent ? "Cha" : null;

  return (
    <article
      data-task-id={task.id}
      draggable={canUpdate}
      onDragStart={(event) => onDragStart(event, task)}
      onDragEnd={onDragEnd}
      aria-grabbed={dragging}
      className={[
        "relative overflow-hidden rounded-md border bg-white p-2.5 shadow-sm",
        isChild ? "border-slate-200 border-l-4 border-l-blue-300" : isParent ? "border-slate-300" : "border-slate-200",
        kanbanChildIndentClass(task.depthHint),
        dragging ? "cursor-grabbing opacity-60" : canUpdate ? "cursor-grab active:cursor-grabbing" : "",
      ].join(" ")}
    >
      <span
        className={priorityStripClass(task.priority)}
        title={`Độ ưu tiên: ${priorityLabel(task.priority)}`}
        aria-hidden="true"
      />
      <Link
        href={`/tasks/${task.id}`}
        className="block min-w-0 whitespace-normal pl-1 text-sm font-semibold leading-5 text-slate-950 [overflow-wrap:anywhere] hover:text-blue-700"
      >
        {task.title}
      </Link>

      {hierarchyLabel || isParent ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-1 text-[11px] font-semibold">
          {hierarchyLabel ? (
            <span
              className={
                isChild
                  ? "rounded bg-blue-50 px-1.5 py-0.5 text-blue-700 ring-1 ring-blue-100"
                  : "rounded bg-slate-100 px-1.5 py-0.5 text-slate-700"
              }
            >
              {hierarchyLabel}
            </span>
          ) : null}
          {task.depthHint > 1 ? (
            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 ring-1 ring-indigo-100">
              Cấp {task.depthHint}
            </span>
          ) : null}
          {isParent ? (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 ring-1 ring-emerald-100">
              {task.childDoneCount}/{task.childCount} nhiệm vụ con xong
            </span>
          ) : null}
        </div>
      ) : null}

      {task.parentId && task.parentTitle ? (
        <div className="mt-1 min-w-0 pl-1 text-xs text-slate-500">
          Thuộc:{" "}
          <Link
            href={`/tasks/${task.parentId}`}
            className="font-medium text-slate-700 [overflow-wrap:anywhere] hover:text-blue-700"
          >
            {task.parentTitle}
          </Link>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Link
          href={`/tasks/${task.id}`}
          className="inline-flex size-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          title="Mở"
        >
          <ExternalLink size={13} aria-hidden="true" />
          <span className="sr-only">Mở</span>
        </Link>
        {canQuickDone ? (
          <form action={markDoneAction}>
            <input type="hidden" name="id" value={task.id} />
            <button
              type="submit"
              className="inline-flex size-7 items-center justify-center rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
              title={task.childCount ? "Gửi hoàn thành" : "Hoàn thành"}
            >
              <CheckCircle2 size={13} aria-hidden="true" />
              <span className="sr-only">{task.childCount ? "Gửi hoàn thành" : "Hoàn thành"}</span>
            </button>
          </form>
        ) : null}
        {canReopen ? (
          <form action={reopenAction}>
            <input type="hidden" name="id" value={task.id} />
            <button
              type="submit"
              className="inline-flex size-7 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              title="Mở lại"
            >
              <RotateCcw size={13} aria-hidden="true" />
              <span className="sr-only">Mở lại</span>
            </button>
          </form>
        ) : null}
        {canMove && ownerOpenStatuses.length ? (
          <details className="relative">
            <summary
              className="inline-flex size-7 cursor-pointer list-none items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 [&::-webkit-details-marker]:hidden"
              title="Di chuyển"
            >
              <MoveRight size={13} aria-hidden="true" />
              <span className="sr-only">Di chuyển</span>
            </summary>
            <div className="absolute left-0 z-20 mt-2 w-48 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
              {ownerOpenStatuses.map((status) => (
                <form key={status.id} action={moveAction}>
                  <input type="hidden" name="id" value={task.id} />
                  <input type="hidden" name="columnKey" value={`status:${status.key}`} />
                  <button
                    type="submit"
                    className="block w-full rounded px-2 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {status.label}
                  </button>
                </form>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </article>
  );
}

function taskAfterMove(task: KanbanBoardTask, columnKey: string): KanbanBoardTask {
  if (columnKey === "workflow:pending_completion") {
    return { ...task, columnKey, workflowStatus: "pending_completion", finalDone: false };
  }

  if (columnKey === "workflow:final_done") {
    return { ...task, columnKey, workflowStatus: "final_done", finalDone: true };
  }

  if (columnKey.startsWith("status:")) {
    return { ...task, columnKey, workflowStatus: "active", finalDone: false };
  }

  return { ...task, columnKey };
}

function sortColumnTasks(tasks: KanbanBoardTask[]) {
  const sorted = [...tasks].sort(compareOperationalPriority);
  const byId = new Map(sorted.map((task) => [task.id, task]));
  const childrenByParentId = new Map<string, KanbanBoardTask[]>();

  for (const task of sorted) {
    if (!task.parentId) continue;
    const parent = byId.get(task.parentId);
    if (!parent || parent.columnKey !== task.columnKey) continue;
    const siblings = childrenByParentId.get(task.parentId) ?? [];
    siblings.push(task);
    childrenByParentId.set(task.parentId, siblings);
  }

  for (const siblings of childrenByParentId.values()) {
    siblings.sort(compareOperationalPriority);
  }

  const result: KanbanBoardTask[] = [];
  const emitted = new Set<string>();

  function emit(task: KanbanBoardTask) {
    if (emitted.has(task.id)) return;
    emitted.add(task.id);
    result.push(task);
    for (const child of childrenByParentId.get(task.id) ?? []) {
      emit(child);
    }
  }

  for (const task of sorted) {
    if (emitted.has(task.id)) continue;
    const parent = task.parentId ? byId.get(task.parentId) : null;
    if (parent && parent.columnKey === task.columnKey && !emitted.has(parent.id)) continue;
    emit(task);
  }

  for (const task of sorted) {
    emit(task);
  }

  return result;
}

function kanbanChildIndentClass(depthHint: number) {
  if (depthHint > 1) return "ml-5";
  if (depthHint > 0) return "ml-3";
  return "";
}

function clampWidth(value: number) {
  if (!Number.isFinite(value)) return kanbanColumnWidth.default;
  return Math.min(kanbanColumnWidth.max, Math.max(kanbanColumnWidth.min, Math.trunc(value)));
}

function priorityStripClass(priority: TaskPriority) {
  if (priority === "urgent") return "absolute inset-y-0 left-0 w-1 bg-red-500";
  if (priority === "high") return "absolute inset-y-0 left-0 w-1 bg-orange-400";
  if (priority === "normal") return "absolute inset-y-0 left-0 w-1 bg-slate-300";
  return "absolute inset-y-0 left-0 w-1 bg-slate-200";
}
