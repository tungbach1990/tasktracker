import type { RepeatUnit, TaskPriority, TaskStatusOption } from "@prisma/client";

import { priorityLabel } from "@/lib/constants";

export function dateInputValue(date?: Date | string | null) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

export function shortDate(date?: Date | string | null) {
  if (!date) return "Không có ngày";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}

export function dateTime(date?: Date | string | null) {
  if (!date) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function statusTag(status: Pick<TaskStatusOption, "key">) {
  return `#status/${status.key}`;
}

export function priorityTag(priority: TaskPriority) {
  return `#priority/${priority}`;
}

export function taskPriorityText(priority: TaskPriority) {
  return priorityLabel(priority);
}

export function isOverdue(status: Pick<TaskStatusOption, "done">, dueDate?: Date | null) {
  if (!dueDate || status.done) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

export function isDueToday(status: Pick<TaskStatusOption, "done">, dueDate?: Date | null) {
  if (!dueDate || status.done) return false;
  const today = new Date().toISOString().slice(0, 10);
  return new Date(dueDate).toISOString().slice(0, 10) === today;
}

export function dateKey(date?: Date | string | null) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

export function parseDueHistory(history: unknown) {
  if (!Array.isArray(history)) return [];

  return history
    .map((value) => (typeof value === "string" ? value : ""))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function dueExtendMetrics(history: unknown, dueDate?: Date | string | null) {
  const timeline = [...parseDueHistory(history), dateKey(dueDate)].filter(Boolean);
  if (timeline.length === 0) {
    return { shouldShow: false, days: 0, count: 0, timeline };
  }

  const original = timeline[0];
  const current = timeline[timeline.length - 1];
  const days = Math.max(0, daysBetween(original, current));
  const count = timeline.reduce((total, item, index) => {
    if (index === 0) return total;
    return total + (daysBetween(timeline[index - 1], item) > 0 ? 1 : 0);
  }, 0);

  return {
    shouldShow: timeline.length > 1 || days > 0,
    days,
    count,
    timeline,
  };
}

function daysBetween(left: string, right: string) {
  const leftTime = new Date(`${left}T00:00:00.000Z`).getTime();
  const rightTime = new Date(`${right}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return 0;
  return Math.round((rightTime - leftTime) / 86_400_000);
}

export function addInterval(date: Date | string | null | undefined, every: number, unit: RepeatUnit) {
  const key = dateKey(date);
  if (!key) return null;
  const normalizedEvery = Math.max(1, Math.trunc(every));

  if (unit === "day") return addDays(key, normalizedEvery);
  if (unit === "week") return addDays(key, normalizedEvery * 7);
  return addMonths(key, normalizedEvery);
}

export function dateFromKey(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(dateText: string, days: number) {
  const date = dateFromKey(dateText);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

function addMonths(dateText: string, months: number) {
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
