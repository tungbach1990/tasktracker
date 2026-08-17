import type { RepeatPattern, RepeatUnit } from "@prisma/client";

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

export type RecurringTemplateLike = {
  repeatEvery: number;
  repeatPattern: RepeatPattern;
  repeatWeekdays: unknown;
  firstOccurrence: Date | string | null;
  repeatEndsAt: Date | string | null;
  repeatNoticeDays: number;
  durationDays: number;
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

export function recurringTaskSummary(
  template: Pick<
    RecurringTemplateLike,
    "repeatEvery" | "repeatPattern" | "repeatWeekdays" | "repeatEndsAt" | "repeatNoticeDays" | "firstOccurrence" | "durationDays"
  >,
) {
  const every = Math.max(1, Math.trunc(template.repeatEvery || 1));
  const prefix = every > 1 ? `Mỗi ${every} ` : "";
  const endsAt = template.repeatEndsAt ? `, đến ${shortDate(template.repeatEndsAt)}` : "";
  const notice = `, báo trước ${Math.max(0, Math.trunc(template.repeatNoticeDays || 0))} ngày`;
  const duration = `, thời lượng ${Math.max(0, Math.trunc(template.durationDays || 0))} ngày`;
  const anchorKey = dateKey(template.firstOccurrence) || dateKey(new Date());

  if (template.repeatPattern === "weekdays") return `${prefix}ngày làm việc${duration}${notice}${endsAt}`;
  if (template.repeatPattern === "weekly") {
    const weekdays = weekdaysForPattern(template.repeatPattern, template.repeatWeekdays, anchorKey);
    const weekdayText = weekdays.map((item) => weekdayLabels.get(item) ?? String(item)).join(", ");
    return `${prefix}tuần vào ${weekdayText}${duration}${notice}${endsAt}`;
  }
  if (template.repeatPattern === "monthly") return `${prefix}tháng${duration}${notice}${endsAt}`;
  if (template.repeatPattern === "quarterly") return `${prefix}quý${duration}${notice}${endsAt}`;
  if (template.repeatPattern === "yearly") return `${prefix}năm${duration}${notice}${endsAt}`;
  return `${prefix}ngày${duration}${notice}${endsAt}`;
}

export function recurrenceSummary(task: {
  repeats: boolean;
  repeatEvery: number;
  repeatPattern: RepeatPattern;
  repeatWeekdays: unknown;
  repeatEndsAt: Date | string | null;
  repeatNoticeDays: number;
  occurrence: Date | string | null;
}) {
  if (!task.repeats) return "Không lặp";
  return recurringTaskSummary({
    repeatEvery: task.repeatEvery,
    repeatPattern: task.repeatPattern,
    repeatWeekdays: task.repeatWeekdays,
    repeatEndsAt: task.repeatEndsAt,
    repeatNoticeDays: task.repeatNoticeDays,
    firstOccurrence: task.occurrence,
    durationDays: 0,
  });
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
  firstOccurrence?: Date | string | null | undefined;
  occurrence?: Date | string | null | undefined;
  repeatEvery: number;
  repeatPattern: RepeatPattern;
  repeatWeekdays: unknown;
  count?: number;
}) {
  const keys: string[] = [];
  const firstKey = dateKey(options.firstOccurrence ?? options.occurrence);
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

export function recurrencePreviewRanges(options: {
  firstOccurrence: Date | string | null | undefined;
  repeatEvery: number;
  repeatPattern: RepeatPattern;
  repeatWeekdays: unknown;
  durationDays: number;
  count?: number;
}) {
  return recurrencePreviewKeys(options).map((startKey) => ({
    startKey,
    dueKey: addDaysKey(startKey, Math.max(0, Math.trunc(options.durationDays || 0))) ?? startKey,
  }));
}

export function nextOccurrenceOnOrAfter(template: RecurringTemplateLike, target: Date | string = new Date()) {
  const firstKey = dateKey(template.firstOccurrence);
  const targetKey = dateKey(target);
  const endsKey = dateKey(template.repeatEndsAt);
  if (!firstKey || !targetKey) return null;
  if (endsKey && firstKey > endsKey) return null;
  if (firstKey >= targetKey) return firstKey;

  let currentKey = firstKey;
  for (let guard = 0; guard < 3660; guard += 1) {
    const nextKey = nextOccurrenceKey(currentKey, { ...template, anchor: firstKey });
    if (!nextKey || nextKey === currentKey) return null;
    if (endsKey && nextKey > endsKey) return null;
    if (nextKey >= targetKey) return nextKey;
    currentKey = nextKey;
  }
  return null;
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

export function isRecurringTemplateInNoticeWindow(template: RecurringTemplateLike, today: Date = new Date()) {
  const nextKey = nextOccurrenceOnOrAfter(template, today);
  if (!nextKey) return false;
  const cutoffKey = addDaysKey(dateKey(today), Math.max(0, Math.trunc(template.repeatNoticeDays || 0)));
  return Boolean(cutoffKey && nextKey > dateKey(today) && nextKey <= cutoffKey);
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
  for (let offset = 1; offset <= 3660; offset += 1) {
    const candidate = addDaysKey(currentKey, offset);
    if (!candidate) return null;
    const candidateDate = dateFromKey(candidate);
    if (!candidateDate || !weekdays.includes(candidateDate.getUTCDay())) continue;

    const weeksSinceAnchor = Math.floor(daysBetweenKeys(weekStartKey(anchorKey), weekStartKey(candidate)) / 7);
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
