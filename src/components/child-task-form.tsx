"use client";

import { useEffect, useMemo, useState } from "react";
import type { Employee, Project, TaskStatusOption } from "@prisma/client";
import { Plus } from "lucide-react";

import { createChildTaskAction } from "@/app/actions/tasks";
import { priorities } from "@/lib/constants";

type EmployeeForChildForm = Employee & {
  linkedUser?: { id: string; username: string; displayName: string } | null;
  projects?: Array<{ projectId: string; project?: Project }>;
};

export type ChildTaskStatusContext = {
  owner: { id: string; username: string; displayName: string };
  statuses: TaskStatusOption[];
};

export function ChildTaskForm({
  parentId,
  projectId,
  ownerId,
  employees,
  statuses,
  statusContexts = [],
}: {
  parentId: string;
  projectId: string;
  ownerId: string;
  employees: EmployeeForChildForm[];
  statuses: TaskStatusOption[];
  statusContexts?: ChildTaskStatusContext[];
}) {
  const visibleEmployees = useMemo(
    () => employees.filter((employee) => employee.projects?.some((scope) => scope.projectId === projectId)),
    [employees, projectId],
  );
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const selectedEmployeeTargetUserIds = useMemo(() => {
    const byId = new Map(visibleEmployees.map((employee) => [employee.id, employee]));
    return Array.from(
      new Set(
        Array.from(selectedEmployeeIds)
          .map((id) => byId.get(id)?.linkedUserId)
          .filter((userId): userId is string => Boolean(userId)),
      ),
    );
  }, [selectedEmployeeIds, visibleEmployees]);
  const hasUnlinkedSelectedEmployee = useMemo(() => {
    const byId = new Map(visibleEmployees.map((employee) => [employee.id, employee]));
    return Array.from(selectedEmployeeIds).some((id) => !byId.get(id)?.linkedUserId);
  }, [selectedEmployeeIds, visibleEmployees]);
  const selectedTargetUserId =
    selectedEmployeeTargetUserIds.length === 1 ? selectedEmployeeTargetUserIds[0] : "";
  const statusContext = selectedTargetUserId
    ? statusContexts.find((context) => context.owner.id === selectedTargetUserId)
    : null;
  const activeStatuses = statusContext?.statuses ?? statuses;
  const missingStatusContext = Boolean(selectedTargetUserId) && !statusContext && selectedTargetUserId !== ownerId;
  const assignmentConflict =
    selectedEmployeeTargetUserIds.length > 1 || hasUnlinkedSelectedEmployee || missingStatusContext;
  const [selectedStatusId, setSelectedStatusId] = useState(activeStatuses[0]?.id ?? "");

  useEffect(() => {
    if (!activeStatuses.some((status) => status.id === selectedStatusId)) {
      setSelectedStatusId(activeStatuses[0]?.id ?? "");
    }
  }, [activeStatuses, selectedStatusId]);

  return (
    <form action={createChildTaskAction} className="grid gap-3 lg:grid-cols-2">
      <input type="hidden" name="parentId" value={parentId} />
      <label className="block lg:col-span-2">
        <span className="text-xs font-semibold uppercase text-slate-500">Tiêu đề</span>
        <input name="title" required className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm" />
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-slate-500">Trạng thái</span>
        <select
          name="statusId"
          value={selectedStatusId}
          onChange={(event) => setSelectedStatusId(event.target.value)}
          className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
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
        <select name="priority" defaultValue="normal" className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">
          {priorities.map((priority) => (
            <option key={priority.value} value={priority.value}>
              {priority.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-slate-500">Ngày bắt đầu</span>
        <input name="startDate" type="date" className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm" />
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-slate-500">Hạn hoàn thành</span>
        <input name="dueDate" type="date" className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm" />
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-slate-500">Thứ tự</span>
        <input name="sortOrder" type="number" defaultValue={100} min={0} max={10000} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm" />
      </label>
      <label className="block lg:col-span-2">
        <span className="text-xs font-semibold uppercase text-slate-500">Mô tả nhiệm vụ con</span>
        <textarea name="description" rows={3} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <div className="lg:col-span-2">
        <div className="text-xs font-semibold uppercase text-slate-500">Người nhận việc</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {visibleEmployees.map((employee) => (
            <label key={employee.id} className="flex min-h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm">
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
              <span>{employee.linkedUser?.username ? `${employee.name} (@${employee.linkedUser.username})` : employee.name}</span>
            </label>
          ))}
          {visibleEmployees.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500">
              Chưa có nhân viên thuộc dự án này.
            </div>
          ) : null}
        </div>
        {assignmentConflict ? (
          <p className="mt-2 text-sm font-medium text-red-700">
            Chỉ chọn một người chịu trách nhiệm chính và nhân sự phải là user hệ thống đã xác nhận.
          </p>
        ) : null}
      </div>
      <div className="lg:col-span-2">
        <button
          type="submit"
          disabled={assignmentConflict || !selectedStatusId}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Plus size={16} aria-hidden="true" />
          Thêm nhiệm vụ con
        </button>
      </div>
    </form>
  );
}
