"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";
import {
  ClipboardCheck,
  Download,
  FolderKanban,
  LayoutDashboard,
  Repeat2,
  Settings,
  Shield,
  Trash2,
  Users,
  UsersRound,
} from "lucide-react";

const icons = {
  dashboard: LayoutDashboard,
  tasks: FolderKanban,
  recurringTasks: Repeat2,
  kanban: FolderKanban,
  approvals: ClipboardCheck,
  team: UsersRound,
  trash: Trash2,
  settings: Settings,
  users: Users,
  projects: FolderKanban,
  roles: Shield,
  adminTeam: UsersRound,
  exports: Download,
} satisfies Record<string, LucideIcon>;

export type ShellNavIconKey = keyof typeof icons;

export type ShellNavItem = {
  href: string;
  label: string;
  iconKey: ShellNavIconKey;
};

export function ShellNav({
  items,
  badgeCounts,
  variant,
}: {
  items: readonly ShellNavItem[];
  badgeCounts: Record<string, number>;
  variant: "desktop" | "mobile";
}) {
  const pathname = usePathname() ?? "";

  if (variant === "mobile") {
    return (
      <nav className="flex flex-wrap gap-1 lg:hidden">
        {items.map((item) => (
          <MobileNavLink
            key={item.href}
            item={item}
            active={isActiveRoute(pathname, item.href)}
            badgeCount={badgeCounts[item.href] ?? 0}
          />
        ))}
      </nav>
    );
  }

  return (
    <nav className="space-y-1 p-3">
      {items.map((item) => (
        <DesktopNavLink
          key={item.href}
          item={item}
          active={isActiveRoute(pathname, item.href)}
          badgeCount={badgeCounts[item.href] ?? 0}
        />
      ))}
    </nav>
  );
}

function DesktopNavLink({
  item,
  active,
  badgeCount,
}: {
  item: ShellNavItem;
  active: boolean;
  badgeCount: number;
}) {
  const Icon = icons[item.iconKey];
  const hasBadge = badgeCount > 0;
  const hasApprovalBadge = item.href === "/approvals" && hasBadge;

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex h-10 items-center gap-3 rounded-md border px-3 text-sm font-medium transition-colors",
        active
          ? "border-slate-900 bg-slate-900 text-white shadow-sm hover:bg-slate-800 hover:text-white"
          : hasApprovalBadge
            ? "border-amber-300 bg-amber-50 text-amber-900 shadow-sm hover:bg-amber-100 hover:text-amber-950"
            : "border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-950",
      )}
    >
      <Icon
        size={17}
        aria-hidden="true"
        className={clsx(active ? "text-white" : hasApprovalBadge ? "text-amber-700" : "text-inherit")}
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {hasBadge ? <NavBadge count={badgeCount} active={active} tone={hasApprovalBadge ? "approval" : "default"} /> : null}
    </Link>
  );
}

function MobileNavLink({
  item,
  active,
  badgeCount,
}: {
  item: ShellNavItem;
  active: boolean;
  badgeCount: number;
}) {
  const Icon = icons[item.iconKey];
  const hasBadge = badgeCount > 0;
  const hasApprovalBadge = item.href === "/approvals" && hasBadge;

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "relative inline-flex size-10 items-center justify-center rounded-md border transition-colors hover:bg-slate-100",
        active
          ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
          : hasApprovalBadge
            ? "border-amber-300 bg-amber-50 text-amber-800"
            : "border-transparent text-slate-600",
      )}
      title={item.label}
    >
      <Icon size={18} aria-hidden="true" />
      {hasBadge ? (
        <NavBadge count={badgeCount} active={active} tone={hasApprovalBadge ? "approval" : "default"} compact />
      ) : null}
      <span className="sr-only">{item.label}</span>
    </Link>
  );
}

function NavBadge({
  count,
  active,
  tone,
  compact = false,
}: {
  count: number;
  active: boolean;
  tone: "approval" | "default";
  compact?: boolean;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center rounded-full font-bold leading-none",
        compact
          ? "absolute -right-1 -top-1 min-w-5 px-1 text-[10px] leading-5"
          : "min-w-6 px-1.5 py-0.5 text-[11px]",
        tone === "approval"
          ? active
            ? "bg-amber-400 text-slate-950"
            : "bg-amber-600 text-white"
          : active
            ? "bg-blue-200 text-blue-950"
            : "bg-blue-100 text-blue-800",
      )}
    >
      {formatNavBadge(count)}
    </span>
  );
}

function isActiveRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function formatNavBadge(count: number) {
  return count > 99 ? "99+" : String(count);
}
