import type { RepeatPattern, RepeatUnit, TaskPriority, TaskWorkflowStatus } from "@prisma/client";

import { dateFromKey, dateKey, shortDate } from "@/lib/format";

export const repeatPatterns: Array<{ value: RepeatPattern; label: string }> = [
  { value: "daily", label: "Hàng ngày" },
  { value: "weekdays", label: "Ngày làm việc" },
  { value: "weekly", label: "Theo thứ trong tuần" },
  { value: "monthly", label: "Hàng tháng" },
  { value: "quarterly", label: "Hàng quý" },
  { value: "yearly", label: "Hàng năm" },
];

export const repeatWeekdayOptions = [
  { value: 1, label: "T2" },
  { value: 2, label: "T3" },
  { value: 3, label: "T4" },
  { value: 4, label: "T5" },
  { value: 5, label: "T6" },
  { value: 6, label: "T7" },
  { value: 0, label: "CN" },
] as const;

const weekdayLabels: Map<number, string> = new Map(repeatWeekdayOptions.map((item) => [item.value, item.label]));
const workdays = [1, 2, 3, 4, 5];

export type RecurrenceTaskLike = {
  id: string;
  title: string;
  repeats: boolean;
  repeatEvery: number;
  repeatUnit: RepeatUnit;
  repeatPattern: RepeatPattern;
  repeatWeekdays: unknown;
  repeatEndsAt: Date | string | null;
  repeatNoticeDays: number;
  seriesId: string | null;
  occurrence: Date | string | null;
  startDate?: Date | string | null;
  dueDate?: Date | string | null;
  workflowStatus: TaskWorkflowStatus;
  completedAt?: Date | string | null;
  priority?: TaskPriority;
  status: { done: boolean; label?: string; color?: string };
  children?: Array<{
    workflowStatus: TaskWorkflowStatus;
    completedAt?: Date | string | null;
    status: { done: boolean };
  }>;
};

export type RecurrenceInstanceMeta = {
  id: string;
  title: string;
  occurrence: Date | string | null;
  dueDate: Date | string | null;
  workflowStatus: TaskWorkflowStatus;
  status: { done: boolean; label?: string; color?: string };
  finalDone: boolean;
  childCount: number;
  childDoneCount: number;
};

export type RecurrenceCardMeta = {
  summary: string;
  noticeDue: boolean;
  overdueCount: number;
  overdueInstances: RecurrenceInstanceMeta[];
};

export function normalizeRepeatWeekdays(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? parseWeekdayString(value)
      : [];

  return Array.from(
    new Set(
      raw
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6),
    ),
  ).sort((left, right) => weekdaySort(left) - weekdaySort(right));
}

export function legacyRepeatUnitForPattern(pattern: RepeatPattern): RepeatUnit {
  if (pattern === "weekly") return "week";
  if (pattern === "monthly" || pattern === "quarterly" || pattern === "yearly") return "month";
  return "day";
}

export function recurrenceSummary(task: Pick<RecurrenceTaskLike, "repeats" | "repeatEvery" | "repeatPattern" | "repeatWeekdays" | "repeatEndsAt" | "repeatNoticeDays" | "occurrence">) {
  if (!task.repeats) return "Không lặp";

  const every = Math.max(1, Math.trunc(task.repeatEvery || 1));
  const prefix = every > 1 ? `Mỗi ${every} ` : "";
  const endsAt = task.repeatEndsAt ? `, đến ${shortDate(task.repeatEndsAt)}` : "";
  const notice = `, báo trước ${Math.max(0, Math.trunc(task.repeatNoticeDays || 0))} ngày`;

  if (task.repeatPattern === "weekdays") return `${prefix}ngày làm việc${notice}${endsAt}`;
  if (task.repeatPattern === "weekly") {
    const weekdays = weekdaysForPattern(task.repeatPattern, task.repeatWeekdays, dateKey(task.occurrence) || dateKey(new Date()));
    const weekdayText = weekdays.map((item) => weekdayLabels.get(item) ?? String(item)).join(", ");
    return `${prefix}tuần vào ${weekdayText}${notice}${endsAt}`;
  }
  if (task.repeatPattern === "monthly") return `${prefix}tháng${notice}${endsAt}`;
  if (task.repeatPattern === "quarterly") return `${prefix}quý${notice}${endsAt}`;
  if (task.repeatPattern === "yearly") return `${prefix}năm${notice}${endsAt}`;
  return `${prefix}ngày${notice}${endsAt}`;
}

