import type { RepeatUnit, TaskKind, TaskPriority, TaskWorkflowStatus } from "@prisma/client";

export const defaultStatusOptions = [
  { key: "phai-lam", label: "Phải làm", color: "slate", sortOrder: 10, done: false },
  { key: "cho-lam-sau", label: "Chờ làm sau", color: "sky", sortOrder: 20, done: false },
  { key: "dang-lam", label: "Đang làm", color: "blue", sortOrder: 30, done: false },
  { key: "vuong-mac", label: "Vướng mắc", color: "amber", sortOrder: 40, done: false },
  { key: "lam-xong", label: "Làm xong", color: "emerald", sortOrder: 50, done: true },
] as const;

export const defaultDashboardSections = [
  { sectionKey: "metrics", label: "Chỉ số", enabled: true, sortOrder: 10, config: {} },
  { sectionKey: "priority_focus", label: "Ưu tiên cần xử lý", enabled: true, sortOrder: 15, config: { limit: 8 } },
  { sectionKey: "overdue", label: "Quá hạn", enabled: true, sortOrder: 20, config: {} },
  { sectionKey: "today", label: "Hôm nay", enabled: true, sortOrder: 30, config: {} },
  { sectionKey: "upcoming", label: "Sắp tới", enabled: true, sortOrder: 40, config: { days: 7, limit: 8 } },
  { sectionKey: "after_upcoming", label: "Sau khoảng sắp tới", enabled: true, sortOrder: 50, config: { limit: 8 } },
  { sectionKey: "start_after", label: "Chưa tới ngày bắt đầu", enabled: true, sortOrder: 60, config: { days: 0, limit: 8 } },
  { sectionKey: "status_summary", label: "Theo trạng thái", enabled: true, sortOrder: 70, config: {} },
  { sectionKey: "recent_open", label: "Nhiệm vụ mở gần đây", enabled: true, sortOrder: 80, config: { limit: 8 } },
  { sectionKey: "team_summary", label: "Tổng hợp đội nhóm", enabled: true, sortOrder: 85, config: {} },
] as const;

export const statusColors = [
  "slate",
  "sky",
  "blue",
  "amber",
  "emerald",
  "red",
  "violet",
] as const;

export const priorities: Array<{ value: TaskPriority; label: string }> = [
  { value: "low", label: "Thấp" },
  { value: "normal", label: "Bình thường" },
  { value: "high", label: "Cao" },
  { value: "urgent", label: "Khẩn cấp" },
];

export const taskKinds: Array<{ value: TaskKind; label: string }> = [
  { value: "assigned", label: "Nhiệm vụ được giao" },
  { value: "self_registered", label: "Nhiệm vụ tự đăng ký" },
];

export const workflowStatusLabels: Record<TaskWorkflowStatus, string> = {
  active: "Đang xử lý",
  pending_registration: "Chờ duyệt đăng ký",
  registration_rejected: "Đăng ký bị từ chối",
  pending_completion: "Chờ duyệt hoàn thành",
  final_done: "Đã hoàn thành",
  completion_rejected: "Hoàn thành bị trả lại",
};

export const kanbanColumnWidth = {
  min: 220,
  default: 320,
  max: 560,
} as const;

export const kanbanWorkflowColumns: Array<{
  columnKey: string;
  workflowStatus: Exclude<TaskWorkflowStatus, "active">;
  sortOrder: number;
}> = [
  { columnKey: "workflow:pending_registration", workflowStatus: "pending_registration", sortOrder: 10 },
  { columnKey: "workflow:registration_rejected", workflowStatus: "registration_rejected", sortOrder: 20 },
  { columnKey: "workflow:pending_completion", workflowStatus: "pending_completion", sortOrder: 800 },
  { columnKey: "workflow:final_done", workflowStatus: "final_done", sortOrder: 900 },
  { columnKey: "workflow:completion_rejected", workflowStatus: "completion_rejected", sortOrder: 910 },
];

export const repeatUnits: Array<{ value: RepeatUnit; label: string }> = [
  { value: "day", label: "Ngày" },
  { value: "week", label: "Tuần" },
  { value: "month", label: "Tháng" },
];

export const permissionCatalog = [
  "task.view.all",
  "task.view.own",
  "task.create",
  "task.update",
  "task.delete",
  "project.manage",
  "user.manage",
  "role.manage",
  "export.run",
  "team.manage.own",
  "team.view.downline",
  "team.manage.all",
  "task.done.approve",
] as const;

export type PermissionKey = (typeof permissionCatalog)[number];

export function priorityLabel(priority: TaskPriority) {
  return priorities.find((item) => item.value === priority)?.label ?? priority;
}

export function roleDisplayName(name: string) {
  if (name === "Admin") return "Quản trị viên";
  if (name === "Member") return "Thành viên";
  return name;
}

export function slugifyKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
