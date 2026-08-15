import Link from "next/link";
import { Columns3, FolderKanban, LayoutDashboard, Tags } from "lucide-react";

import { cn } from "@/lib/utils";

const items = [
  { href: "/settings/projects", key: "projects", label: "Dự án", icon: FolderKanban },
  { href: "/settings/statuses", key: "statuses", label: "Trạng thái", icon: Tags },
  { href: "/settings/dashboard", key: "dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/settings/kanban", key: "kanban", label: "Kanban", icon: Columns3 },
] as const;

export type SettingsSectionKey = (typeof items)[number]["key"];

export function SettingsNav({ current }: { current?: SettingsSectionKey }) {
  return (
    <nav className="mb-6 flex flex-wrap gap-2">
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium",
              current === item.key
                ? "border-slate-950 bg-slate-950 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            <Icon size={16} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