export function nextOccurrenceKey(
  current: Date | string | null | undefined,
  options: {
    repeatEvery: number;
    repeatPattern: RepeatPattern;
    repeatWeekdays: unknown;
    anchor?: Date | string | null;
  },
) {
  const currentKey = dateKey(current);
  if (!currentKey) return null;

  const every = Math.max(1, Math.trunc(options.repeatEvery || 1));
  const anchorKey = dateKey(options.anchor) || currentKey;

  if (options.repeatPattern === "weekdays") return addWorkdays(currentKey, every);
  if (options.repeatPattern === "weekly") {
    return nextWeeklyOccurrence(
      currentKey,
      anchorKey,
      every,
      weekdaysForPattern(options.repeatPattern, options.repeatWeekdays, anchorKey),
    );
  }
  if (options.repeatPattern === "monthly") return addMonthsKey(currentKey, every);
  if (options.repeatPattern === "quarterly") return addMonthsKey(currentKey, every * 3);
  if (options.repeatPattern === "yearly") return addMonthsKey(currentKey, every * 12);
  return addDaysKey(currentKey, every);
}

export function recurrencePreviewKeys(options: {
  occurrence: Date | string | null | undefined;
  repeatEvery: number;
  repeatPattern: RepeatPattern;
  repeatWeekdays: unknown;
  count?: number;
}) {
  const keys: string[] = [];
  const firstKey = dateKey(options.occurrence);
  if (!firstKey) return keys;

  keys.push(firstKey);
  let currentKey = firstKey;
  while (keys.length < (options.count ?? 5)) {
    const nextKey = nextOccurrenceKey(currentKey, { ...options, anchor: firstKey });
    if (!nextKey || keys.includes(nextKey)) break;
    keys.push(nextKey);
    currentKey = nextKey;
  }
  return keys;
}

export function isRecurringNoticeDue(task: RecurrenceTaskLike, today: Date = new Date()) {
  if (!task.repeats || isFinalDoneLike(task)) return false;
  const reference = occurrenceReferenceKey(task);
  if (!reference) return false;

  const cutoff = addDaysKey(dateKey(today), Math.max(0, Math.trunc(task.repeatNoticeDays || 0)));
  return Boolean(cutoff && reference <= cutoff);
}

export function buildRecurrenceMetaByTaskId<T extends RecurrenceTaskLike>(tasks: T[], today: Date = new Date()) {
  const result = new Map<string, RecurrenceCardMeta>();
  const groups = new Map<string, T[]>();

  for (const task of tasks) {
    if (!task.repeats) continue;
    result.set(task.id, {
      summary: recurrenceSummary(task),
      noticeDue: isRecurringNoticeDue(task, today),
      overdueCount: 0,
      overdueInstances: [],
    });
    if (task.seriesId) {
      const group = groups.get(task.seriesId) ?? [];
      group.push(task);
      groups.set(task.seriesId, group);
    }
  }

  const todayKey = dateKey(today);
  for (const group of groups.values()) {
    const overdue = group
      .filter((task) => !isFinalDoneLike(task))
      .filter((task) => {
        const reference = occurrenceReferenceKey(task);
        return Boolean(reference && reference < todayKey);
      })
      .sort(compareOccurrenceTasks);

    if (overdue.length < 2) continue;
    const representative = overdue[0];
    const meta = result.get(representative.id);
    if (!meta) continue;
    meta.overdueCount = overdue.length;
    meta.overdueInstances = overdue.map((task) => ({
      id: task.id,
      title: task.title,
      occurrence: task.occurrence,
      dueDate: task.dueDate ?? null,
      workflowStatus: task.workflowStatus,
      status: task.status,
      finalDone: isFinalDoneLike(task),
      childCount: task.children?.length ?? 0,
      childDoneCount: task.children?.filter((child) => isFinalDoneLike(child)).length ?? 0,
    }));
  }

  return result;
}

