import { KanbanColumnType, RepeatPattern, TaskKind, TaskPriority } from "@prisma/client";
import { z } from "zod";

import { slugifyKey, statusColors } from "@/lib/constants";

export const idSchema = z.string().min(1);

export const taskFormSchema = z.object({
  title: z.string().trim().min(1, "Cần nhập tiêu đề").max(180),
  description: z.string().trim().max(5000).optional().default(""),
  result: z.string().trim().max(5000).optional().default(""),
  feedback: z.string().trim().max(5000).optional().default(""),
  kind: z.nativeEnum(TaskKind).default(TaskKind.assigned),
  parentId: z.string().optional().default(""),
  projectId: z.string().optional().default(""),
  statusId: z.string().min(1),
  priority: z.nativeEnum(TaskPriority),
  startDate: z.string().optional().default(""),
  dueDate: z.string().optional().default(""),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(100),
  employeeIds: z.array(z.string()).default([]),
});

export const childTaskFormSchema = taskFormSchema
  .omit({
    kind: true,
    projectId: true,
  })
  .extend({
    parentId: z.string().min(1),
  });

export const recurringTaskFormSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1, "Cần nhập tiêu đề").max(180),
  description: z.string().trim().max(5000).optional().default(""),
  projectId: z.string().optional().default(""),
  priority: z.nativeEnum(TaskPriority),
  repeatEvery: z.coerce.number().int().min(1).max(365).default(1),
  repeatPattern: z.nativeEnum(RepeatPattern).default(RepeatPattern.daily),
  repeatWeekdays: z.array(z.coerce.number().int().min(0).max(6)).default([]),
  firstOccurrence: z.string().min(1, "Cần chọn ngày bắt đầu chu kỳ"),
  durationDays: z.coerce.number().int().min(1).max(3650).default(1),
  repeatNoticeDays: z.coerce.number().int().min(0).max(365).default(7),
  repeatEndsAt: z.string().optional().default(""),
  active: z.boolean().default(true),
  employeeIds: z.array(z.string()).default([]),
});

export const userFormSchema = z.object({
  username: z.string().trim().min(2).max(64),
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(8),
  enabled: z.boolean().default(true),
  roleIds: z.array(z.string()).default([]),
  projectIds: z.array(z.string()).default([]),
});

export const updateUserFormSchema = userFormSchema.omit({ password: true }).extend({
  id: z.string().min(1),
});

export const resetPasswordSchema = z.object({
  id: z.string().min(1),
  password: z.string().min(8),
});

export const directReportUserFormSchema = z.object({
  username: z.string().trim().min(2).max(64),
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(8),
});

export const roleFormSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional().default(""),
  permissionIds: z.array(z.string()).default([]),
});

export const projectFormSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  key: z.string().trim().max(64).optional().default(""),
  description: z.string().trim().max(1000).optional().default(""),
});

export const statusFormSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().min(1).max(80),
  key: z.string().trim().max(64).optional().default(""),
  color: z.enum(statusColors).default("slate"),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(100),
  done: z.boolean().default(false),
});

export const dashboardSectionFormSchema = z.object({
  sectionKey: z.string().min(1),
  label: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(10000),
  upcomingDays: z.coerce.number().int().min(1).max(365).optional(),
  upcomingLimit: z.coerce.number().int().min(1).max(100).optional(),
  sectionLimit: z.coerce.number().int().min(1).max(100).optional(),
  startAfterDays: z.coerce.number().int().min(0).max(365).optional(),
  recentLimit: z.coerce.number().int().min(1).max(100).optional(),
});

export const kanbanColumnFormSchema = z.object({
  columnKey: z.string().min(1).max(120),
  columnType: z.nativeEnum(KanbanColumnType),
  enabled: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(10000),
  widthPx: z.coerce.number().int().min(0).max(10000),
});

export const employeeLinkResponseSchema = z.object({
  relationId: z.string().min(1),
  decision: z.enum(["approve", "decline"]),
});

export const existingReportRequestSchema = z.object({
  reportId: z.string().min(1),
});

export const teamRelationFormSchema = z.object({
  id: z.string().optional(),
  managerId: z.string().min(1),
  reportId: z.string().min(1),
  status: z.enum(["pending", "confirmed", "rejected", "admin_confirmed"]),
});

export const transferDirectReportFormSchema = z.object({
  managerId: z.string().min(1),
  reportId: z.string().min(1),
});

export const teamDelegationFormSchema = z.object({
  managerId: z.string().min(1),
  assistantId: z.string().min(1),
  projectId: z.string().min(1),
});

export function optionalDate(value: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizedKey(input: string | undefined, fallback: string) {
  return slugifyKey(input || fallback) || slugifyKey(fallback) || "item";
}

export function formArray(formData: FormData, key: string) {
  return formData.getAll(key).map(String).filter(Boolean);
}

export function formBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}
