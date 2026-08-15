import { deleteTeamRelationAction, saveTeamRelationAction } from "@/app/actions/team";
import { CountBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { AppShell } from "@/components/shell";
import { requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

const statuses = ["pending", "confirmed", "rejected", "admin_confirmed"] as const;

export default async function AdminTeamPage() {
  const user = await requirePermission("team.manage.all");
  const [users, relations] = await Promise.all([
    prisma.user.findMany({
      where: { enabled: true },
      orderBy: { displayName: "asc" },
      select: { id: true, username: true, displayName: true },
    }),
    prisma.teamRelation.findMany({
      include: {
        manager: { select: { id: true, username: true, displayName: true } },
        report: { select: { id: true, username: true, displayName: true } },
        sourceEmployee: { select: { id: true, name: true } },
      },
      orderBy: [{ manager: { displayName: "asc" } }, { report: { displayName: "asc" } }],
    }),
  ]);

  return (
    <AppShell user={user}>
      <PageHeader
        title="Quản trị đội nhóm"
        description="Quản trị viên có thể tạo, sửa, xóa và xác nhận thay quan hệ quản lý. Hệ thống sẽ chặn vòng lặp khi lưu."
      />

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Tạo quan hệ quản lý</h2>
        <RelationForm users={users} />
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-950">Quan hệ quản lý</h2>
          <CountBadge>{relations.length}</CountBadge>
        </div>
        <div className="grid gap-3">
          {relations.map((relation) => (
            <div key={relation.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 text-sm text-slate-600">
                <span className="font-semibold text-slate-950">
                  {relation.manager.displayName || relation.manager.username}
                </span>
                {" -> "}
                <span className="font-semibold text-slate-950">
                  {relation.report.displayName || relation.report.username}
                </span>
                {" - "}
                {teamRelationStatusLabel(relation.status)}
                {relation.sourceEmployee ? ` - nhân viên: ${relation.sourceEmployee.name}` : ""}
              </div>
              <RelationForm users={users} relation={relation} />
              <form action={deleteTeamRelationAction} className="mt-3">
                <input type="hidden" name="id" value={relation.id} />
                <button type="submit" className="h-8 rounded-md border border-red-200 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50">
                  Xóa
                </button>
              </form>
            </div>
          ))}
          {relations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
              Chưa có quan hệ quản lý.
            </div>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}

function RelationForm({
  users,
  relation,
}: {
  users: Array<{ id: string; username: string; displayName: string }>;
  relation?: { id: string; managerId: string; reportId: string; status: string };
}) {
  return (
    <form action={saveTeamRelationAction} className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_180px_120px]">
      {relation ? <input type="hidden" name="id" value={relation.id} /> : null}
      <select name="managerId" defaultValue={relation?.managerId ?? ""} required className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
        <option value="">Quản lý</option>
        {users.map((item) => (
          <option key={item.id} value={item.id}>
            {item.displayName || item.username}
          </option>
        ))}
      </select>
      <select name="reportId" defaultValue={relation?.reportId ?? ""} required className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
        <option value="">Cấp dưới trực tiếp</option>
        {users.map((item) => (
          <option key={item.id} value={item.id}>
            {item.displayName || item.username}
          </option>
        ))}
      </select>
      <select name="status" defaultValue={relation?.status ?? "admin_confirmed"} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
        {statuses.map((status) => (
          <option key={status} value={status}>
            {teamRelationStatusLabel(status)}
          </option>
        ))}
      </select>
      <button type="submit" className="h-10 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800">
        Lưu
      </button>
    </form>
  );
}

function teamRelationStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Chờ xác nhận",
    confirmed: "Đã xác nhận",
    rejected: "Bị từ chối",
    admin_confirmed: "Quản trị viên xác nhận",
  };
  return labels[status] ?? status;
}
