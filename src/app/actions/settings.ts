"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";

import { hasPermission, requireActiveUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { archiveGlobalProject } from "@/lib/projects";
import { clampKanbanWidth, ensureKanbanSettings, ensureUserSettings } from "@/lib/settings";
import {
  dashboardSectionFormSchema,
  formBoolean,
  kanbanColumnFormSchema,
  normalizedKey,
  projectFormSchema,
  statusFormSchema,
} from "@/lib/validation";

function revalidateSettings() {
  revalidatePath("/settings");
  revalidatePath("/settings/projects");
  revalidatePath("/settings/statuses");
  revalidatePath("/settings/dashboard");
  revalidatePath("/settings/kanban");
  revalidatePath("/dashboard");
  revalidatePath("/kanban");
  revalidatePath("/tasks");
  revalidatePath("/team");
}

async function requireSettingsUser() {
  const user = await requireActiveUser();
  await ensureUserSettings(prisma, user.id);
  return user;
}

async function requireProjectSettingsManager() {
  const user = await requireSettingsUser();
  if (!hasPermission(user, "project.manage")) redirect("/settings/projects");
  return user;
}

async function statusMixWouldRemain(userId: string, nextStatus: { id?: string; done: boolean }) {
  const statuses = await prisma.taskStatusOption.findMany({
    where: { ownerId: userId },
    select: { id: true, active: true, done: true },
  });
  const after = nextStatus.id
    ? statuses.map((status) =>
        status.id === nextStatus.id ? { ...status, active: true, done: nextStatus.done } : status,
      )
    : [...statuses, { id: "__new__", active: true, done: nextStatus.done }];
  const active = after.filter((status) => status.active);

  return active.some((status) => status.done) && active.some((status) => !status.done);
}

export async function saveProjectSettingAction(formData: FormData) {
  await requireProjectSettingsManager();
  const data = projectFormSchema.parse({
    id: formData.get("id") || undefined,
    key: formData.get("key") || "",
    name: formData.get("name"),
    description: formData.get("description") || "",
  });
  const key = normalizedKey(data.key, data.name);

  if (data.id) {
    await prisma.project.update({
      where: { id: data.id },
      data: { key, name: data.name, description: data.description, active: true },
    });
  } else {
    await prisma.project.upsert({
      where: { key },
      update: { name: data.name, description: data.description, active: true },
      create: { key, name: data.name, description: data.description },
    });
  }

  revalidateSettings();
}

export async function archiveProjectSettingAction(formData: FormData) {
  const user = await requireProjectSettingsManager();
  const id = String(formData.get("id") || "");
  if (!id) return;

  await archiveGlobalProject(prisma, id);

  await ensureKanbanSettings(prisma, user.id);
  revalidateSettings();
}

export async function saveStatusSettingAction(formData: FormData) {
  const user = await requireSettingsUser();
  const data = statusFormSchema.parse({
    id: formData.get("id") || undefined,
    key: formData.get("key") || "",
    label: formData.get("label"),
    color: formData.get("color") || "slate",
    sortOrder: formData.get("sortOrder") || 100,
    done: formBoolean(formData, "done"),
  });
  const key = normalizedKey(data.key, data.label);
  const canSave = await statusMixWouldRemain(user.id, { id: data.id, done: data.done });
  if (!canSave) return;

  if (data.id) {
    await prisma.taskStatusOption.update({
      where: { id: data.id, ownerId: user.id },
      data: {
        key,
        label: data.label,
        color: data.color,
        sortOrder: data.sortOrder,
        done: data.done,
        active: true,
      },
    });
  } else {
    await prisma.taskStatusOption.create({
      data: {
        key,
        label: data.label,
        color: data.color,
        sortOrder: data.sortOrder,
        done: data.done,
        ownerId: user.id,
      },
    });
  }

  revalidateSettings();
}

export async function archiveStatusSettingAction(formData: FormData) {
  const user = await requireSettingsUser();
  const id = String(formData.get("id") || "");
  if (!id) return;

  const [status, activeStatuses] = await Promise.all([
    prisma.taskStatusOption.findFirst({
      where: { id, ownerId: user.id },
      include: { _count: { select: { tasks: true } } },
    }),
    prisma.taskStatusOption.findMany({
      where: { ownerId: user.id, active: true },
      select: { id: true, done: true },
    }),
  ]);

  if (!status) return;
  const remaining = activeStatuses.filter((item) => item.id !== id);
  if (!remaining.some((item) => item.done) || !remaining.some((item) => !item.done)) return;

  await prisma.taskStatusOption.update({
    where: { id, ownerId: user.id },
    data: { active: false },
  });

  revalidateSettings();
}

export async function reorderStatusSettingAction(formData: FormData) {
  const user = await requireSettingsUser();
  const ids = formData.getAll("statusIds").map(String).filter(Boolean);
  const sortOrders = formData
    .getAll("sortOrders")
    .map((value) => Number(value))
    .map((value) => (Number.isFinite(value) ? Math.trunc(value) : 100));
  if (ids.length === 0) return;

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.taskStatusOption.update({
        where: { id, ownerId: user.id },
        data: { sortOrder: Math.min(10000, Math.max(0, sortOrders[index] ?? (index + 1) * 10)) },
      }),
    ),
  );

  revalidateSettings();
}

