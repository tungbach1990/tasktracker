import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import type { User } from "next-auth";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getActiveDelegationsForAssistant, getDownlineUserIds, hasActiveDelegation } from "@/lib/team";

export type CurrentUser = {
  id: string;
  username: string;
  displayName: string;
  mustChangePass: boolean;
  currentProjectId: string | null;
  permissions: string[];
  projectIds: string[];
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const sessionUser = session?.user as User & {
    id?: string;
    username?: string;
    mustChangePass?: boolean;
    permissions?: string[];
  };

  if (!sessionUser?.id) return null;

  return {
    id: sessionUser.id,
    username: sessionUser.username ?? sessionUser.email ?? "",
    displayName: sessionUser.name ?? sessionUser.username ?? "User",
    mustChangePass: Boolean(sessionUser.mustChangePass),
    currentProjectId: null,
    permissions: sessionUser.permissions ?? [],
    projectIds: [],
  };
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireActiveUser(): Promise<CurrentUser> {
  const sessionUser = await requireUser();
  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    include: {
      roles: {
        include: {
          role: {
            include: {
              permissions: {
                include: { permission: true },
              },
            },
          },
        },
      },
      projectScopes: true,
    },
  });

  if (!user?.enabled) redirect("/login");

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    mustChangePass: user.mustChangePass,
    currentProjectId: user.currentProjectId,
    permissions: Array.from(
      new Set(
        user.roles.flatMap((userRole) =>
          userRole.role.permissions.map((rolePermission) => rolePermission.permission.key),
        ),
      ),
    ),
    projectIds: user.projectScopes.map((scope) => scope.projectId),
  };
}

export async function requirePermission(permission: string) {
  const user = await requireActiveUser();
  if (!user.permissions.includes(permission)) {
    redirect("/dashboard");
  }
  return user;
}

export function hasPermission(user: Pick<CurrentUser, "permissions">, permission: string) {
  return user.permissions.includes(permission);
}

async function permissionKeysForUser(userId: string) {
  const roles = await prisma.userRole.findMany({
    where: { userId },
    include: {
      role: {
        include: {
          permissions: {
            include: { permission: true },
          },
        },
      },
    },
  });

  return Array.from(
    new Set(
      roles.flatMap((userRole) =>
        userRole.role.permissions.map((rolePermission) => rolePermission.permission.key),
      ),
    ),
  );
}

async function delegatedTaskFilters(actorId: string) {
  const delegations = await getActiveDelegationsForAssistant(actorId);
  const filters: Prisma.TaskWhereInput[] = [];

  for (const delegation of delegations) {
    const { managerId, projectId } = delegation;
    const permissions = await permissionKeysForUser(managerId);
    if (permissions.includes("task.view.all")) {
      filters.push({ projectId });
      continue;
    }

    if (permissions.includes("task.view.own")) {
      filters.push({
        projectId,
        OR: [{ ownerId: managerId }, { ownerId: null, createdById: managerId }],
      });
    }

    filters.push(
      { projectId, performerId: managerId },
      {
        projectId,
        employees: {
          some: {
            employee: {
              linkedUserId: managerId,
              linkStatus: "confirmed",
            },
          },
        },
      },
      {
        projectId,
        approvals: {
          some: {
            reviewerId: managerId,
            status: "pending",
          },
        },
      },
    );

    if (permissions.includes("team.view.downline")) {
      const downlineIds = await getDownlineUserIds(managerId);
      if (downlineIds.length > 0) {
        filters.push({
          projectId,
          OR: [
            { ownerId: { in: downlineIds } },
            { ownerId: null, createdById: { in: downlineIds } },
          ],
        });
      }
    }
  }

  return { all: false, filters };
}

