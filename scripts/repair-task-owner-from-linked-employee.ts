import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tasks = await prisma.task.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      title: true,
      ownerId: true,
      performerId: true,
      createdById: true,
      status: { select: { id: true, key: true } },
      employees: {
        select: {
          employee: {
            select: {
              linkedUserId: true,
              linkStatus: true,
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  let repaired = 0;
  let skippedNoSingleLinkedUser = 0;
  let skippedMissingStatus = 0;
  let alreadyCorrect = 0;

  for (const task of tasks) {
    const linkedAssignments = task.employees
      .map((item) => item.employee)
      .filter((employee) => employee.linkStatus === "confirmed" && employee.linkedUserId);

    if (linkedAssignments.length !== 1 || !linkedAssignments[0].linkedUserId) {
      skippedNoSingleLinkedUser += 1;
      continue;
    }

    const targetUserId = linkedAssignments[0].linkedUserId;
    if (task.ownerId === targetUserId && task.performerId === targetUserId) {
      alreadyCorrect += 1;
      continue;
    }

    const targetStatus = await prisma.taskStatusOption.findFirst({
      where: { ownerId: targetUserId, key: task.status.key, active: true },
      select: { id: true },
    });
    if (!targetStatus) {
      skippedMissingStatus += 1;
      continue;
    }

    await prisma.task.update({
      where: { id: task.id },
      data: {
        ownerId: targetUserId,
        performerId: targetUserId,
        statusId: targetStatus.id,
        history: {
          create: {
            action: "owner_repaired",
            userId: task.createdById,
            before: {
              ownerId: task.ownerId,
              performerId: task.performerId,
              statusId: task.status.id,
            },
            after: {
              ownerId: targetUserId,
              performerId: targetUserId,
              statusId: targetStatus.id,
            },
          },
        },
      },
    });
    repaired += 1;
  }

  console.log(
    JSON.stringify(
      {
        scanned: tasks.length,
        repaired,
        alreadyCorrect,
        skippedNoSingleLinkedUser,
        skippedMissingStatus,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