export function occurrenceReferenceKey(task: {
  occurrence?: Date | string | null;
  dueDate?: Date | string | null;
  startDate?: Date | string | null;
}) {
  return dateKey(task.occurrence) || dateKey(task.dueDate) || dateKey(task.startDate);
}

export function addDaysKey(dateText: string, days: number) {
  const date = dateFromKey(dateText);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

export function addMonthsKey(dateText: string, months: number) {
  const [year, month, day] = dateText.split("-").map(Number);
  if (!year || !month || !day) return null;

  const targetMonthIndex = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = (targetMonthIndex % 12) + 1;
  const clampedDay = Math.min(day, new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate());

  return [
    String(targetYear).padStart(4, "0"),
    String(targetMonth).padStart(2, "0"),
    String(clampedDay).padStart(2, "0"),
  ].join("-");
}

export function daysBetweenKeys(left: string, right: string) {
  const leftDate = dateFromKey(left);
  const rightDate = dateFromKey(right);
  if (!leftDate || !rightDate) return 0;
  return Math.round((rightDate.getTime() - leftDate.getTime()) / 86_400_000);
}

function weekdaysForPattern(pattern: RepeatPattern, repeatWeekdays: unknown, anchorKey: string) {
  if (pattern === "weekdays") return workdays;
  const normalized = normalizeRepeatWeekdays(repeatWeekdays);
  if (normalized.length) return normalized;
  const anchor = dateFromKey(anchorKey);
  return [anchor?.getUTCDay() ?? 1];
}

function parseWeekdayString(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    return value.split(",");
  }
  return value.split(",");
}

function weekdaySort(value: number) {
  return value === 0 ? 7 : value;
}

function addWorkdays(dateText: string, every: number) {
  let current = dateText;
  let remaining = every;
  for (let guard = 0; guard < 3660; guard += 1) {
    const next = addDaysKey(current, 1);
    if (!next) return null;
    current = next;
    const weekday = dateFromKey(current)?.getUTCDay();
    if (weekday && weekday >= 1 && weekday <= 5) remaining -= 1;
    if (remaining === 0) return current;
  }
  return null;
}

function nextWeeklyOccurrence(currentKey: string, anchorKey: string, every: number, weekdays: number[]) {
  const anchorWeekStart = weekStartKey(anchorKey);
  for (let offset = 1; offset <= 3660; offset += 1) {
    const candidate = addDaysKey(currentKey, offset);
    if (!candidate) return null;
    const candidateDate = dateFromKey(candidate);
    if (!candidateDate || !weekdays.includes(candidateDate.getUTCDay())) continue;

    const weeksSinceAnchor = Math.floor(daysBetweenKeys(anchorWeekStart, weekStartKey(candidate)) / 7);
    if (weeksSinceAnchor >= 0 && weeksSinceAnchor % every === 0) return candidate;
  }
  return null;
}

function weekStartKey(dateText: string) {
  const date = dateFromKey(dateText);
  if (!date) return dateText;
  const weekday = date.getUTCDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + diff);
  return dateKey(date);
}

function compareOccurrenceTasks(left: RecurrenceTaskLike, right: RecurrenceTaskLike) {
  return occurrenceReferenceKey(left).localeCompare(occurrenceReferenceKey(right)) || left.title.localeCompare(right.title);
}

function isFinalDoneLike(task: Pick<RecurrenceTaskLike, "workflowStatus">) {
  return task.workflowStatus === "final_done";
}
