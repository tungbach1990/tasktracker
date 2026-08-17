"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { archiveGlobalProject, setUserCurrentProject } from "@/lib/projects";
import { copyDefaultSettingsForUser } from "@/lib/settings";
import { writeExportFile } from "@/lib/export-storage";
import {
  formArray,
  formBoolean,
  idSchema,
  normalizedKey,
  projectFormSchema,
  resetPasswordSchema,
  roleFormSchema,
  updateUserFormSchema,
  userFormSchema,
} from "@/lib/validation";

async function roleIdsWithMember(roleIds: string[]) {
  const memberRole = await prisma.role.findUnique({
    where: { name: "Member" },
    select: { id: true },
  });

  return Array.from(new Set(memberRole ? [...roleIds, memberRole.id] : roleIds));
}

function revalidateAdminProjectViews() {
  revalidatePath("/admin/users");
  revalidatePath("/admin/projects");
  revalidatePath("/settings");
  revalidatePath("/settings/projects");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function createUserAction(formData: FormData) {
  await requirePermission("user.manage");
  const data = userFormSchema.parse({
    username: formData.get("username"),
    displayName: formData.get("displayName"),
    password: formData.get("password"),
    enabled: formBoolean(formData, "enabled"),
    roleIds: formArray(formData, "roleIds"),
    projectIds: [],
  });
  const roleIds = await roleIdsWithMember(data.roleIds);

  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = await prisma.user.create({
    data: {
      username: data.username,
      displayName: data.displayName,
      passwordHash,
      enabled: data.enabled,
      mustChangePass: true,
      roles: {
        createMany: {
          data: roleIds.map((roleId) => ({ roleId })),
          skipDuplicates: true,
        },
      },
    },
  });

  await copyDefaultSettingsForUser(prisma, user.id);
  revalidatePath("/admin/users");
}

export async function updateUserAction(formData: FormData) {
  await requirePermission("user.manage");
  const data = updateUserFormSchema.parse({
    id: formData.get("id"),
    username: formData.get("username"),
    displayName: formData.get("displayName"),
    enabled: formBoolean(formData, "enabled"),
    roleIds: formArray(formData, "roleIds"),
    projectIds: [],
  });
  const roleIds = await roleIdsWithMember(data.roleIds);

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: data.id } }),
    prisma.user.update({
      where: { id: data.id },
      data: {
        username: data.username,
        displayName: data.displayName,
        enabled: data.enabled,
        roles: {
          createMany: {
            data: roleIds.map((roleId) => ({ roleId })),
            skipDuplicates: true,
          },
        },
      },
    }),
  ]);

  await copyDefaultSettingsForUser(prisma, data.id);
  revalidatePath("/admin/users");
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
}

export async function resetPasswordAction(formData: FormData) {
  await requirePermission("user.manage");
  const data = resetPasswordSchema.parse({
    id: formData.get("id"),
    password: formData.get("password"),
  });

  await prisma.user.update({
    where: { id: data.id },
    data: {
      passwordHash: await bcrypt.hash(data.password, 12),
      mustChangePass: true,
    },
  });

  revalidatePath("/admin/users");
}

export async function createProjectAction(formData: FormData) {
  await requirePermission("project.manage");
  const data = projectFormSchema.parse({
    key: formData.get("key"),
    name: formData.get("name"),
    description: formData.get("description") || "",
  });
  const key = normalizedKey(data.key, data.name);

  await prisma.project.upsert({
    where: { key },
    update: {
      name: data.name,
      description: data.description,
      active: true,
    },
    create: {
      key,
      name: data.name,
      description: data.description,
    },
  });

  revalidateAdminProjectViews();
}

export async function updateProjectAction(formData: FormData) {
  await requirePermission("project.manage");
  const data = projectFormSchema.parse({
    id: formData.get("id") || undefined,
    key: formData.get("key"),
    name: formData.get("name"),
    description: formData.get("description") || "",
  });
  if (!data.id) return;

  await prisma.project.update({
    where: { id: data.id },
    data: {
      key: normalizedKey(data.key, data.name),
      name: data.name,
      description: data.description,
      active: true,
    },
  });

  revalidateAdminProjectViews();
}

export async function setCurrentProjectAction(formData: FormData) {
  await requirePermission("project.manage");
  const userId = idSchema.parse(formData.get("userId"));
  const projectId = idSchema.parse(formData.get("projectId"));

  const currentProjectId = await setUserCurrentProject(prisma, userId, projectId);
  if (!currentProjectId) redirect("/admin/projects");

  revalidateAdminProjectViews();
}

export async function archiveAdminProjectAction(formData: FormData) {
  await requirePermission("project.manage");
  const id = idSchema.parse(formData.get("id"));
  await archiveGlobalProject(prisma, id);
  revalidateAdminProjectViews();
}

