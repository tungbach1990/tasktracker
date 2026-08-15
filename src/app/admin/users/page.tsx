import type { Role } from "@prisma/client";

import {
  createUserAction,
  resetPasswordAction,
  updateUserAction,
} from "@/app/actions/admin";
import { PageHeader } from "@/components/page-header";
import { UserProjectAssignmentPanel } from "@/components/project-admin";
import { AppShell } from "@/components/shell";
import { hasPermission, requirePermission } from "@/lib/authz";
import { roleDisplayName } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { ensureGlobalDefaultProject } from "@/lib/projects";

export default async function UsersAdminPage() {
  const currentUser = await requirePermission("user.manage");
  const canManageProjects = hasPermission(currentUser, "project.manage");
  if (canManageProjects) await ensureGlobalDefaultProject(prisma);
  const [users, roles, activeProjects] = await Promise.all([
    prisma.user.findMany({
      include: {
        roles: { include: { role: true } },
        currentProject: true,
      },
      orderBy: { username: "asc" },
    }),
    prisma.role.findMany({ orderBy: { name: "asc" } }),
    canManageProjects
      ? prisma.project.findMany({
          where: { active: true },
          orderBy: [{ createdAt: "asc" }, { name: "asc" }],
        })
      : Promise.resolve([]),
  ]);

  return (
    <AppShell user={currentUser}>
      <PageHeader title="Người dùng" description="Tạo user, đổi mật khẩu, khóa/mở tài khoản và gán vai trò." />

      <section className="mb-6 grid gap-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Tạo người dùng</h2>
          <UserForm action={createUserAction} roles={roles} />
        </div>

        {canManageProjects ? (
          <UserProjectAssignmentPanel users={users} activeProjects={activeProjects} />
        ) : null}
      </section>

      <section className="grid gap-4">
        {users.map((user) => (
          <div key={user.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">{user.displayName}</h2>
                <p className="text-sm text-slate-500">
                  @{user.username} - {user.enabled ? "đang dùng" : "đã khóa"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Dự án hiện tại: {user.currentProject?.name ?? "Chưa có dự án hiện tại"}
                </p>
              </div>
              <div className="text-xs text-slate-500">
                {user.roles.map((item) => roleDisplayName(item.role.name)).join(", ") || "Chưa có vai trò"}
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
              <UserForm action={updateUserAction} user={user} roles={roles} />
              <form action={resetPasswordAction} className="rounded-md border border-slate-200 p-3">
                <input type="hidden" name="id" value={user.id} />
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-slate-500">Mật khẩu mới</span>
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={8}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                  />
                </label>
                <button type="submit" className="mt-3 h-9 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800">
                  Đặt lại mật khẩu
                </button>
              </form>
            </div>
          </div>
        ))}
      </section>
    </AppShell>
  );
}

function UserForm({
  action,
  user,
  roles,
}: {
  action: (formData: FormData) => Promise<void>;
  user?: {
    id: string;
    displayName: string;
    username: string;
    enabled: boolean;
    roles?: Array<{ roleId: string }>;
  };
  roles: Role[];
}) {
  const roleIds = new Set(
    user?.roles?.map((item) => item.roleId) ??
      roles.filter((role) => role.name === "Member").map((role) => role.id),
  );

  return (
    <form action={action} className="mt-4 grid gap-3">
      {user ? <input type="hidden" name="id" value={user.id} /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <input name="displayName" required defaultValue={user?.displayName ?? ""} placeholder="Tên hiển thị" className="h-10 rounded-md border border-slate-300 px-3 text-sm" />
        <input name="username" required defaultValue={user?.username ?? ""} placeholder="Tên đăng nhập" className="h-10 rounded-md border border-slate-300 px-3 text-sm" />
      </div>
      {!user ? (
        <input name="password" type="password" required minLength={8} placeholder="Mật khẩu ban đầu" className="h-10 rounded-md border border-slate-300 px-3 text-sm" />
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={user?.enabled ?? true} className="size-4 rounded border-slate-300" />
        Đang dùng
      </label>
      <CheckboxGroup title="Vai trò" name="roleIds" items={roles.map((role) => ({ id: role.id, label: roleDisplayName(role.name) }))} selected={roleIds} />
      <button type="submit" className="h-10 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800">
        Lưu người dùng
      </button>
    </form>
  );
}

function CheckboxGroup({
  title,
  name,
  items,
  selected,
}: {
  title: string;
  name: string;
  items: Array<{ id: string; label: string }>;
  selected: Set<string>;
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase text-slate-500">{title}</div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <label key={item.id} className="flex min-h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm">
            <input type="checkbox" name={name} value={item.id} defaultChecked={selected.has(item.id)} className="size-4 rounded border-slate-300" />
            {item.label}
          </label>
        ))}
      </div>
    </div>
  );
}
