import type {
  DashboardSectionPreference,
  Employee,
  EmployeeProject,
  KanbanColumnPreference,
  Permission,
  Project,
  Role,
  RolePermission,
  Task,
  TaskApproval,
  TaskComment,
  TaskEmployee,
  TaskHistory,
  TaskStatusOption,
  TeamDelegation,
  TeamRelation,
  User,
  UserProject,
  UserRole,
} from "@prisma/client";

import { priorityLabel, taskKinds, workflowStatusLabels } from "@/lib/constants";
import { dueExtendMetrics } from "@/lib/format";
import { recurrenceSummary } from "@/lib/recurrence-utils";
import { compareOperationalPriority } from "@/lib/task-priority";

type TaskWithRelations = Task & {
  project: Project;
  status: TaskStatusOption;
  parent?: Pick<Task, "id" | "title"> | null;
  createdBy: Pick<User, "username" | "displayName">;
  updatedBy: Pick<User, "username" | "displayName"> | null;
  employees: Array<TaskEmployee & { employee: Employee }>;
  comments: Array<TaskComment & { user: Pick<User, "username" | "displayName"> }>;
  history: Array<
    TaskHistory & {
      user: Pick<User, "username" | "displayName">;
      onBehalfOf?: Pick<User, "username" | "displayName"> | null;
    }
  >;
  approvals: Array<
    TaskApproval & {
      reviewer: Pick<User, "username" | "displayName">;
      delegatedFor?: Pick<User, "username" | "displayName"> | null;
    }
  >;
};

export function buildMarkdownExport(tasks: TaskWithRelations[]) {
  const childrenByParent = groupBy(
    tasks.filter((task) => task.parentId),
    (task) => task.parentId ?? "",
  );
  for (const children of childrenByParent.values()) {
    children.sort(compareOperationalPriority);
  }

  const rootTasks = tasks.filter((task) => !task.parentId).sort(compareOperationalPriority);
  const grouped = groupBy(rootTasks, (task) => task.project.name);
  const lines = [
    "# Sao lưu Task Tracker",
    "",
    `Thời điểm xuất: ${new Date().toISOString()}`,
    "",
  ];

  for (const [projectName, projectTasks] of grouped) {
    lines.push(`## ${projectName}`, "");
    const statusGroups = groupBy(projectTasks, (task) => task.status.label);

    for (const [statusLabel, statusTasks] of statusGroups) {
      lines.push(`### ${statusLabel} (${statusTasks.length})`, "");
      const userGroups = groupBy(
        statusTasks,
        (task) => task.createdBy.displayName || task.createdBy.username,
      );

      for (const [userLabel, userTasks] of userGroups) {
        lines.push(`#### ${userLabel} (${userTasks.length})`, "");
        for (const task of userTasks) {
          appendTaskMarkdown(lines, task, childrenByParent, 0);
        }
        lines.push("");
      }

      lines.push("");
    }
  }

  return lines.join("\n");
}

