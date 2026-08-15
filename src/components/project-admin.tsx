import type { Project } from "@prisma/client";

import {
  archiveAdminProjectAction,
  createProjectAction,
  setCurrentProjectAction,
  updateProjectAction,
} from "@/app/actions/admin";

type UserWithCurrentProject = {
  id: string;
  username: string;
  displayName: string;
  currentProjectId: string | null;
  currentProject: Project | null;
};

export function CreateProjectForm() {
  return (
    <form action={createProjectAction} className="mt-4 grid gap-3">
      <input
        name="name"
        required
        placeholder="Tên dự án"
        className="h-10 rounded-md border border-slate-300 px-3 text-sm"
      />
      <input
        name="key"
        placeholder="project-key"
        className="h-10 rounded-md border border-slate-300 px-3 text-sm"
      />
      <textarea
        name="description"
        rows={3}
        placeholder="Mô tả"
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <button type="submit" className="h-10 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800">
        Lưu dự án
      </button>
    </form>
  );
}

export function ProjectCatalogPanel({ projects }: { projects: Project[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-950">Danh mục dự án</h2>
        <p className="mt-1 text-sm text-slate-500">
          Dự án dùng chung do admin quản lý. Lưu trữ dự án sẽ giữ nguyên lịch sử nhiệm vụ cũ.
        </p>
      </div>

      <div className="grid gap-3">
        {projects.map((project) => (
          <div key={project.id} className="rounded-md border border-slate-200 p-3">
            <form action={updateProjectAction} className="grid gap-2 md:grid-cols-[1fr_180px_1fr_110px]">
              <input type="hidden" name="id" value={project.id} />
              <input
                name="name"
                required
                defaultValue={project.name}
                className="h-9 rounded-md border border-slate-300 px-2 text-sm"
              />
              <input
                name="key"
                defaultValue={project.key}
                className="h-9 rounded-md border border-slate-300 px-2 text-sm"
              />
              <input
                name="description"
                defaultValue={project.description}
                className="h-9 rounded-md border border-slate-300 px-2 text-sm"
              />
              <button type="submit" className="h-9 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800">
                Lưu
              </button>
            </form>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{project.active ? "đang dùng" : "đã lưu trữ"}</span>
              <span>key: {project.key}</span>
            </div>
            {project.active ? (
              <form action={archiveAdminProjectAction} className="mt-2">
                <input type="hidden" name="id" value={project.id} />
                <button type="submit" className="h-8 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  Lưu trữ
                </button>
              </form>
            ) : null}
          </div>
        ))}
        {projects.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 p-3 text-sm text-slate-500">
            Chưa có dự án.
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function UserProjectAssignmentPanel({
  users,
  activeProjects,
}: {
  users: UserWithCurrentProject[];
  activeProjects: Project[];
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-950">Dự án hiện tại của người dùng</h2>
        <p className="mt-1 text-sm text-slate-500">
          Mỗi người dùng có đúng một dự án hiện tại. Nhiệm vụ của thành viên sẽ tự dùng dự án này.
        </p>
      </div>

      <div className="grid gap-3">
        {users.map((user) => (
          <form
            key={user.id}
            action={setCurrentProjectAction}
            className="grid gap-3 rounded-md border border-slate-200 p-3 md:grid-cols-[1fr_240px_110px]"
          >
            <input type="hidden" name="userId" value={user.id} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-950">
                {user.displayName || user.username}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                @{user.username} - hiện tại: {user.currentProject?.name ?? "Chưa có dự án hiện tại"}
              </div>
            </div>
            <select
              name="projectId"
              required
              defaultValue={user.currentProjectId ?? activeProjects[0]?.id ?? ""}
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
            >
              {activeProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={activeProjects.length === 0}
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Gán hiện tại
            </button>
          </form>
        ))}
        {users.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 p-3 text-sm text-slate-500">
            Chưa có người dùng.
          </div>
        ) : null}
      </div>
    </section>
  );
}
