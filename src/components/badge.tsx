import type { TaskPriority, TaskStatusOption } from "@prisma/client";
import { Flame, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { priorityLabel } from "@/lib/constants";

const statusClasses: Record<string, string> = {
  slate: "border-slate-300 bg-slate-100 text-slate-700",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  red: "border-red-200 bg-red-50 text-red-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
};

const priorityClasses: Record<TaskPriority, string> = {
  low: "border-slate-200 bg-white text-slate-500",
  normal: "border-slate-300 bg-slate-50 text-slate-700",
  high: "border-orange-200 bg-orange-50 text-orange-700",
  urgent: "border-red-200 bg-red-50 text-red-700",
};

export function StatusBadge({ status }: { status: Pick<TaskStatusOption, "label" | "color"> }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium",
        statusClasses[status.color] ?? statusClasses.slate,
      )}
    >
      {status.label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const icon =
    priority === "urgent" ? <Flame size={12} aria-hidden="true" /> : priority === "high" ? <TrendingUp size={12} aria-hidden="true" /> : null;

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs font-medium",
        priorityClasses[priority],
      )}
    >
      {icon}
      {priorityLabel(priority)}
    </span>
  );
}

export function CountBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex min-w-6 items-center justify-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
      {children}
    </span>
  );
}
