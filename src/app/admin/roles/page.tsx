import { deleteRoleAction, saveRoleAction } from "@/app/actions/admin";
import { AppShell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/authz";
import { roleDisplayName } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

export default async function RolesAdminPage() {
  const currentUser = await requirePermission("role.manage");
  const [roles, permissions] = await Promise.all([
    prisma.role.findMany({
      include: {
        permissions: { include: { permission: true } },
        users: { select: { userId: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.permission.findMany({ orderBy: { key: "asc" } }),
  ]);

  return (
    <AppShell user={currentUser}>
      <PageHeader title="Vai trò" description="Quản trị vai trò động và bật/tắt quyền theo từng hành động." />

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Tạo vai trò</h2>
        <RoleForm permissions={permissions} />
      </section>

      <section className="grid gap-4">
        {roles.map((role) => (
          <div key={role.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">{roleDisplayName(role.name)}</h2>
                <p className="text-sm text-slate-500">{role.description || "Chưa có mô tả"}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {role.users.length} người dùng
                  {role.system ? " - vai trò hệ thống" : ""}
                </p>
              </div>
              {!role.system ? (
                <form action={deleteRoleAction}>
                  <input type="hidden" name="id" value={role.id} />
                  <button
                    type="submit"
                    className="h-9 rounded-md border border-red-200 bg-white px-3 text-sm font-medium text-red-700 hover:bg-red-50"
                  >
                    Xóa
                  </button>
                </form>
              ) : null}
            </div>

            <RoleForm role={role} permissions={permissions} />
          </div>
        ))}
      </section>
    </AppShell>
  );
}

function RoleForm({
  role,
  permissions,
}: {
  role?: {
    id: string;
    name: string;
    description: string;
    permissions: Array<{ permissionId: string }>;
  };
  permissions: Awaited<ReturnType<typeof prisma.permission.findMany>>;
}) {
  const selected = new Set(role?.permissions.map((item) => item.permissionId) ?? []);

  return (
    <form action={saveRoleAction} className="mt-4 grid gap-4">
      {role ? <input type="hidden" name="id" value={role.id} /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Tên vai trò</span>
          <input
            name="name"
            required
            defaultValue={role?.name ?? ""}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">Mô tả</span>
          <input
            name="description"
            defaultValue={role?.description ?? ""}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
          />
        </label>
      </div>

      <div>
        <div className="text-xs font-semibold uppercase text-slate-500">Quyền</div>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {permissions.map((permission) => (
            <label key={permission.id} className="flex min-h-12 items-start gap-2 rounded-md border border-slate-200 p-3 text-sm">
              <input
                type="checkbox"
                name="permissionIds"
                value={permission.id}
                defaultChecked={selected.has(permission.id)}
                className="mt-0.5 size-4 rounded border-slate-300"
              />
              <span>
                <span className="block font-medium text-slate-800">{permission.key}</span>
                <span className="block text-xs text-slate-500">{permission.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <button type="submit" className="h-10 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800">
          Lưu vai trò
        </button>
      </div>
    </form>
  );
}
