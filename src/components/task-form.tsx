"use client";

import { useEffect, useMemo, useState } from "react";
import type { Employee, Project, Task, TaskEmployee, TaskStatusOption } from "@prisma/client";
import { Save } from "lucide-react";

import { createTaskAction, updateTaskAction } from "@/app/actions/tasks";
import { priorities, taskKinds } from "@/lib/constants";
import { dateInputValue } from "@/lib/format";

export type EmployeeForTaskForm = Employee & {
  linkedUser?: { id: string; username: string; displayName: string } | null;
  projects?: Array<{ projectId: string; project?: Project }>;
};

type TaskForForm =
  | (Task & {
      employees: TaskEmployee[];
    })
  | null;

function employeeLabel(employee: EmployeeForTaskForm) {
  return employee.linkedUser?.username ? `${employee.name} (@${employee.linkedUser.username})` : employee.name;
}

export type TaskActingContext = {
  owner: { id: string; username: string; displayName: string };
  canChooseProject: boolean;
  projects: Project[];
  employees: EmployeeForTaskForm[];
  statuses: TaskStatusOption[];
};

export function TaskForm({
  task = null,
  projects,
  employees,
  statuses,
  canChooseProject = true,
  actingContexts = [],
}: {
  task?: TaskForForm;
  projects: Project[];
  employees: EmployeeForTaskForm[];
  statuses: TaskStatusOption[];
  canChooseProject?: boolean;
  actingContexts?: TaskActingContext[];
}) {
  const action = task ? updateTaskAction : createTaskAction;
  const fallbackContext: TaskActingContext = useMemo(
    () => ({
      owner: { id: task?.ownerId ?? "", username: "", displayName: "Chính tôi" },
      canChooseProject,
      projects,
      employees,
      statuses,
    }),
    [canChooseProject, employees, projects, statuses, task?.ownerId],
  );
  const contexts = useMemo(
    () => (task ? [fallbackContext, ...actingContexts] : actingContexts.length ? actingContexts : [fallbackContext]),
    [actingContexts, fallbackContext, task],
  );
  const activeProjects = useMemo(() => {
    const byId = new Map<string, Project>();
    for (const context of contexts) {
      for (const project of context.projects) byId.set(project.id, project);
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [contexts]);
  const allEmployees = useMemo(() => {
    const byId = new Map<string, EmployeeForTaskForm>();
    for (const context of contexts) {
      for (const employee of context.employees) byId.set(employee.id, employee);
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [contexts]);
  const selectedProject = activeProjects.find((project) => project.id === task?.projectId) ?? activeProjects[0];
  const initialProjectId = task?.projectId ?? selectedProject?.id ?? "";
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId);
  const initialEmployeeIds = useMemo(
    () => new Set(task?.employees.map((employee) => employee.employeeId) ?? []),
    [task?.employees],
  );
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState(initialEmployeeIds);
  const selectedEmployeeTargetUserIds = useMemo(() => {
    const byId = new Map(allEmployees.map((employee) => [employee.id, employee]));
    return Array.from(
      new Set(
        Array.from(selectedEmployeeIds)
          .map((id) => byId.get(id)?.linkedUserId)
          .filter((userId): userId is string => Boolean(userId)),
      ),
    );
  }, [allEmployees, selectedEmployeeIds]);
  const hasUnlinkedSelectedEmployee = useMemo(() => {
    const byId = new Map(allEmployees.map((employee) => [employee.id, employee]));
    return Array.from(selectedEmployeeIds).some((id) => !byId.get(id)?.linkedUserId);
  }, [allEmployees, selectedEmployeeIds]);
  const selectedTargetUserId = selectedEmployeeTargetUserIds.length === 1 ? selectedEmployeeTargetUserIds[0] : "";
  const missingStatusContext =
    Boolean(selectedTargetUserId) && !contexts.some((context) => context.owner.id === selectedTargetUserId);
  const ownerConflict = selectedEmployeeTargetUserIds.length > 1 || hasUnlinkedSelectedEmployee || missingStatusContext;
  const selectedContext = selectedTargetUserId
    ? contexts.find((context) => context.owner.id === selectedTargetUserId) ?? contexts[0] ?? fallbackContext
    : contexts[0] ?? fallbackContext;
  const activeStatuses = selectedContext.statuses;
  const canSelectProject = task ? canChooseProject : canChooseProject || activeProjects.length > 1;
  const [selectedStatusId, setSelectedStatusId] = useState(task?.statusId ?? activeStatuses[0]?.id ?? "");

  useEffect(() => {
    if (!activeProjects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(activeProjects[0]?.id ?? "");
    }
    if (!activeStatuses.some((status) => status.id === selectedStatusId)) {
      setSelectedStatusId(activeStatuses[0]?.id ?? "");
    }
  }, [activeProjects, activeStatuses, selectedProjectId, selectedStatusId]);

  const visibleEmployees = useMemo(
    () =>
      allEmployees.filter((employee) => {
        const inSelectedProject = selectedProjectId
          ? employee.projects?.some((scope) => scope.projectId === selectedProjectId)
          : true;
        return inSelectedProject || initialEmployeeIds.has(employee.id);
      }),
    [allEmployees, initialEmployeeIds, selectedProjectId],
  );

  return (
    <form action={action} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {task ? <input type="hidden" name="id" value={task.id} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="block lg:col-span-2">
          <span className="text-xs font-semibold uppercase text-slate-500">Tiêu đề</span>
          <input
            name="title"
            required
            defaultValue={task?.title ?? ""}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Loại nghiệp vụ</span>
          <select
            name="kind"
            defaultValue={task?.kind ?? "assigned"}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            {taskKinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </label>

        {canSelectProject ? (
          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-500">Dự án</span>
            <select
              name="projectId"
              required
              value={selectedProjectId}
              onChange={(event) => {
                setSelectedProjectId(event.target.value);
                if (!task) setSelectedEmployeeIds(new Set());
              }}
              className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              {activeProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="block">
            <input type="hidden" name="projectId" value={selectedProjectId} />
            <span className="text-xs font-semibold uppercase text-slate-500">Dự án</span>
            <div className="mt-1 flex h-10 w-full items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
              {selectedProject?.name ?? "Dự án hiện tại"}
            </div>
          </div>
        )}

        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Trạng thái</span>
          <select
            name="statusId"
            value={selectedStatusId}
            onChange={(event) => setSelectedStatusId(event.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            {activeStatuses.map((status) => (
              <option key={status.id} value={status.id}>
                {status.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Độ ưu tiên</span>
          <select
            name="priority"
            defaultValue={task?.priority ?? "normal"}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            {priorities.map((priority) => (
              <option key={priority.value} value={priority.value}>
                {priority.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Ngày bắt đầu</span>
          <input
            name="startDate"
            type="date"
            defaultValue={dateInputValue(task?.startDate)}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Hạn hoàn thành</span>
          <input
            name="dueDate"
            type="date"
            defaultValue={dateInputValue(task?.dueDate)}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Thứ tự</span>
          <input
            name="sortOrder"
            type="number"
            min={0}
            max={10000}
            defaultValue={task?.sortOrder ?? 100}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>

        <TextAreaField name="description" label="Mô tả nhiệm vụ" value={task?.description ?? ""} />
        <TextAreaField name="result" label="Kết quả thực hiện" value={task?.result ?? ""} />
        <TextAreaField name="feedback" label="Phản hồi/cách làm" value={task?.feedback ?? ""} />
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase text-slate-500">Người nhận việc</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {visibleEmployees.map((employee) => {
            const outOfSelectedProject =
              selectedProjectId &&
              initialEmployeeIds.has(employee.id) &&
              !employee.projects?.some((scope) => scope.projectId === selectedProjectId);

            return (
              <label
                key={employee.id}
                className="flex min-h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm"
              >
                <input
                  type="checkbox"
                  name="employeeIds"
                  value={employee.id}
                  checked={selectedEmployeeIds.has(employee.id)}
                  onChange={(event) => {
                    setSelectedEmployeeIds((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(employee.id);
                      else next.delete(employee.id);
                      return next;
                    });
                  }}
                  className="size-4 rounded border-slate-300"
                />
                <span>
                  {employeeLabel(employee)}
                  {outOfSelectedProject ? (
                    <span className="ml-1 text-xs text-amber-600">(ngoài dự án đang chọn)</span>
                  ) : null}
                </span>
              </label>
            );
          })}
          {visibleEmployees.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500">
              Chưa có nhân sự trong dự án này. Tạo cấp dưới trong phần Đội nhóm.
            </div>
          ) : null}
        </div>
        {ownerConflict ? (
          <p className="mt-2 text-sm font-medium text-red-700">
            Chỉ chọn người nhận việc trong cùng một nhóm nhân sự.
          </p>
        ) : null}
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={ownerConflict || !selectedProjectId || !selectedStatusId}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Save size={16} aria-hidden="true" />
          Lưu nhiệm vụ
        </button>
      </div>
    </form>
  );
}

function TextAreaField({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="block lg:col-span-2">
      <span className="text-xs font-semibold uppercase text-slate-500">{label}</span>
      <textarea
        name={name}
        rows={4}
        defaultValue={value}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}
