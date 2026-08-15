"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";

import { hasPermission, requireActiveUser, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { ensureUserCurrentProject } from "@/lib/projects";
import { copyDefaultSettingsForUser } from "@/lib/settings";
import { findBlockingDirectManager, wouldCreateTeamCycle } from "@/lib/team";
import {
  directReportUserFormSchema,
  employeeLinkResponseSchema,
  existingReportRequestSchema,
  idSchema,
  normalizedKey,
  teamDelegationFormSchema,
  teamRelationFormSchema,
  transferDirectReportFormSchema,
} from "@/lib/validation";

function revalidateTeamViews() {
  revalidatePath("/team");
  revalidatePath("/admin/team");
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  revalidatePath("/approvals");
  revalidatePath("/kanban");
  revalidatePath("/settings");
}

async function requireTeamManager() {
  const user = await requireActiveUser();
  if (!hasPermission(user, "team.manage.own") && !hasPermission(user, "team.manage.all")) {
    redirect("/dashboard");
  }
  return user;
}

async function ensureMemberRoleId() {
  const role = await prisma.role.upsert({
    where: { name: "Member" },
    update: { system: true },
    create: {
      name: "Member",
      description: "Thành viên xử lý nhiệm vụ mặc định",
      system: true,
    },
    select: { id: true },
  });

  return role.id;
}

function employeeNameFromUser(report: { username: string; displayName: string }) {
  return report.displayName || report.username;
}

async function uniqueEmployeeKey(
  tx: Prisma.TransactionClient,
  ownerId: string,
  preferredKey: string,
) {
  const base = (preferredKey || "user").slice(0, 64);
  let key = base;
  let suffix = 2;

  while (await tx.employee.findUnique({ where: { ownerId_key: { ownerId, key } }, select: { id: true } })) {
    const marker = `-${suffix}`;
    key = `${base.slice(0, 64 - marker.length)}${marker}`;
    suffix += 1;
  }

  return key;
}

async function ensureInternalEmployeeForReport(
  tx: Prisma.TransactionClient,
  params: {
    managerId: string;
    report: { id: string; username: string; displayName: string };
    projectId: string;
    linkStatus: "pending" | "confirmed";
  },
) {
  const now = new Date();
  const existingEmployee = await tx.employee.findFirst({
    where: { ownerId: params.managerId, linkedUserId: params.report.id },
    select: { id: true },
  });
  const employeeData = {
    name: employeeNameFromUser(params.report),
    active: true,
    linkedUserId: params.report.id,
    linkStatus: params.linkStatus,
    linkRequestedAt: now,
    linkRespondedAt: params.linkStatus === "confirmed" ? now : null,
  };

  const employee = existingEmployee
    ? await tx.employee.update({
        where: { id: existingEmployee.id },
        data: employeeData,
        select: { id: true },
      })
    : await tx.employee.create({
        data: {
          ownerId: params.managerId,
          key: await uniqueEmployeeKey(
            tx,
            params.managerId,
            normalizedKey(`user-${params.report.username}`, params.report.id),
          ),
          ...employeeData,
        },
        select: { id: true },
      });

  await tx.employeeProject.upsert({
    where: { employeeId_projectId: { employeeId: employee.id, projectId: params.projectId } },
    update: {},
    create: { employeeId: employee.id, projectId: params.projectId },
  });

  return employee.id;
}

export async function createDirectReportUserAction(formData: FormData) {
  const manager = await requireTeamManager();
  const data = directReportUserFormSchema.parse({
    username: formData.get("username"),
    displayName: formData.get("displayName"),
    password: formData.get("password"),
  });

  const [memberRoleId, managerProjectId, existingUser] = await Promise.all([
    ensureMemberRoleId(),
    ensureUserCurrentProject(prisma, manager.id),
    prisma.user.findUnique({ where: { username: data.username }, select: { id: true } }),
  ]);
  if (!managerProjectId || existingUser) redirect("/team");

  const createdUser = await prisma.$transaction(async (tx) => {
    const report = await tx.user.create({
      data: {
        username: data.username,
        displayName: data.displayName,
        passwordHash: await bcrypt.hash(data.password, 12),
        enabled: true,
        mustChangePass: true,
        currentProjectId: managerProjectId,
        roles: {
          create: { roleId: memberRoleId },
        },
        projectScopes: {
          create: { projectId: managerProjectId },
        },
      },
      select: { id: true, username: true, displayName: true },
    });

    const employeeId = await ensureInternalEmployeeForReport(tx, {
      managerId: manager.id,
      report,
      projectId: managerProjectId,
      linkStatus: "confirmed",
    });

    await tx.teamRelation.create({
      data: {
        managerId: manager.id,
        reportId: report.id,
        createdById: manager.id,
        sourceEmployeeId: employeeId,
        status: "confirmed",
      },
    });

    return report;
  });

  await copyDefaultSettingsForUser(prisma, createdUser.id);
  revalidateTeamViews();
}

export async function requestExistingUserReportAction(formData: FormData) {
  const manager = await requireTeamManager();
  const data = existingReportRequestSchema.parse({
    reportId: formData.get("reportId"),
  });
  if (data.reportId === manager.id) redirect("/team");

  const [report, managerProjectId, existingRelation] = await Promise.all([
    prisma.user.findFirst({
      where: { id: data.reportId, enabled: true },
      select: { id: true, username: true, displayName: true },
    }),
    ensureUserCurrentProject(prisma, manager.id),
    prisma.teamRelation.findUnique({
      where: { managerId_reportId: { managerId: manager.id, reportId: data.reportId } },
      select: { id: true, status: true },
    }),
  ]);
  if (!report || !managerProjectId) redirect("/team");

  const blockingDirectManager = await findBlockingDirectManager(report.id, existingRelation?.id);
  if (blockingDirectManager) redirect("/team");

  const wouldCycle = await wouldCreateTeamCycle(manager.id, report.id, existingRelation?.id);
  if (wouldCycle) redirect("/team");

  await prisma.$transaction(async (tx) => {
    const relationAlreadyConfirmed = existingRelation
      ? existingRelation.status === "confirmed" || existingRelation.status === "admin_confirmed"
      : false;
    const employeeId = await ensureInternalEmployeeForReport(tx, {
      managerId: manager.id,
      report,
      projectId: managerProjectId,
      linkStatus: relationAlreadyConfirmed ? "confirmed" : "pending",
    });

    await tx.teamRelation.upsert({
      where: { managerId_reportId: { managerId: manager.id, reportId: report.id } },
      update: {
        sourceEmployeeId: employeeId,
        createdById: manager.id,
        status: relationAlreadyConfirmed ? existingRelation!.status : "pending",
      },
      create: {
        managerId: manager.id,
        reportId: report.id,
        sourceEmployeeId: employeeId,
        createdById: manager.id,
        status: "pending",
      },
    });
  });

  revalidateTeamViews();
}

export async function respondEmployeeLinkAction(formData: FormData) {
  const user = await requireActiveUser();
  const data = employeeLinkResponseSchema.parse({
    relationId: formData.get("relationId"),
    decision: formData.get("decision"),
  });

  const relation = await prisma.teamRelation.findUnique({
    where: { id: data.relationId },
    include: { sourceEmployee: true },
  });
  if (!relation) redirect("/team");
  if (relation.reportId !== user.id && !hasPermission(user, "team.manage.all")) redirect("/dashboard");

  if (data.decision === "approve") {
    const blockingDirectManager = await findBlockingDirectManager(relation.reportId, relation.id);
    if (blockingDirectManager) redirect("/team");

    const wouldCycle = await wouldCreateTeamCycle(relation.managerId, relation.reportId, relation.id);
    if (wouldCycle) redirect("/team");

    const writes: Prisma.PrismaPromise<unknown>[] = [
      prisma.teamRelation.update({
        where: { id: relation.id },
        data: { status: hasPermission(user, "team.manage.all") ? "admin_confirmed" : "confirmed" },
      }),
    ];
    if (relation.sourceEmployeeId) {
      writes.push(
        prisma.employee.update({
            where: { id: relation.sourceEmployeeId },
            data: {
              linkedUserId: relation.reportId,
              linkStatus: "confirmed",
              linkRespondedAt: new Date(),
            },
        }),
      );
    }
    await prisma.$transaction(writes);
  } else {
    const writes: Prisma.PrismaPromise<unknown>[] = [
      prisma.teamRelation.update({
        where: { id: relation.id },
        data: { status: "rejected" },
      }),
    ];
    if (relation.sourceEmployeeId) {
      writes.push(
        prisma.employee.update({
            where: { id: relation.sourceEmployeeId },
            data: {
              linkStatus: "rejected",
              linkRespondedAt: new Date(),
            },
        }),
      );
    }
    await prisma.$transaction(writes);
  }

  revalidateTeamViews();
}

export async function saveTeamRelationAction(formData: FormData) {
  const admin = await requirePermission("team.manage.all");
  const data = teamRelationFormSchema.parse({
    id: formData.get("id") || undefined,
    managerId: formData.get("managerId"),
    reportId: formData.get("reportId"),
    status: formData.get("status") || "admin_confirmed",
  });

  const activeOrPending = data.status !== "rejected";
  if (activeOrPending) {
    const blockingDirectManager = await findBlockingDirectManager(data.reportId, data.id);
    if (blockingDirectManager) redirect("/admin/team");

    const wouldCycle = await wouldCreateTeamCycle(data.managerId, data.reportId, data.id);
    if (wouldCycle) redirect("/admin/team");
  }

  if (data.id) {
    await prisma.teamRelation.update({
      where: { id: data.id },
      data: {
        managerId: data.managerId,
        reportId: data.reportId,
        status: data.status,
        createdById: admin.id,
      },
    });
  } else {
    await prisma.teamRelation.upsert({
      where: { managerId_reportId: { managerId: data.managerId, reportId: data.reportId } },
      update: { status: data.status, createdById: admin.id },
      create: {
        managerId: data.managerId,
        reportId: data.reportId,
        status: data.status,
        createdById: admin.id,
      },
    });
  }

  revalidateTeamViews();
}

export async function transferDirectReportAction(formData: FormData) {
  const admin = await requirePermission("team.manage.all");
  const data = transferDirectReportFormSchema.parse({
    managerId: formData.get("managerId"),
    reportId: formData.get("reportId"),
  });
  if (data.managerId === data.reportId) redirect("/admin/team");

  const [manager, report, managerProjectId] = await Promise.all([
    prisma.user.findFirst({
      where: { id: data.managerId, enabled: true },
      select: { id: true, username: true, displayName: true },
    }),
    prisma.user.findFirst({
      where: { id: data.reportId, enabled: true },
      select: { id: true, username: true, displayName: true },
    }),
    ensureUserCurrentProject(prisma, data.managerId),
  ]);
  if (!manager || !report || !managerProjectId) redirect("/admin/team");

  const existingNewRelation = await prisma.teamRelation.findUnique({
    where: { managerId_reportId: { managerId: data.managerId, reportId: data.reportId } },
    select: { id: true },
  });
  const wouldCycle = await wouldCreateTeamCycle(data.managerId, data.reportId, existingNewRelation?.id);
  if (wouldCycle) redirect("/admin/team");

  const oldRelations = await prisma.teamRelation.findMany({
    where: {
      reportId: data.reportId,
      managerId: { not: data.managerId },
      status: { in: ["pending", "confirmed", "admin_confirmed"] },
    },
    select: { id: true, sourceEmployeeId: true },
  });

  await prisma.$transaction(async (tx) => {
    const employeeId = await ensureInternalEmployeeForReport(tx, {
      managerId: manager.id,
      report,
      projectId: managerProjectId,
      linkStatus: "confirmed",
    });

    if (oldRelations.length > 0) {
      await tx.teamRelation.updateMany({
        where: { id: { in: oldRelations.map((relation) => relation.id) } },
        data: { status: "rejected", createdById: admin.id },
      });

      const oldEmployeeIds = oldRelations
        .map((relation) => relation.sourceEmployeeId)
        .filter((id): id is string => Boolean(id));
      if (oldEmployeeIds.length > 0) {
        await tx.employee.updateMany({
          where: { id: { in: oldEmployeeIds } },
          data: {
            active: false,
            linkStatus: "rejected",
            linkRespondedAt: new Date(),
          },
        });
      }
    }

    await tx.teamRelation.upsert({
      where: { managerId_reportId: { managerId: manager.id, reportId: report.id } },
      update: {
        sourceEmployeeId: employeeId,
        createdById: admin.id,
        status: "admin_confirmed",
      },
      create: {
        managerId: manager.id,
        reportId: report.id,
        sourceEmployeeId: employeeId,
        createdById: admin.id,
        status: "admin_confirmed",
      },
    });
  });

  revalidateTeamViews();
}

export async function saveTeamDelegationAction(formData: FormData) {
  const admin = await requirePermission("team.manage.all");
  const data = teamDelegationFormSchema.parse({
    managerId: formData.get("managerId"),
    assistantId: formData.get("assistantId"),
    projectId: formData.get("projectId"),
  });
  if (data.managerId === data.assistantId) redirect("/admin/team");

  const [users, project] = await Promise.all([
    prisma.user.count({
      where: { id: { in: [data.managerId, data.assistantId] }, enabled: true },
    }),
    prisma.project.findFirst({
      where: { id: data.projectId, active: true },
      select: { id: true },
    }),
  ]);
  if (users !== 2 || !project) redirect("/admin/team");

  await prisma.teamDelegation.upsert({
    where: {
      managerId_assistantId_projectId: {
        managerId: data.managerId,
        assistantId: data.assistantId,
        projectId: data.projectId,
      },
    },
    update: {
      active: true,
      revokedAt: null,
      createdById: admin.id,
    },
    create: {
      managerId: data.managerId,
      assistantId: data.assistantId,
      projectId: data.projectId,
      createdById: admin.id,
      active: true,
    },
  });

  revalidateTeamViews();
}

export async function revokeTeamDelegationAction(formData: FormData) {
  await requirePermission("team.manage.all");
  const id = idSchema.parse(formData.get("id"));

  await prisma.teamDelegation.update({
    where: { id },
    data: {
      active: false,
      revokedAt: new Date(),
    },
  });

  revalidateTeamViews();
}

export async function deleteTeamRelationAction(formData: FormData) {
  await requirePermission("team.manage.all");
  const id = idSchema.parse(formData.get("id"));
  const relation = await prisma.teamRelation.findUnique({
    where: { id },
    select: { sourceEmployeeId: true },
  });
  if (!relation) return;

  const writes: Prisma.PrismaPromise<unknown>[] = [
    prisma.teamRelation.delete({ where: { id } }),
  ];
  if (relation.sourceEmployeeId) {
    writes.push(
      prisma.employee.update({
          where: { id: relation.sourceEmployeeId },
          data: {
            linkedUserId: null,
            linkStatus: "none",
            linkRequestedAt: null,
            linkRespondedAt: null,
          },
      }),
    );
  }
  await prisma.$transaction(writes);

  revalidateTeamViews();
}