export async function taskAccessWhere(user: CurrentUser): Promise<Prisma.TaskWhereInput> {
  const notDeleted: Prisma.TaskWhereInput = { deletedAt: null };
  if (hasPermission(user, "task.view.all")) return notDeleted;

  const filters: Prisma.TaskWhereInput[] = [];

  if (hasPermission(user, "task.view.own")) {
    filters.push({ OR: [{ ownerId: user.id }, { ownerId: null, createdById: user.id }] });
  }

  filters.push(
    { performerId: user.id },
    {
      employees: {
        some: {
          employee: {
            linkedUserId: user.id,
            linkStatus: "confirmed",
          },
        },
      },
    },
    {
      approvals: {
        some: {
          reviewerId: user.id,
          status: "pending",
        },
      },
    },
  );

  if (hasPermission(user, "team.view.downline")) {
    const downlineIds = await getDownlineUserIds(user.id);
    if (downlineIds.length > 0) {
      filters.push({
        OR: [
          { ownerId: { in: downlineIds } },
          { ownerId: null, createdById: { in: downlineIds } },
        ],
      });
    }
  }

  const delegated = await delegatedTaskFilters(user.id);
  filters.push(...delegated.filters);

  return filters.length > 0 ? { AND: [notDeleted, { OR: filters }] } : { id: { in: [] } };
}

export async function canActAsDelegatedManager(actorId: string, managerId: string, projectId: string) {
  return hasActiveDelegation(managerId, actorId, projectId);
}

export async function isTaskInDelegatedScope(actorId: string, taskId: string) {
  const delegated = await delegatedTaskFilters(actorId);
  if (delegated.filters.length === 0) return false;

  const task = await prisma.task.findFirst({
    where: {
      AND: [{ id: taskId, deletedAt: null }, { OR: delegated.filters }],
    },
    select: { id: true },
  });

  return Boolean(task);
}

export async function canAccessProject(userId: string, projectId: string, canViewAll: boolean) {
  if (canViewAll) return true;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      currentProjectId: true,
      projectScopes: {
        where: { projectId },
        select: { projectId: true },
      },
    },
  });

  return user?.currentProjectId === projectId || Boolean(user?.projectScopes.length);
}

export async function canAccessTask(user: CurrentUser, taskId: string) {
  return canViewTask(user, taskId);
}

export async function canViewTask(user: CurrentUser, taskId: string) {
  if (hasPermission(user, "task.view.all")) return true;

  const accessWhere = await taskAccessWhere(user);
  const task = await prisma.task.findFirst({
    where: {
      AND: [{ id: taskId }, accessWhere],
    },
    select: { id: true },
  });

  return Boolean(task);
}

export async function canEditTask(user: CurrentUser, taskId: string) {
  const delegated = await isTaskInDelegatedScope(user.id, taskId);
  if (!hasPermission(user, "task.update") && !delegated) return false;
  if (hasPermission(user, "task.view.all")) return true;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { createdById: true, ownerId: true },
  });

  return task?.createdById === user.id || task?.ownerId === user.id || delegated;
}

export async function canUpdateTaskExecution(user: CurrentUser, taskId: string) {
  const canUpdateByRole = hasPermission(user, "task.update");
  if (hasPermission(user, "task.view.all")) return true;
  const delegated = await isTaskInDelegatedScope(user.id, taskId);
  if (!canUpdateByRole && !delegated) return false;

  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      OR: [
        { createdById: user.id },
        { ownerId: user.id },
        { performerId: user.id },
        {
          employees: {
            some: {
              employee: {
                linkedUserId: user.id,
                linkStatus: "confirmed",
              },
            },
          },
        },
        ...(delegated ? [{ id: taskId }] : []),
      ],
    },
    select: { id: true },
  });

  return Boolean(task);
}

export async function canDeleteTask(user: CurrentUser, taskId: string) {
  if (!hasPermission(user, "task.delete")) return false;
  if (hasPermission(user, "task.view.all")) return true;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { createdById: true, ownerId: true },
  });

  return task?.createdById === user.id || task?.ownerId === user.id;
}
