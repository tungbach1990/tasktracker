import type { Prisma, PrismaClient } from "@prisma/client";

export async function firstActiveProjectId(prisma: PrismaClient) {
  const project = await prisma.project.findFirst({
    where: { active: true },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }, { id: "asc" }],
    select: { id: true },
  });

  return project?.id ?? null;
}

export async function ensureGlobalDefaultProject(prisma: PrismaClient) {
  const activeProjectId = await firstActiveProjectId(prisma);
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

export async function setUserCurrentProject(
  prisma: PrismaClient,
  userId: string,
  projectId: string,
) {
  const [user, project] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    prisma.project.findFirst({ where: { id: projectId, active: true }, select: { id: true } }),
  ]);

  if (!user || !project) return null;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { currentProjectId: project.id },
    }),
    prisma.userProject.deleteMany({
      where: { userId, projectId: { not: project.id } },
    }),
    prisma.userProject.upsert({
      where: { userId_projectId: { userId, projectId: project.id } },
      update: {},
      create: { userId, projectId: project.id },
    }),
  ]);

  const selfEmployee = await prisma.employee.findUnique({
    where: { ownerId_key: { ownerId: userId, key: "self" } },
    select: { id: true },
  });
  if (selfEmployee) {
    await prisma.employeeProject.upsert({
      where: { employeeId_projectId: { employeeId: selfEmployee.id, projectId: project.id } },
      update: {},
      create: { employeeId: selfEmployee.id, projectId: project.id },
    });
  }

  return project.id;
}

export async function ensureUserCurrentProject(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      currentProjectId: true,
      currentProject: { select: { id: true, active: true } },
    },
  });

  if (!user) return null;

  if (user.currentProjectId && user.currentProject?.id === user.currentProjectId && user.currentProject.active) {
    await setUserCurrentProject(prisma, userId, user.currentProjectId);
    return user.currentProjectId;
  }

  const defaultProjectId = await ensureGlobalDefaultProject(prisma);
  return setUserCurrentProject(prisma, userId, defaultProjectId);
}

export async function archiveGlobalProject(prisma: PrismaClient, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, active: true },
  });
  if (!project || !project.active) return false;

  const replacement = await prisma.project.findFirst({
    where: { active: true, id: { not: projectId } },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!replacement) return false;

  const affectedUsers = await prisma.user.findMany({
    where: { currentProjectId: projectId },
    select: { id: true },
  });
  const affectedUserIds = affectedUsers.map((user) => user.id);

  const writes: Prisma.PrismaPromise<unknown>[] = [
    prisma.project.update({
      where: { id: projectId },
      data: { active: false },
    }),
    prisma.user.updateMany({
      where: { currentProjectId: projectId },
      data: { currentProjectId: replacement.id },
    }),
  ];

  if (affectedUserIds.length > 0) {
    writes.push(
      prisma.userProject.deleteMany({
        where: { userId: { in: affectedUserIds } },
      }),
      prisma.userProject.createMany({
        data: affectedUserIds.map((userId) => ({
          userId,
          projectId: replacement.id,
        })),
        skipDuplicates: true,
      }),
    );
  }

  await prisma.$transaction(writes);

  const selfEmployees = affectedUserIds.length
    ? await prisma.employee.findMany({
        where: { ownerId: { in: affectedUserIds }, key: "self" },
        select: { id: true },
      })
    : [];
  if (selfEmployees.length > 0) {
    await prisma.employeeProject.createMany({
      data: selfEmployees.map((employee) => ({
        employeeId: employee.id,
        projectId: replacement.id,
      })),
      skipDuplicates: true,
    });
  }

  return true;
}
