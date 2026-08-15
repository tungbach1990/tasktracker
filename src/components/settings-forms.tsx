import type { DashboardSectionPreference, KanbanColumnPreference, Project, TaskStatusOption } from "@prisma/client";
import Link from "next/link";

import {
  archiveStatusSettingAction,
  reorderStatusSettingAction,
  resetKanbanSettingsAction,
  saveDashboardSettingAction,
  saveKanbanColumnSettingAction,
  saveStatusSettingAction,
} from "@/app/actions/settings";
import { StatusBadge } from "@/components/badge";
import { SettingsNav, type SettingsSectionKey } from "@/components/settings-nav";
import { kanbanColumnWidth, statusColors, workflowStatusLabels } from "@/lib/constants";
import { dashboardNumber } from "@/lib/settings";

export type StatusWithCount = TaskStatusOption & {
  _count: {
    tasks: number;
  };
};

export function SettingsHeader({ current }: { current?: SettingsSectionKey }) {
  return <SettingsNav current={current} />;
}

export function SettingsOverview({
  projectCount,
  statusCount,
  dashboardCount,
  kanbanCount,
  canManageProjects = false,
}: {
  projectCount: number;
  statusCount: number;
  dashboardCount: number;
  kanbanCount: number;
  canManageProjects?: boolean;
}) {
  const cards = [
    { href: "/settings/projects", title: "Dự án", value: projectCount, note: "Dự án hiện tại của bạn" },
    { href: "/settings/statuses", title: "Trạng thái", value: statusCount, note: "Luồng trạng thái nhiệm vụ" },
    { href: "/settings/dashboard", title: "Tổng quan", value: dashboardCount, note: "Phần hiển thị và giới hạn" },
    { href: "/settings/kanban", title: "Kanban", value: kanbanCount, note: "Cột và độ rộng bảng" },
  ];
  cards[0].note = canManageProjects ? "Danh mục chung trong quản trị" : "Dự án hiện tại";

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Link
          key={card.href}
          href={card.href}
          className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 hover:bg-slate-50"
        >
          <div className="text-sm font-semibold text-slate-950">{card.title}</div>
          <div className="mt-3 text-3xl font-semibold text-slate-950">{card.value}</div>
          <div className="mt-1 text-sm text-slate-500">{card.note}</div>
        </Link>
      ))}
    </div>
  );
}

