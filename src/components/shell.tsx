import type { ReactNode } from "react";
import { clsx } from "clsx";
import { BarChart3, LogOut } from "lucide-react";

import { logoutAction } from "@/app/actions/auth";
import { ShellNav, type ShellNavItem } from "@/components/shell-nav";
import { getApprovalQueueCountForUser } from "@/lib/approvals";
import { hasPermission, type CurrentUser } from "@/lib/authz";

const navItems = [
  { href: "/dashboard", label: "Tổng quan", iconKey: "dashboard", permission: null },
  { href: "/tasks", label: "Nhiệm vụ", iconKey: "tasks", permission: null },
  { href: "/kanban", label: "Kanban", iconKey: "kanban", permission: null },
  { href: "/approvals", label: "Phê duyệt", iconKey: "approvals", permission: null },
  { href: "/team", label: "Đội nhóm", iconKey: "team", permission: null },
  { href: "/settings", label: "Cài đặt", iconKey: "settings", permission: null },
  { href: "/admin/users", label: "Người dùng", iconKey: "users", permission: "user.manage" },
  { href: "/admin/projects", label: "Dự án", iconKey: "projects", permission: "project.manage" },
  { href: "/admin/roles", label: "Vai trò", iconKey: "roles", permission: "role.manage" },
  { href: "/admin/team", label: "Quản trị đội nhóm", iconKey: "adminTeam", permission: "team.manage.all" },
  { href: "/admin/exports", label: "Xuất dữ liệu", iconKey: "exports", permission: "export.run" },
] as const satisfies readonly (ShellNavItem & { permission: string | null })[];

export async function AppShell({
  user,
  children,
  fullHeight = false,
  mainClassName,
}: {
  user: CurrentUser;
  children: ReactNode;
  fullHeight?: boolean;
  mainClassName?: string;
}) {
  const approvalCount = await getApprovalQueueCountForUser(user.id);
  const visibleNav = navItems.reduce<ShellNavItem[]>((items, item) => {
    if (!item.permission || hasPermission(user, item.permission)) {
      items.push({ href: item.href, label: item.label, iconKey: item.iconKey });
    }
    return items;
  }, []);

  return (
    <div className={clsx("bg-slate-100 text-slate-950", fullHeight ? "h-dvh overflow-hidden" : "min-h-screen")}>
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white lg:block">
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-slate-950 text-white">
            <BarChart3 size={18} aria-hidden="true" />
          </div>
          <div>
            <div className="text-sm font-semibold">Task Tracker</div>
            <div className="text-xs text-slate-500">Hệ thống công việc nội bộ</div>
          </div>
        </div>
        <ShellNav items={visibleNav} approvalCount={approvalCount} variant="desktop" />
      </aside>

      <div className={clsx("lg:pl-64", fullHeight && "flex h-dvh min-h-0 flex-col overflow-hidden")}>
        <header className="sticky top-0 z-20 shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-8">
            <ShellNav items={visibleNav} approvalCount={approvalCount} variant="mobile" />

            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{user.displayName}</div>
              <div className="truncate text-xs text-slate-500">@{user.username}</div>
            </div>

            <form action={logoutAction}>
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                title="Đăng xuất"
              >
                <LogOut size={16} aria-hidden="true" />
                <span className="hidden sm:inline">Đăng xuất</span>
              </button>
            </form>
          </div>
        </header>
        <main
          className={clsx(
            fullHeight ? "min-h-0 flex-1 overflow-hidden px-4 py-6 lg:px-8" : "px-4 py-6 lg:px-8",
            mainClassName,
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