function appendTaskMarkdown(
  lines: string[],
  task: TaskWithRelations,
  childrenByParent: Map<string, TaskWithRelations[]>,
  depth: number,
) {
  const indent = "  ".repeat(depth);
  const detailIndent = "  ".repeat(depth + 1);
  const employees = task.employees.map((item) => item.employee.name).join(", ");
  const due = task.dueDate ? task.dueDate.toISOString().slice(0, 10) : "Không có hạn";
  const checked = task.workflowStatus === "final_done" || (task.completedAt && task.status.done) ? "x" : " ";
  const extend = dueExtendMetrics(task.dueHistory, task.dueDate);
  const kind = taskKinds.find((item) => item.value === task.kind)?.label ?? task.kind;

  lines.push(`${indent}- [${checked}] ${task.title} #status/${task.status.key} #priority/${task.priority}`);
  lines.push(
    `${detailIndent}- Dự án: ${task.project.name}`,
    `${detailIndent}- Loại nghiệp vụ: ${kind}`,
    `${detailIndent}- Nhiệm vụ cha: ${task.parent?.title ?? "Không có"}`,
    `${detailIndent}- Trạng thái: ${task.status.label} (${task.status.key})`,
    `${detailIndent}- Quy trình: ${workflowStatusLabels[task.workflowStatus]}`,
    `${detailIndent}- Người nhận việc: ${employees || "Chưa gán"}`,
    `${detailIndent}- Độ ưu tiên: ${priorityLabel(task.priority)}`,
    `${detailIndent}- Hạn: ${due}`,
    `${detailIndent}- Lặp lại: ${task.repeats ? recurrenceSummary(task) : "Không"}`,
    `${detailIndent}- Lần lặp: ${task.occurrence ? task.occurrence.toISOString().slice(0, 10) : "Không có"}`,
    `${detailIndent}- Chuỗi lặp: ${task.seriesId ?? "Không có"}`,
    `${detailIndent}- Người tạo: ${task.createdBy.displayName || task.createdBy.username}`,
  );
  if (extend.shouldShow) {
    lines.push(`${detailIndent}- Gia hạn: +${extend.days} ngày / ${extend.count} lần (${extend.timeline.join(" -> ")})`);
  }
  if (task.description) {
    lines.push(`${detailIndent}- Mô tả: ${task.description.replace(/\r?\n/g, " ")}`);
  }
  if (task.result) {
    lines.push(`${detailIndent}- Kết quả thực hiện: ${task.result.replace(/\r?\n/g, " ")}`);
  }
  if (task.feedback) {
    lines.push(`${detailIndent}- Phản hồi/cách làm: ${task.feedback.replace(/\r?\n/g, " ")}`);
  }
  if (task.approvals?.length) {
    lines.push(`${detailIndent}- Phê duyệt:`);
    for (const approval of task.approvals) {
      const reviewer = approval.reviewer.displayName || approval.reviewer.username;
      const delegatedFor = approval.delegatedFor
        ? `, trợ lý cho ${approval.delegatedFor.displayName || approval.delegatedFor.username}`
        : "";
      const actedAt = approval.actedAt ? approval.actedAt.toISOString() : "đang chờ";
      lines.push(
        `${detailIndent}  - ${approval.type} vòng ${approval.round} cấp ${approval.level}: ${approval.status} bởi ${reviewer}${delegatedFor} (${actedAt})`,
      );
      if (approval.note) lines.push(`${detailIndent}    - Ghi chú: ${approval.note.replace(/\r?\n/g, " ")}`);
    }
  }
  if (task.history?.length) {
    lines.push(`${detailIndent}- Lịch sử:`);
    for (const event of task.history) {
      const actor = event.user.displayName || event.user.username;
      const onBehalfOf = event.onBehalfOf
        ? `, làm thay ${event.onBehalfOf.displayName || event.onBehalfOf.username}`
        : "";
      lines.push(`${detailIndent}  - ${event.action}: ${actor}${onBehalfOf} (${event.createdAt.toISOString()})`);
    }
  }

  const children = childrenByParent.get(task.id) ?? [];
  if (children.length) {
    lines.push(`${detailIndent}- Nhiệm vụ con:`);
    for (const child of children) {
      appendTaskMarkdown(lines, child, childrenByParent, depth + 2);
    }
  }
}

function groupBy<T, K extends string>(items: T[], getKey: (item: T) => K) {
  return items.reduce<Map<K, T[]>>((groups, item) => {
    const key = getKey(item);
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
    return groups;
  }, new Map<K, T[]>());
}

type BackupPayload = {
  users: Array<Omit<User, "passwordHash">>;
  roles: Role[];
  permissions: Permission[];
  rolePermissions: RolePermission[];
  userRoles: UserRole[];
  projects: Project[];
  userProjects: UserProject[];
  statuses: TaskStatusOption[];
  employees: Employee[];
  employeeProjects: EmployeeProject[];
  dashboardSections: DashboardSectionPreference[];
  kanbanColumns: KanbanColumnPreference[];
  teamRelations: TeamRelation[];
  teamDelegations: TeamDelegation[];
  taskApprovals: TaskApproval[];
  tasks: TaskWithRelations[];
};

export function buildJsonExport(payload: BackupPayload) {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      ...payload,
    },
    null,
    2,
  );
}

export function exportFileName(format: "markdown" | "json") {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `task-tracker-${timestamp}.${format === "markdown" ? "md" : "json"}`;
}

export function taskDisplay(task: Pick<Task, "priority"> & { status: Pick<TaskStatusOption, "label"> }) {
  return {
    status: task.status.label,
    priority: priorityLabel(task.priority),
  };
}