export async function saveDashboardSettingAction(formData: FormData) {
  const user = await requireSettingsUser();
  const data = dashboardSectionFormSchema.parse({
    sectionKey: formData.get("sectionKey"),
    label: formData.get("label"),
    enabled: formBoolean(formData, "enabled"),
    sortOrder: formData.get("sortOrder"),
    upcomingDays: formData.get("upcomingDays") || undefined,
    upcomingLimit: formData.get("upcomingLimit") || undefined,
    sectionLimit: formData.get("sectionLimit") || undefined,
    startAfterDays: formData.get("startAfterDays") || undefined,
    recentLimit: formData.get("recentLimit") || undefined,
  });

  const config =
    data.sectionKey === "upcoming"
      ? { days: data.upcomingDays ?? 7, limit: data.upcomingLimit ?? 8 }
      : data.sectionKey === "after_upcoming" || data.sectionKey === "priority_focus"
        ? { limit: data.sectionLimit ?? 8 }
        : data.sectionKey === "start_after"
          ? { days: data.startAfterDays ?? 0, limit: data.sectionLimit ?? 8 }
      : data.sectionKey === "recent_open"
        ? { limit: data.recentLimit ?? 8 }
        : {};

  await prisma.dashboardSectionPreference.upsert({
    where: { ownerId_sectionKey: { ownerId: user.id, sectionKey: data.sectionKey } },
    update: {
      label: data.label,
      enabled: data.enabled,
      sortOrder: data.sortOrder,
      config,
    },
    create: {
      ownerId: user.id,
      sectionKey: data.sectionKey,
      label: data.label,
      enabled: data.enabled,
      sortOrder: data.sortOrder,
      config,
    },
  });

  revalidateSettings();
}

export async function saveKanbanColumnSettingAction(formData: FormData) {
  const user = await requireSettingsUser();
  await ensureKanbanSettings(prisma, user.id);
  const data = kanbanColumnFormSchema.parse({
    columnKey: formData.get("columnKey"),
    columnType: formData.get("columnType"),
    enabled: formBoolean(formData, "enabled"),
    sortOrder: formData.get("sortOrder"),
    widthPx: formData.get("widthPx"),
  });

  await prisma.kanbanColumnPreference.upsert({
    where: { ownerId_columnKey: { ownerId: user.id, columnKey: data.columnKey } },
    update: {
      columnType: data.columnType,
      enabled: data.enabled,
      sortOrder: data.sortOrder,
      widthPx: clampKanbanWidth(data.widthPx),
    },
    create: {
      ownerId: user.id,
      columnKey: data.columnKey,
      columnType: data.columnType,
      enabled: data.enabled,
      sortOrder: data.sortOrder,
      widthPx: clampKanbanWidth(data.widthPx),
    },
  });

  revalidateSettings();
}

export async function saveKanbanLayoutPatchAction(formData: FormData) {
  const user = await requireSettingsUser();
  await ensureKanbanSettings(prisma, user.id);

  const columnKey = String(formData.get("columnKey") || "").trim();
  if (!columnKey) return;

  const data: Prisma.KanbanColumnPreferenceUpdateInput = {};
  if (formData.has("widthPx")) {
    data.widthPx = clampKanbanWidth(Number(formData.get("widthPx")));
  }
  if (formData.has("enabled")) {
    data.enabled = formBoolean(formData, "enabled");
  }
  if (Object.keys(data).length === 0) return;

  const column = await prisma.kanbanColumnPreference.findUnique({
    where: { ownerId_columnKey: { ownerId: user.id, columnKey } },
    select: { id: true },
  });
  if (!column) return;

  await prisma.kanbanColumnPreference.update({
    where: { ownerId_columnKey: { ownerId: user.id, columnKey } },
    data,
  });

  revalidatePath("/kanban");
  revalidatePath("/settings/kanban");
}

export async function resetKanbanSettingsAction() {
  const user = await requireSettingsUser();
  await prisma.kanbanColumnPreference.deleteMany({ where: { ownerId: user.id } });
  await ensureKanbanSettings(prisma, user.id);
  revalidateSettings();
}
