import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const permissions = [
  ["task.view.all", "Xem tất cả nhiệm vụ", "Xem mọi nhiệm vụ của toàn bộ người dùng và dự án"],
  ["task.view.own", "Xem nhiệm vụ của mình", "Xem nhiệm vụ do chính mình tạo"],
  ["task.create", "Tạo nhiệm vụ", "Tạo nhiệm vụ mới"],
  ["task.update", "Cập nhật nhiệm vụ", "Sửa thông tin và trạng thái nhiệm vụ"],
  ["task.delete", "Xóa nhiệm vụ", "Xóa nhiệm vụ"],
  ["project.manage", "Quản lý dự án", "Tạo, sửa, lưu trữ và gán dự án hiện tại"],
  ["user.manage", "Quản lý người dùng", "Tạo người dùng và đặt lại mật khẩu"],
  ["role.manage", "Quản lý vai trò", "Tạo vai trò và gán quyền"],
  ["export.run", "Xuất dữ liệu", "Xuất nhiệm vụ và dữ liệu sao lưu"],
  ["team.manage.own", "Quản lý đội của mình", "Tạo cấp dưới trực tiếp và gửi yêu cầu nhận user có sẵn"],
  ["team.view.downline", "Xem nhiệm vụ cấp dưới", "Xem nhiệm vụ do cấp dưới trực tiếp và gián tiếp tạo"],
  ["team.manage.all", "Quản lý toàn bộ đội nhóm", "Tạo, xác nhận, từ chối và xóa mọi quan hệ quản lý"],
  ["task.done.approve", "Duyệt hoàn thành nhiệm vụ", "Duyệt trạng thái hoàn thành cuối cùng theo chuỗi quản lý"],
] as const;

const defaultStatuses = [
  { key: "phai-lam", label: "Phải làm", color: "slate", sortOrder: 10, done: false },
  { key: "cho-lam-sau", label: "Chờ làm sau", color: "sky", sortOrder: 20, done: false },
  { key: "dang-lam", label: "Đang làm", color: "blue", sortOrder: 30, done: false },
  { key: "vuong-mac", label: "Vướng mắc", color: "amber", sortOrder: 40, done: false },
  { key: "lam-xong", label: "Làm xong", color: "emerald", sortOrder: 50, done: true },
] as const;

const defaultDashboardSections = [
  { sectionKey: "metrics", label: "Chỉ số", enabled: true, sortOrder: 10, config: {} },
  { sectionKey: "priority_focus", label: "Ưu tiên cần xử lý", enabled: true, sortOrder: 15, config: { limit: 8 } },
  { sectionKey: "overdue", label: "Quá hạn", enabled: true, sortOrder: 20, config: {} },
  { sectionKey: "today", label: "Hôm nay", enabled: true, sortOrder: 30, config: {} },
  { sectionKey: "upcoming", label: "Sắp tới", enabled: true, sortOrder: 40, config: { days: 7, limit: 8 } },
  { sectionKey: "after_upcoming", label: "Sau kỳ sắp tới", enabled: true, sortOrder: 50, config: { limit: 8 } },
  { sectionKey: "start_after", label: "Chưa tới ngày bắt đầu", enabled: true, sortOrder: 60, config: { days: 0, limit: 8 } },
  { sectionKey: "status_summary", label: "Theo trạng thái", enabled: true, sortOrder: 70, config: {} },
  { sectionKey: "recent_open", label: "Nhiệm vụ mở gần đây", enabled: true, sortOrder: 80, config: { limit: 8 } },
  { sectionKey: "team_summary", label: "Tổng hợp đội nhóm", enabled: true, sortOrder: 85, config: {} },
] as const;

const defaultKanbanWorkflowColumns = [
  { columnKey: "workflow:pending_registration", sortOrder: 10 },
  { columnKey: "workflow:registration_rejected", sortOrder: 20 },
  { columnKey: "workflow:pending_completion", sortOrder: 800 },
  { columnKey: "workflow:final_done", sortOrder: 900 },
  { columnKey: "workflow:completion_rejected", sortOrder: 910 },
] as const;

async function firstActiveProjectId() {
  const project = await prisma.project.findFirst({
    where: { active: true },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }, { id: "asc" }],
    select: { id: true },
  });

  return project?.id ?? null;
}

async function ensureGlobalDefaultProject() {
  const activeProjectId = await firstActiveProjectId();
  if (activeProjectId) return activeProjectId;

  const existingProject = await prisma.project.findFirst({
    orderBy: [{ createdAt: "asc" }, { name: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (existingProject) {
    const project = await prisma.project.update({
      where: { id: existingProject.id },
      data: { active: true },
      select: { id: true },
    });
    return project.id;
  }

  const project = await prisma.project.create({
    data: {
      key: "internal-work",
      name: "Công việc nội bộ",
      description: "Không gian nhiệm vụ nội bộ mặc định",
      active: true,
    },
    select: { id: true },
  });

  return project.id;
}

async function setUserCurrentProject(userId: string, projectId: string) {
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { currentProjectId: projectId },
    }),
    prisma.userProject.deleteMany({
      where: { userId, projectId: { not: projectId } },
    }),
    prisma.userProject.upsert({
      where: { userId_projectId: { userId, projectId } },
      update: {},
      create: { userId, projectId },
    }),
  ]);
}

