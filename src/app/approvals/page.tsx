import Link from "next/link";

import { approveTaskApprovalAction, rejectTaskApprovalAction } from "@/app/actions/tasks";
import { CountBadge, PriorityBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { AppShell } from "@/components/shell";
import { getApprovalQueueForUser } from "@/lib/approvals";
import { requireActiveUser } from "@/lib/authz";
import { shortDate } from "@/lib/format";

export default async function ApprovalsPage() {
  const user = await requireActiveUser();
  const approvals = await getApprovalQueueForUser(user.id);

  return (
    <AppShell user={user}>
      <PageHeader
        title="Phê duyệt"
        description="Các nhiệm vụ đang chờ bạn duyệt đăng ký hoặc xác nhận hoàn thành."
      />

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-950">Đang chờ xử lý</h2>
          <CountBadge>{approvals.length}</CountBadge>
        </div>
        <div className="grid gap-3">
          {approvals.map((approval) => (
            <article key={approval.id} className="rounded-md border border-slate-200 p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <Link href={`/tasks/${approval.taskId}`} className="block truncate text-sm font-semibold text-slate-950 hover:text-blue-700">
                    {approval.task.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>{approval.type === "registration" ? "Duyệt đăng ký" : "Duyệt hoàn thành"}</span>
                    <span>Cấp {approval.level}</span>
                    {approval.delegatedFor ? (
                      <span className="font-medium text-amber-700">
                        Trợ lý cho {approval.delegatedFor.displayName || approval.delegatedFor.username}
                      </span>
                    ) : null}
                    <PriorityBadge priority={approval.task.priority} />
                    <span>Dự án: {approval.task.project.name}</span>
                    <span>Hạn: {shortDate(approval.task.dueDate)}</span>
                  </div>
                </div>
                <div className="grid gap-2 sm:min-w-80">
                  <form action={approveTaskApprovalAction} className="flex gap-2">
                    <input type="hidden" name="approvalId" value={approval.id} />
                    <input name="note" placeholder="Ghi chú" className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm" />
                    <button type="submit" className="h-9 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700">
                      Duyệt
                    </button>
                  </form>
                  <form action={rejectTaskApprovalAction} className="flex gap-2">
                    <input type="hidden" name="approvalId" value={approval.id} />
                    <input name="note" required placeholder="Lý do từ chối" className="h-9 min-w-0 flex-1 rounded-md border border-red-200 px-3 text-sm" />
                    <button type="submit" className="h-9 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50">
                      Từ chối
                    </button>
                  </form>
                </div>
              </div>
            </article>
          ))}
          {approvals.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-500">
              Không có phê duyệt đang chờ.
            </div>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}