export function ProjectsSettings({
  projects,
  currentProject,
  canManage,
}: {
  projects: Project[];
  currentProject: Project | null;
  canManage: boolean;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Dự án hiện tại</h2>
          <p className="mt-1 text-sm text-slate-500">
            Nhiệm vụ của thành viên luôn dùng dự án hiện tại do admin gán.
          </p>
        </div>
        {canManage ? (
          <Link
            href="/admin/projects"
            className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Quản lý dự án
          </Link>
        ) : null}
      </div>
      {currentProject ? (
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="text-sm font-semibold text-slate-950">{currentProject.name}</div>
          <div className="mt-1 text-xs text-slate-500">
            key: {currentProject.key} - {currentProject.active ? "đang dùng" : "đã lưu trữ"}
          </div>
          {currentProject.description ? (
            <p className="mt-2 text-sm text-slate-600">{currentProject.description}</p>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          Chưa có dự án hiện tại.
        </div>
      )}
      {canManage ? (
        <div className="mt-4 text-sm text-slate-500">
          Dự án chung đang dùng: {projects.filter((project) => project.active).length}
        </div>
      ) : null}
    </section>
  );
}

export function StatusesSettings({ statuses }: { statuses: StatusWithCount[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">Trạng thái</h2>
      <StatusForm />
      <form action={reorderStatusSettingAction} className="mt-4 rounded-md border border-slate-200 p-3">
        <div className="mb-3 text-sm font-semibold text-slate-950">Sắp xếp trạng thái đang dùng</div>
        <div className="grid gap-2">
          {statuses
            .filter((status) => status.active)
            .map((status) => (
              <div key={status.id} className="grid gap-2 rounded-md border border-slate-200 p-3 md:grid-cols-[1fr_140px]">
                <input type="hidden" name="statusIds" value={status.id} />
                <div className="flex items-center">
                  <StatusBadge status={status} />
                </div>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-slate-500">Thứ tự</span>
                  <input
                    name="sortOrders"
                    type="number"
                    defaultValue={status.sortOrder}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                  />
                </label>
              </div>
            ))}
        </div>
        <button type="submit" className="mt-3 h-9 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800">
          Lưu thứ tự
        </button>
      </form>
      <div className="mt-4 grid gap-3">
        {statuses.map((status) => (
          <div key={status.id} className="rounded-md border border-slate-200 p-3">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusBadge status={status} />
              <span className="text-xs text-slate-500">
                {status._count.tasks} nhiệm vụ
                {status.active ? "" : " - đã lưu trữ"}
              </span>
            </div>
            <StatusForm status={status} />
            <ArchiveForm id={status.id} active={status.active} action={archiveStatusSettingAction} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function DashboardSettings({ sections }: { sections: DashboardSectionPreference[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">Tổng quan</h2>
      <div className="mt-4 grid gap-3">
        {sections.map((section) => (
          <form key={section.id} action={saveDashboardSettingAction} className="rounded-md border border-slate-200 p-3">
            <input type="hidden" name="sectionKey" value={section.sectionKey} />
            <div className="grid gap-3 md:grid-cols-[1fr_120px_120px]">
              <input name="label" defaultValue={section.label} className="h-10 rounded-md border border-slate-300 px-3 text-sm" />
              <input name="sortOrder" type="number" defaultValue={section.sortOrder} className="h-10 rounded-md border border-slate-300 px-3 text-sm" />
              <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm">
                <input type="checkbox" name="enabled" defaultChecked={section.enabled} className="size-4 rounded border-slate-300" />
                Bật
              </label>
            </div>
            {section.sectionKey === "upcoming" ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-slate-500">Số ngày sắp tới</span>
                  <input
                    name="upcomingDays"
                    type="number"
                    min={1}
                    max={365}
                    defaultValue={dashboardNumber(section.config, "days", 7)}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-slate-500">Giới hạn sắp tới</span>
                  <input
                    name="upcomingLimit"
                    type="number"
                    min={1}
                    max={100}
                    defaultValue={dashboardNumber(section.config, "limit", 8)}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                  />
                </label>
              </div>
            ) : null}
            {section.sectionKey === "recent_open" ? (
              <label className="mt-3 block">
                <span className="text-xs font-semibold uppercase text-slate-500">Giới hạn gần đây</span>
                <input
                  name="recentLimit"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={dashboardNumber(section.config, "limit", 8)}
                  className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                />
              </label>
            ) : null}
            {section.sectionKey === "after_upcoming" || section.sectionKey === "priority_focus" ? (
              <label className="mt-3 block">
                <span className="text-xs font-semibold uppercase text-slate-500">Giới hạn phần</span>
                <input
                  name="sectionLimit"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={dashboardNumber(section.config, "limit", 8)}
                  className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                />
              </label>
            ) : null}
            {section.sectionKey === "start_after" ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-slate-500">Bắt đầu sau số ngày</span>
                  <input
                    name="startAfterDays"
                    type="number"
                    min={0}
                    max={365}
                    defaultValue={dashboardNumber(section.config, "days", 0, { min: 0, max: 365 })}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-slate-500">Giới hạn phần</span>
                  <input
                    name="sectionLimit"
                    type="number"
                    min={1}
                    max={100}
                    defaultValue={dashboardNumber(section.config, "limit", 8)}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                  />
                </label>
              </div>
            ) : null}
            <button type="submit" className="mt-3 h-9 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800">
              Lưu phần
            </button>
          </form>
        ))}
      </div>
    </section>
  );
}

export function KanbanSettings({
  columns,
  statuses,
}: {
  columns: KanbanColumnPreference[];
  statuses: Array<Pick<TaskStatusOption, "key" | "label" | "active" | "done">>;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950">Kanban</h2>
        <form action={resetKanbanSettingsAction}>
          <button type="submit" className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Đặt lại
          </button>
        </form>
      </div>
      <div className="mt-4 grid gap-3">
        {columns.map((column) => (
          <form key={column.id} action={saveKanbanColumnSettingAction} className="rounded-md border border-slate-200 p-3">
            <input type="hidden" name="columnKey" value={column.columnKey} />
            <input type="hidden" name="columnType" value={column.columnType} />
            <div className="grid gap-3 lg:grid-cols-[1fr_120px_140px_120px]">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-950">
                  {kanbanColumnLabel(column, statuses)}
                </div>
                <div className="mt-1 text-xs text-slate-500">{column.columnKey}</div>
              </div>
              <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm">
                <input type="checkbox" name="enabled" defaultChecked={column.enabled} className="size-4 rounded border-slate-300" />
                Bật
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-slate-500">Thứ tự</span>
                <input
                  name="sortOrder"
                  type="number"
                  defaultValue={column.sortOrder}
                  className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-slate-500">Độ rộng</span>
                <input
                  name="widthPx"
                  type="number"
                  min={kanbanColumnWidth.min}
                  max={kanbanColumnWidth.max}
                  defaultValue={column.widthPx}
                  className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                />
              </label>
            </div>
            <button type="submit" className="mt-3 h-9 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800">
              Lưu cột
            </button>
          </form>
        ))}
        {columns.length === 0 ? <p className="text-sm text-slate-500">Chưa có cột Kanban.</p> : null}
      </div>
    </section>
  );
}

function kanbanColumnLabel(
  column: Pick<KanbanColumnPreference, "columnKey" | "columnType">,
  statuses: Array<Pick<TaskStatusOption, "key" | "label" | "active" | "done">>,
) {
  if (column.columnType === "workflow") {
    const workflowStatus = column.columnKey.replace("workflow:", "") as keyof typeof workflowStatusLabels;
    return workflowStatusLabels[workflowStatus] ?? column.columnKey;
  }

  const statusKey = column.columnKey.replace("status:", "");
  const status = statuses.find((item) => item.key === statusKey);
  return status?.label ?? statusKey;
}

function StatusForm({
  status,
}: {
  status?: Pick<TaskStatusOption, "id" | "key" | "label" | "color" | "sortOrder" | "done">;
}) {
  return (
    <form action={saveStatusSettingAction} className="mt-3 grid gap-3 md:grid-cols-[1fr_160px_140px_120px_110px_120px]">
      {status ? <input type="hidden" name="id" value={status.id} /> : null}
      <input name="label" required defaultValue={status?.label ?? ""} placeholder="Tên trạng thái" className="h-10 rounded-md border border-slate-300 px-3 text-sm" />
      <input name="key" defaultValue={status?.key ?? ""} placeholder="status-key" className="h-10 rounded-md border border-slate-300 px-3 text-sm" />
      <select name="color" defaultValue={status?.color ?? "slate"} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
        {statusColors.map((color) => (
          <option key={color} value={color}>
            {color}
          </option>
        ))}
      </select>
      <input name="sortOrder" type="number" defaultValue={status?.sortOrder ?? 100} className="h-10 rounded-md border border-slate-300 px-3 text-sm" />
      <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm">
        <input type="checkbox" name="done" defaultChecked={status?.done ?? false} className="size-4 rounded border-slate-300" />
        Hoàn thành
      </label>
      <button type="submit" className="h-10 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800">
        Lưu
      </button>
    </form>
  );
}

function ArchiveForm({
  id,
  active,
  action,
}: {
  id: string;
  active: boolean;
  action: (formData: FormData) => Promise<void>;
}) {
  if (!active) return null;

  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="h-8 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">
        Lưu trữ
      </button>
    </form>
  );
}