export async function saveRoleAction(formData: FormData) {
  await requirePermission("role.manage");
  const data = roleFormSchema.parse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    description: formData.get("description") || "",
    permissionIds: formArray(formData, "permissionIds"),
  });

  if (data.id) {
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: data.id } }),
      prisma.role.update({
        where: { id: data.id },
        data: {
          name: data.name,
          description: data.description,
          permissions: {
            createMany: {
              data: data.permissionIds.map((permissionId) => ({ permissionId })),
              skipDuplicates: true,
            },
          },
        },
      }),
    ]);
  } else {
    await prisma.role.create({
      data: {
        name: data.name,
        description: data.description,
        permissions: {
          createMany: {
            data: data.permissionIds.map((permissionId) => ({ permissionId })),
            skipDuplicates: true,
          },
        },
      },
    });
  }

  revalidatePath("/admin/roles");
  revalidatePath("/admin/users");
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
}

export async function deleteRoleAction(formData: FormData) {
  await requirePermission("role.manage");
  const id = String(formData.get("id") || "");
  if (!id) return;

  const role = await prisma.role.findUnique({ where: { id } });
  if (role?.system) return;

  await prisma.role.delete({ where: { id } });
  revalidatePath("/admin/roles");
  revalidatePath("/admin/users");
}

export async function runExportAction(formData: FormData) {
  const user = await requirePermission("export.run");
  const format = formData.get("format") === "json" ? "json" : "markdown";
  const { buildJsonExport, buildMarkdownExport, exportFileName } = await import("@/lib/export");

  const tasks = await prisma.task.findMany({
    include: {
      project: true,
      status: true,
      parent: { select: { id: true, title: true } },
      recurringTask: { select: { id: true, title: true } },
      createdBy: { select: { username: true, displayName: true } },
      updatedBy: { select: { username: true, displayName: true } },
      employees: {
        include: {
          employee: true,
        },
      },
      comments: {
        include: {
          user: { select: { username: true, displayName: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      history: {
        include: {
          user: { select: { username: true, displayName: true } },
          onBehalfOf: { select: { username: true, displayName: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      approvals: {
        include: {
          reviewer: { select: { username: true, displayName: true } },
          delegatedFor: { select: { username: true, displayName: true } },
        },
        orderBy: [{ type: "asc" }, { round: "asc" }, { level: "asc" }],
      },
    },
    orderBy: [{ project: { name: "asc" } }, { status: { sortOrder: "asc" } }, { dueDate: "asc" }],
  });

  const content =
    format === "markdown"
      ? buildMarkdownExport(tasks)
      : buildJsonExport({
          users: (await prisma.user.findMany({ orderBy: { username: "asc" } })).map(
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            ({ passwordHash, ...safeUser }) => safeUser,
          ),
          roles: await prisma.role.findMany({ orderBy: { name: "asc" } }),
          permissions: await prisma.permission.findMany({ orderBy: { key: "asc" } }),
          rolePermissions: await prisma.rolePermission.findMany(),
          userRoles: await prisma.userRole.findMany(),
          projects: await prisma.project.findMany({ orderBy: { name: "asc" } }),
          userProjects: await prisma.userProject.findMany(),
          statuses: await prisma.taskStatusOption.findMany({ orderBy: [{ ownerId: "asc" }, { sortOrder: "asc" }] }),
          employees: await prisma.employee.findMany({ orderBy: [{ ownerId: "asc" }, { name: "asc" }] }),
          employeeProjects: await prisma.employeeProject.findMany({ orderBy: [{ employeeId: "asc" }, { projectId: "asc" }] }),
          dashboardSections: await prisma.dashboardSectionPreference.findMany({ orderBy: [{ ownerId: "asc" }, { sortOrder: "asc" }] }),
          kanbanColumns: await prisma.kanbanColumnPreference.findMany({ orderBy: [{ ownerId: "asc" }, { sortOrder: "asc" }, { columnKey: "asc" }] }),
          teamRelations: await prisma.teamRelation.findMany({ orderBy: [{ managerId: "asc" }, { reportId: "asc" }] }),
          teamDelegations: await prisma.teamDelegation.findMany({ orderBy: [{ projectId: "asc" }, { managerId: "asc" }, { assistantId: "asc" }] }),
          recurringTasks: await prisma.recurringTask.findMany({ orderBy: [{ projectId: "asc" }, { ownerId: "asc" }, { title: "asc" }] }),
          recurringTaskEmployees: await prisma.recurringTaskEmployee.findMany({ orderBy: [{ recurringTaskId: "asc" }, { employeeId: "asc" }] }),
          taskApprovals: await prisma.taskApproval.findMany({ orderBy: [{ taskId: "asc" }, { type: "asc" }, { round: "asc" }, { level: "asc" }] }),
          tasks,
        });

  const fileName = exportFileName(format);
  const filePath = await writeExportFile(fileName, content);
  await prisma.exportJob.create({
    data: {
      format,
      status: "completed",
      fileName,
      content: "",
      filePath,
      createdById: user.id,
    },
  });

  revalidatePath("/admin/exports");
  redirect("/admin/exports");
}
