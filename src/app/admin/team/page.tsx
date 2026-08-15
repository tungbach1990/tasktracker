import {
  deleteTeamRelationAction,
  revokeTeamDelegationAction,
  saveTeamDelegationAction,
  saveTeamRelationAction,
  transferDirectReportAction,
} from "@/app/actions/team";
import { CountBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { AppShell } from "@/components/shell";
import { requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

const statuses = ["pending", "confirmed", "rejected", "admin_confirmed"] as const;

export default async function AdminTeamPage() {
  const user = await requirePermission("team.manage.all");
  const [users, projects, relations, delegations] = await Promise.all([
    prisma.user.findMany({
      where: { enabled: true },
      orderBy: { displayName: "asc" },
      select: { id: true, username: true, displayName: true },
    }),
    prisma.project.findMany({
      where: { active: true },
      orderBy: [{ name: "asc" }, { key: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.teamRelation.findMany({
      include: {
        manager: { select: { id: true, username: true, displayName: true } },
        report: { select: { id: true, username: true, displayName: true } },
        sourceEmployee: { select: { id: true, name: true } },
      },
      orderBy: [{ manager: { displayName: "asc" } }, { report: { displayName: "asc" } }],
    }),
    prisma.teamDelegation.findMany({
      include: {
        manager: { select: { id: true, username: true, displayName: true } },
        assistant: { select: { id: true, username: true, displayName: true } },
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, username: true, displayName: true } },
      },
      orderBy: [{ active: "desc" }, { project: { name: "asc" } }, { manager: { displayName: "asc" } }, { assistant: { displayName: "asc" } }],
    }),
  ]);

  return (
    <AppShell user={user}>
      <PageHeader
        title="Quản trị đội nhóm"
        description="Quản trị viên có thể tạo, sửa, xóa và xác nhận thay quan hệ quản lý. Hệ thống sẽ chặn vòng lặp khi lưu."
      />

      <section className="mb-6 grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Tạo quan hệ quản lý</h2>
          <p className="mt-1 text-sm text-slate-500">Mỗi user chỉ có một quản lý trực tiếp đang hiệu lực hoặc đang chờ.</p>
          <RelationForm users={users} />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Chuyển quản lý trực tiếp</h2>
          <p className="mt-1 text-sm text-slate-500">Tự từ chối tuyến cũ rồi gán tuyến mới sau khi kiểm tra vòng cấp bậc.</p>
          <TransferForm users={users} />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Ủy quyền trợ lý</h2>
          <p className="mt-1 text-sm text-slate-500">Trợ lý hỗ trợ thao tác task nhưng không làm đổi cây quản lý.</p>
          <DelegationForm users={users} projects={projects} />
        </div>
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

      <section className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-950">Ủy quyền trợ lý</h2>
          <CountBadge>{delegations.length}</CountBadge>
        </div>
        <div className="grid gap-3">
          {delegations.map((delegation) => (
            <div key={delegation.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-slate-600">
                  <span className="font-semibold text-slate-950">
                    {delegation.assistant.displayName || delegation.assistant.username}
                  </span>
                  {" hỗ trợ "}
                  <span className="font-semibold text-slate-950">
                    {delegation.manager.displayName || delegation.manager.username}
                  </span>
                  {" trong dự án "}
                  <span className="font-semibold text-slate-950">
                    {delegation.project.name}
                  </span>
                  {" - "}
                  {delegation.active ? "đang hiệu lực" : "đã hủy"}
                </div>
                {delegation.active ? (
                  <form action={revokeTeamDelegationAction}>
                    <input type="hidden" name="id" value={delegation.id} />
                    <button type="submit" className="h-8 rounded-md border border-red-200 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50">
                      Hủy ủy quyền
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          ))}
          {delegations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
              Chưa có ủy quyền trợ lý.
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

function TransferForm({ users }: { users: Array<{ id: string; username: string; displayName: string }> }) {
  return (
    <form action={transferDirectReportAction} className="mt-3 grid gap-3">
      <select name="reportId" required defaultValue="" className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
        <option value="">Chọn cấp dưới</option>
        {users.map((item) => (
          <option key={item.id} value={item.id}>
            {item.displayName || item.username}
          </option>
        ))}
      </select>
      <select name="managerId" required defaultValue="" className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
        <option value="">Quản lý mới</option>
        {users.map((item) => (
          <option key={item.id} value={item.id}>
            {item.displayName || item.username}
          </option>
        ))}
      </select>
      <button type="submit" className="h-10 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800">
        Chuyển tuyến
      </button>
    </form>
  );
}

function DelegationForm({
  users,
  projects,
}: {
  users: Array<{ id: string; username: string; displayName: string }>;
  projects: Array<{ id: string; name: string }>;
}) {
  return (
    <form action={saveTeamDelegationAction} className="mt-3 grid gap-3">
      <select name="projectId" required defaultValue="" className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
        <option value="">Dự án</option>
        {projects.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <select name="managerId" required defaultValue="" className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
        <option value="">Quản lý được hỗ trợ</option>
        {users.map((item) => (
          <option key={item.id} value={item.id}>
            {item.displayName || item.username}
          </option>
        ))}
      </select>
      <select name="assistantId" required defaultValue="" className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
        <option value="">Trợ lý</option>
        {users.map((item) => (
          <option key={item.id} value={item.id}>
            {item.displayName || item.username}
          </option>
        ))}
      </select>
      <button type="submit" className="h-10 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800">
        Lưu ủy quyền
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
