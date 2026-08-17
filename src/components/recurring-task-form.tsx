"use client";

import { useMemo, useState } from "react";
import type { Project, RecurringTask, RecurringTaskEmployee, RepeatPattern } from "@prisma/client";
import { Save } from "lucide-react";

import { createRecurringTaskAction, updateRecurringTaskAction } from "@/app/actions/recurring-tasks";
import type { EmployeeForTaskForm, TaskActingContext } from "@/components/task-form";
import { priorities } from "@/lib/constants";
import { dateInputValue } from "@/lib/format";
import {
  recurrencePreviewRanges,
  repeatPatterns,
  repeatWeekdayOptions,
  normalizeRepeatWeekdays,
} from "@/lib/recurrence-utils";

type RecurringTaskForForm =
  | (RecurringTask & {
      employees: RecurringTaskEmployee[];
    })
  | null;

function employeeLabel(employee: EmployeeForTaskForm) {
  return employee.linkedUser?.username ? `${employee.name} (@${employee.linkedUser.username})` : employee.name;
}

export function RecurringTaskForm({
  recurringTask = null,
  projects,
  employees,
  canChooseProject = true,
  actingContexts = [],
}: {
  recurringTask?: RecurringTaskForForm;
  projects: Project[];
  employees: EmployeeForTaskForm[];
  canChooseProject?: boolean;
  actingContexts?: TaskActingContext[];
}) {
  const action = recurringTask ? updateRecurringTaskAction : createRecurringTaskAction;
  const fallbackContext: TaskActingContext = useMemo(
    () => ({
      owner: { id: recurringTask?.ownerId ?? "", username: "", displayName: "Chính tôi" },
      canChooseProject,
      projects,
      employees,
      statuses: [],
    }),
    [canChooseProject, employees, projects, recurringTask?.ownerId],
  );
  const contexts = useMemo(
    () =>
      recurringTask
        ? [fallbackContext, ...actingContexts]
        : actingContexts.length
          ? actingContexts
          : [fallbackContext],
    [actingContexts, fallbackContext, recurringTask],
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

  const selectedProject = activeProjects.find((project) => project.id === recurringTask?.projectId) ?? activeProjects[0];
  const [selectedProjectId, setSelectedProjectId] = useState(recurringTask?.projectId ?? selectedProject?.id ?? "");
  const initialEmployeeIds = useMemo(
    () => new Set(recurringTask?.employees.map((employee) => employee.employeeId) ?? []),
    [recurringTask?.employees],
  );
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState(initialEmployeeIds);
  const [repeatPattern, setRepeatPattern] = useState<RepeatPattern>(recurringTask?.repeatPattern ?? "daily");
  const [repeatEvery, setRepeatEvery] = useState(recurringTask?.repeatEvery ?? 1);
  const [repeatNoticeDays, setRepeatNoticeDays] = useState(recurringTask?.repeatNoticeDays ?? 7);
  const [durationDays, setDurationDays] = useState(recurringTask?.durationDays ?? 1);
  const [firstOccurrence, setFirstOccurrence] = useState(dateInputValue(recurringTask?.firstOccurrence) || dateInputValue(new Date()));
  const [repeatWeekdays, setRepeatWeekdays] = useState(
    () => new Set(normalizeRepeatWeekdays(recurringTask?.repeatWeekdays)),
  );

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
  const ownerConflict = selectedEmployeeTargetUserIds.length > 1 || hasUnlinkedSelectedEmployee;
  const canSelectProject = canChooseProject || (!recurringTask && activeProjects.length > 1);
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
  const previewRanges = useMemo(
    () =>
      recurrencePreviewRanges({
        firstOccurrence,
        repeatEvery,
        repeatPattern,
        repeatWeekdays: Array.from(repeatWeekdays),
        durationDays,
        count: 5,
      }),
    [durationDays, firstOccurrence, repeatEvery, repeatPattern, repeatWeekdays],
  );

  return (
    <form action={action} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {recurringTask ? <input type="hidden" name="id" value={recurringTask.id} /> : <input type="hidden" name="active" value="true" />}

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="block lg:col-span-2">
          <span className="text-xs font-semibold uppercase text-slate-500">Tiêu đề</span>
          <input
            name="title"
            required
            defaultValue={recurringTask?.title ?? ""}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
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
                if (!recurringTask) setSelectedEmployeeIds(new Set());
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
          <span className="text-xs font-semibold uppercase text-slate-500">Độ ưu tiên</span>
          <select
            name="priority"
            defaultValue={recurringTask?.priority ?? "normal"}
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
          <span className="text-xs font-semibold uppercase text-slate-500">Kiểu lặp</span>
          <select
            name="repeatPattern"
            value={repeatPattern}
            onChange={(event) => setRepeatPattern(event.target.value as RepeatPattern)}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            {repeatPatterns.map((pattern) => (
              <option key={pattern.value} value={pattern.value}>
                {pattern.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Mỗi</span>
          <input
            name="repeatEvery"
            type="number"
            min={1}
            max={365}
            value={repeatEvery}
            onChange={(event) => setRepeatEvery(Number(event.target.value) || 1)}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Ngày bắt đầu chu kỳ</span>
          <input
            name="firstOccurrence"
            type="date"
            required
            value={firstOccurrence}
            onChange={(event) => setFirstOccurrence(event.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Thời lượng thực hiện (ngày)</span>
          <input
            name="durationDays"
            type="number"
            min={0}
            max={3650}
            value={durationDays}
            onChange={(event) => setDurationDays(Math.max(0, Number(event.target.value) || 0))}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Báo trước (ngày)</span>
          <input
            name="repeatNoticeDays"
            type="number"
            min={0}
            max={365}
            value={repeatNoticeDays}
            onChange={(event) => setRepeatNoticeDays(Math.max(0, Number(event.target.value) || 0))}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Lặp đến ngày</span>
          <input
            name="repeatEndsAt"
            type="date"
            defaultValue={dateInputValue(recurringTask?.repeatEndsAt)}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>

        {recurringTask ? (
          <label className="flex h-10 items-center gap-2 self-end text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              name="active"
              defaultChecked={recurringTask.active && !recurringTask.archivedAt}
              className="size-4 rounded border-slate-300"
            />
            Đang hoạt động
          </label>
        ) : null}

        {repeatPattern === "weekly" ? (
          <div className="lg:col-span-2">
            <div className="text-xs font-semibold uppercase text-slate-500">Thứ trong tuần</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {repeatWeekdayOptions.map((weekday) => (
                <label
                  key={weekday.value}
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    name="repeatWeekdays"
                    value={weekday.value}
                    checked={repeatWeekdays.has(weekday.value)}
                    onChange={(event) => {
                      setRepeatWeekdays((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(weekday.value);
                        else next.delete(weekday.value);
                        return next;
                      });
                    }}
                    className="size-4 rounded border-slate-300"
                  />
                  {weekday.label}
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800 lg:col-span-2">
          {previewRanges.length ? (
            <span>
              Kỳ gần nhất:{" "}
              {previewRanges.map((item) => `${item.startKey} - phải xong ${item.dueKey}`).join(", ")}
            </span>
          ) : (
            <span>Chọn ngày bắt đầu chu kỳ để xem trước lịch sinh nhiệm vụ.</span>
          )}
        </div>

        <label className="block lg:col-span-2">
          <span className="text-xs font-semibold uppercase text-slate-500">Mô tả</span>
          <textarea
            name="description"
            rows={4}
            defaultValue={recurringTask?.description ?? ""}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase text-slate-500">Người nhận việc</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {visibleEmployees.map((employee) => (
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
              <span>{employeeLabel(employee)}</span>
            </label>
          ))}
          {visibleEmployees.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500">
              Chưa có nhân sự trong dự án này.
            </div>
          ) : null}
        </div>
        {ownerConflict ? (
          <p className="mt-2 text-sm font-medium text-red-700">
            Chỉ chọn một người chịu trách nhiệm chính và nhân sự phải là user hệ thống đã xác nhận.
          </p>
        ) : null}
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={ownerConflict || !selectedProjectId || !firstOccurrence}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Save size={16} aria-hidden="true" />
          Lưu nhiệm vụ thường xuyên
        </button>
      </div>
    </form>
  );
}