async function ensureUserSettings(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      displayName: true,
      currentProjectId: true,
      currentProject: { select: { id: true, active: true } },
    },
  });
  if (!user) return;

  await prisma.taskStatusOption.createMany({
    data: defaultStatuses.map((status) => ({ ...status, ownerId: userId })),
    skipDuplicates: true,
  });

  const currentProjectIsValid =
    Boolean(user.currentProjectId) &&
    user.currentProject?.id === user.currentProjectId &&
    user.currentProject.active;
  const currentProjectId = currentProjectIsValid
    ? user.currentProjectId!
    : await ensureGlobalDefaultProject();
  await setUserCurrentProject(userId, currentProjectId);

  const selfEmployee = await prisma.employee.upsert({
    where: { ownerId_key: { ownerId: userId, key: "self" } },
    update: {
      name: user.displayName,
      active: true,
      linkedUserId: userId,
      linkStatus: "confirmed",
      linkRespondedAt: new Date(),
    },
    create: {
      ownerId: userId,
      key: "self",
      name: user.displayName,
      active: true,
      linkedUserId: userId,
      linkStatus: "confirmed",
      linkRequestedAt: new Date(),
      linkRespondedAt: new Date(),
    },
  });
  await prisma.employeeProject.upsert({
    where: { employeeId_projectId: { employeeId: selfEmployee.id, projectId: currentProjectId } },
    update: {},
    create: { employeeId: selfEmployee.id, projectId: currentProjectId },
  });

  await prisma.dashboardSectionPreference.createMany({
    data: defaultDashboardSections.map((section) => ({ ...section, ownerId: userId })),
    skipDuplicates: true,
  });

  const activeOpenStatuses = await prisma.taskStatusOption.findMany({
    where: { ownerId: userId, active: true, done: false },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { key: true, sortOrder: true },
  });
  await prisma.kanbanColumnPreference.createMany({
    data: [
      ...defaultKanbanWorkflowColumns.map((column) => ({
        ownerId: userId,
        columnKey: column.columnKey,
        columnType: "workflow" as const,
        enabled: true,
        sortOrder: column.sortOrder,
        widthPx: 320,
      })),
      ...activeOpenStatuses.map((status) => ({
        ownerId: userId,
        columnKey: `status:${status.key}`,
        columnType: "status" as const,
        enabled: true,
        sortOrder: 100 + status.sortOrder,
        widthPx: 320,
      })),
    ],
    skipDuplicates: true,
  });
}

async function main() {
  for (const [key, label, description] of permissions) {
    await prisma.permission.upsert({
      where: { key },
      update: { label, description },
      create: { key, label, description },
    });
  }

  const allPermissions = await prisma.permission.findMany();
  const adminRole = await prisma.role.upsert({
    where: { name: "Admin" },
    update: { description: "Toàn quyền hệ thống", system: true },
    create: { name: "Admin", description: "Toàn quyền hệ thống", system: true },
  });

  const adminPermissionCount = await prisma.rolePermission.count({ where: { roleId: adminRole.id } });
  if (adminPermissionCount === 0) {
    await prisma.rolePermission.createMany({
      data: allPermissions.map((permission) => ({
        roleId: adminRole.id,
        permissionId: permission.id,
      })),
      skipDuplicates: true,
    });
  }

  const memberRole = await prisma.role.upsert({
    where: { name: "Member" },
    update: { description: "Thành viên xử lý nhiệm vụ mặc định", system: true },
    create: { name: "Member", description: "Thành viên xử lý nhiệm vụ mặc định", system: true },
  });

  const memberPermissionKeys = [
    "task.view.own",
    "task.create",
    "task.update",
    "team.manage.own",
    "team.view.downline",
  ];
  const memberPermissions = allPermissions.filter((permission) =>
    memberPermissionKeys.includes(permission.key),
  );
  const memberPermissionCount = await prisma.rolePermission.count({ where: { roleId: memberRole.id } });
  if (memberPermissionCount === 0) {
    await prisma.rolePermission.createMany({
      data: memberPermissions.map((permission) => ({
        roleId: memberRole.id,
        permissionId: permission.id,
      })),
      skipDuplicates: true,
    });
  }

  const username = process.env.ADMIN_USERNAME || "admin";
  const displayName = process.env.ADMIN_DISPLAY_NAME || "Administrator";
  const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";

  const existingAdmin = await prisma.user.findUnique({ where: { username } });
  const admin = existingAdmin
    ? await prisma.user.update({
        where: { username },
        data: { displayName, enabled: true },
      })
    : await prisma.user.create({
        data: {
          username,
          displayName,
          passwordHash: await bcrypt.hash(password, 12),
          enabled: true,
          mustChangePass: true,
        },
      });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });

  const users = await prisma.user.findMany({ select: { id: true } });
  await prisma.userRole.createMany({
    data: users.map((user) => ({ userId: user.id, roleId: memberRole.id })),
    skipDuplicates: true,
  });

  for (const user of users) {
    await ensureUserSettings(user.id);
  }

  console.log(`Seeded admin user "${username}" and default RBAC/settings data.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
