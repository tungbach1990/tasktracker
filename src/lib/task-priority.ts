import type { TaskPriority } from "@prisma/client";

export const prioritySortRank: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

type OperationalTask = {
  priority: TaskPriority;
  dueDate?: Date | string | null;
  sortOrder?: number | null;
  updatedAt?: Date | string | null;
  title?: string | null;
};

export function compareOperationalPriority<T extends OperationalTask>(a: T, b: T) {
  return (
    prioritySortRank[a.priority] - prioritySortRank[b.priority] ||
    dateValue(a.dueDate, Number.MAX_SAFE_INTEGER) - dateValue(b.dueDate, Number.MAX_SAFE_INTEGER) ||
    (a.sortOrder ?? 100) - (b.sortOrder ?? 100) ||
    dateValue(b.updatedAt, 0) - dateValue(a.updatedAt, 0) ||
    (a.title ?? "").localeCompare(b.title ?? "")
  );
}

export function isPriorityFocus(priority: TaskPriority) {
  return priority === "urgent" || priority === "high";
}

function dateValue(value: Date | string | null | undefined, fallback: number) {
  if (!value) return fallback;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : fallback;
}
