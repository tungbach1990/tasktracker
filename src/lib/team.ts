import type { Prisma, TeamRelationStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const confirmedTeamStatuses: TeamRelationStatus[] = ["confirmed", "admin_confirmed"];
const cycleBlockingStatuses: TeamRelationStatus[] = ["pending", "confirmed", "admin_confirmed"];

export async function getDownlineUserIds(
  managerId: string,
  statuses: TeamRelationStatus[] = confirmedTeamStatuses,
  excludeRelationId?: string,
) {
  const visited = new Set<string>();
  let frontier = [managerId];

  while (frontier.length > 0) {
    const relations = await prisma.teamRelation.findMany({
      where: {
        managerId: { in: frontier },
        status: { in: statuses },
        id: excludeRelationId ? { not: excludeRelationId } : undefined,
      },
      select: { reportId: true },
    });

    const next: string[] = [];
    for (const relation of relations) {
      if (relation.reportId === managerId || visited.has(relation.reportId)) continue;
      visited.add(relation.reportId);
      next.push(relation.reportId);
    }

    frontier = next;
  }

  return Array.from(visited);
}

export async function getDirectReportLookup(managerId: string) {
  const relations = await prisma.teamRelation.findMany({
    where: { status: { in: confirmedTeamStatuses } },
    include: {
      report: { select: { id: true, username: true, displayName: true } },
    },
    orderBy: [{ managerId: "asc" }, { report: { displayName: "asc" } }],
  });

  const childrenByManager = new Map<string, typeof relations>();
  for (const relation of relations) {
    const children = childrenByManager.get(relation.managerId) ?? [];
    children.push(relation);
    childrenByManager.set(relation.managerId, children);
  }

  const directReportByUser = new Map<string, { id: string; username: string; displayName: string }>();
  const directReports = childrenByManager.get(managerId) ?? [];
  const queue = directReports.map((relation) => ({
    userId: relation.reportId,
    directReport: relation.report,
  }));

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || directReportByUser.has(item.userId)) continue;
    directReportByUser.set(item.userId, item.directReport);

    for (const child of childrenByManager.get(item.userId) ?? []) {
      queue.push({ userId: child.reportId, directReport: item.directReport });
    }
  }

  return directReportByUser;
}

export async function wouldCreateTeamCycle(managerId: string, reportId: string, excludeRelationId?: string) {
  if (managerId === reportId) return true;
  const reportDownline = await getDownlineUserIds(reportId, cycleBlockingStatuses, excludeRelationId);
  return reportDownline.includes(managerId);
}

export function activeRelationWhere(): Prisma.TeamRelationWhereInput {
  return { status: { in: confirmedTeamStatuses } };
}
