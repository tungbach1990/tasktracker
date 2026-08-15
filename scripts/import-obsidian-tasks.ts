import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient, type RepeatUnit, type TaskType } from "@prisma/client";

loadDotEnv(path.resolve(process.cwd(), ".env"));

const prisma = new PrismaClient();

type ProjectConfig = {
  key: string;
  name: string;
  taskFolder: string;
  configFile?: string;
  owners: string[];
  statuses: Array<{
    key: string;
    label: string;
    done: boolean;
    sortOrder: number;
  }>;
};

type ParsedTask = {
  sourcePath: string;
  projectKey: string;
  title: string;
  description: string;
  taskType: TaskType;
  parentSourcePath: string | null;
  ownerKey: string | null;
  statusKey: string;
  originalStatusKey: string;
  checked: boolean;
  startDate: Date | null;
  dueDate: Date | null;
  dueHistory: string[];
  repeats: boolean;
  repeatEvery: number;
  repeatUnit: RepeatUnit;
  seriesId: string | null;
  occurrence: Date | null;
  childTasks: Array<{
    title: string;
    done: boolean;
    dueDate: Date | null;
    sortOrder: number;
  }>;
};

const statusColors: Record<string, string> = {
  "phai-lam": "slate",
  "cho-lam-sau": "sky",
  "dang-lam": "blue",
  "vuong-mac": "amber",
  "lam-xong": "emerald",
};

const fallbackStatuses: ProjectConfig["statuses"] = [
  { key: "phai-lam", label: "Phai lam", done: false, sortOrder: 10 },
  { key: "cho-lam-sau", label: "Cho lam sau", done: false, sortOrder: 20 },
  { key: "dang-lam", label: "Dang lam", done: false, sortOrder: 30 },
  { key: "vuong-mac", label: "Vuong mac", done: false, sortOrder: 40 },
  { key: "lam-xong", label: "Lam xong", done: true, sortOrder: 50 },
];

async function main() {
  const vaultRoot = path.resolve(process.env.OBSIDIAN_VAULT_PATH || path.join(process.cwd(), ".."));
  const admin = await findImportUser();
  const projects = await loadProjectConfigs(vaultRoot);
  const taskFiles = await listTaskFiles(vaultRoot, projects);
  const statusDoneByKey = new Map<string, boolean>();
  const statusLabelByKey = new Map<string, string>();

  for (const project of projects) {
    for (const status of project.statuses) {
      statusDoneByKey.set(status.key, status.done);
      statusLabelByKey.set(status.key, status.label);
    }
  }

  for (const status of fallbackStatuses) {
    if (!statusDoneByKey.has(status.key)) statusDoneByKey.set(status.key, status.done);
    if (!statusLabelByKey.has(status.key)) statusLabelByKey.set(status.key, status.label);
  }

  const doneStatusKey =
    [...statusDoneByKey.entries()].find(([, done]) => done)?.[0] || "lam-xong";
  const openStatusKey =
    [...statusDoneByKey.entries()].find(([, done]) => !done)?.[0] || "phai-lam";

  const parsedTasks: ParsedTask[] = [];
  const owners = new Set<string>();
  const statusKeys = new Set<string>();

  for (const file of taskFiles) {
    const project = projects.find((item) => sourcePathFor(vaultRoot, file).startsWith(item.taskFolder));
    if (!project) continue;

    const parsed = await parseTaskFile(vaultRoot, file, project.key, statusDoneByKey, doneStatusKey);
    if (!parsed) continue;

    parsedTasks.push(parsed);
    if (parsed.ownerKey) owners.add(parsed.ownerKey);
    statusKeys.add(parsed.statusKey);
    statusKeys.add(parsed.originalStatusKey);
  }

  const projectIds = await ensureProjects(admin.id, projects);
  const statusIds = await ensureStatuses(admin.id, projects, statusKeys, statusLabelByKey, statusDoneByKey);
  const employeeIds = await ensureEmployees(
    admin.id,
    [...new Set(projects.flatMap((project) => project.owners).concat([...owners]))],
  );

  let created = 0;
  let updated = 0;
  let childTasksCreated = 0;
  let normalizedCheckedStatus = 0;
  const taskIdsBySourcePath = new Map<string, string>();

  for (const task of parsedTasks) {
    const projectId = projectIds.get(task.projectKey);
    const statusId = statusIds.get(task.statusKey);
    if (!projectId || !statusId) {
      throw new Error(`Missing project/status mapping for ${task.sourcePath}`);
    }

    const existing = await prisma.task.findUnique({
      where: { sourcePath: task.sourcePath },
      select: { id: true },
    });

    const completedAt = statusDoneByKey.get(task.statusKey)
      ? task.dueDate || task.startDate || new Date()
      : null;
    const employeeData = task.ownerKey && employeeIds.has(task.ownerKey)
      ? [{ employeeId: employeeIds.get(task.ownerKey)! }]
      : [];
    if (existing) {
      await prisma.$transaction([
        prisma.taskEmployee.deleteMany({ where: { taskId: existing.id } }),
        prisma.task.update({
          where: { id: existing.id },
          data: {
            title: task.title,
            description: task.description,
            taskType: task.taskType,
            kind: "assigned",
            workflowStatus: completedAt ? "final_done" : "active",
            parentId: null,
            projectId,
            statusId,
            priority: "normal",
            startDate: task.startDate,
            dueDate: task.dueDate,
            dueHistory: task.dueHistory,
            repeats: task.repeats,
            repeatEvery: task.repeatEvery,
            repeatUnit: task.repeatUnit,
            seriesId: task.seriesId,
            occurrence: task.occurrence,
            completedAt,
            performerId: admin.id,
            ownerId: admin.id,
            updatedById: admin.id,
            employees: {
              createMany: { data: employeeData, skipDuplicates: true },
            },
          },
        }),
      ]);
      taskIdsBySourcePath.set(task.sourcePath, existing.id);
      await createImportedChildTasks({
        parentTaskId: existing.id,
        task,
        projectId,
        employeeData,
        statusIds,
        doneStatusKey,
        openStatusKey,
        adminId: admin.id,
      });
      updated += 1;
    } else {
      const createdTask = await prisma.task.create({
        data: {
          sourcePath: task.sourcePath,
          title: task.title,
          description: task.description,
          taskType: task.taskType,
          kind: "assigned",
          workflowStatus: completedAt ? "final_done" : "active",
          projectId,
          statusId,
          priority: "normal",
          startDate: task.startDate,
          dueDate: task.dueDate,
          dueHistory: task.dueHistory,
          repeats: task.repeats,
          repeatEvery: task.repeatEvery,
          repeatUnit: task.repeatUnit,
          seriesId: task.seriesId,
          occurrence: task.occurrence,
          completedAt,
          performerId: admin.id,
          ownerId: admin.id,
          createdById: admin.id,
          updatedById: admin.id,
          employees: {
            createMany: { data: employeeData, skipDuplicates: true },
          },
          history: {
            create: {
              userId: admin.id,
              action: "obsidian_imported",
              after: {
                sourcePath: task.sourcePath,
                originalStatusKey: task.originalStatusKey,
                statusKey: task.statusKey,
              },
            },
          },
        },
        select: { id: true },
      });
      taskIdsBySourcePath.set(task.sourcePath, createdTask.id);
      await createImportedChildTasks({
        parentTaskId: createdTask.id,
        task,
        projectId,
        employeeData,
        statusIds,
        doneStatusKey,
        openStatusKey,
        adminId: admin.id,
      });
      created += 1;
    }

    childTasksCreated += task.childTasks.length;
    if (task.checked && task.statusKey !== task.originalStatusKey) normalizedCheckedStatus += 1;
  }

  let linkedParents = 0;
  let unresolvedParents = 0;
  for (const task of parsedTasks) {
    const taskId = taskIdsBySourcePath.get(task.sourcePath);
    if (!taskId || !task.parentSourcePath) continue;

    const parentId =
      taskIdsBySourcePath.get(task.parentSourcePath) ||
      (await prisma.task.findUnique({
        where: { sourcePath: task.parentSourcePath },
        select: { id: true },
      }))?.id;

    if (!parentId) {
      unresolvedParents += 1;
      continue;
    }

    await prisma.task.update({
      where: { id: taskId },
      data: { parentId, taskType: "small", updatedById: admin.id },
    });
    linkedParents += 1;
  }

  console.log(`Obsidian vault: ${vaultRoot}`);
  console.log(`Import user: ${admin.username}`);
  console.log(`Project configs: ${projects.length}`);
  console.log(`Markdown task files found: ${taskFiles.length}`);
  console.log(`Parsed tasks: ${parsedTasks.length}`);
  console.log(`Created tasks: ${created}`);
  console.log(`Updated tasks: ${updated}`);
  console.log(`Child tasks imported: ${childTasksCreated}`);
  console.log(`Parent links resolved: ${linkedParents}`);
  console.log(`Parent links unresolved: ${unresolvedParents}`);
  console.log(`Checked tasks normalized to done status: ${normalizedCheckedStatus}`);
}

async function createImportedChildTasks({
  parentTaskId,
  task,
  projectId,
  employeeData,
  statusIds,
  doneStatusKey,
  openStatusKey,
  adminId,
}: {
  parentTaskId: string;
  task: ParsedTask;
  projectId: string;
  employeeData: Array<{ employeeId: string }>;
  statusIds: Map<string, string>;
  doneStatusKey: string;
  openStatusKey: string;
  adminId: string;
}) {
  for (const [index, childTask] of task.childTasks.entries()) {
    const statusId = statusIds.get(childTask.done ? doneStatusKey : openStatusKey);
    if (!statusId) continue;

    const sourcePath = `${task.sourcePath}#child-${index + 1}`;
    await prisma.task.upsert({
      where: { sourcePath },
      update: {
        title: childTask.title,
        workflowStatus: childTask.done ? "final_done" : "active",
        parentId: parentTaskId,
        projectId,
        statusId,
        dueDate: childTask.dueDate,
        sortOrder: childTask.sortOrder,
        completedAt: childTask.done ? childTask.dueDate || new Date() : null,
        performerId: adminId,
        ownerId: adminId,
        updatedById: adminId,
        employees: {
          createMany: { data: employeeData, skipDuplicates: true },
        },
      },
      create: {
        sourcePath,
        title: childTask.title,
        description: "",
        result: "",
        feedback: "",
        taskType: "small",
        kind: "assigned",
        workflowStatus: childTask.done ? "final_done" : "active",
        parentId: parentTaskId,
        projectId,
        statusId,
        priority: "normal",
        startDate: null,
        dueDate: childTask.dueDate,
        dueHistory: [],
        sortOrder: childTask.sortOrder,
        repeats: false,
        repeatEvery: 1,
        repeatUnit: "day",
        seriesId: null,
        occurrence: null,
        completedAt: childTask.done ? childTask.dueDate || new Date() : null,
        performerId: adminId,
        ownerId: adminId,
        createdById: adminId,
        updatedById: adminId,
        employees: {
          createMany: { data: employeeData, skipDuplicates: true },
        },
        history: {
          create: {
            userId: adminId,
            action: "obsidian_child_imported",
            after: {
              sourcePath: task.sourcePath,
              childIndex: index + 1,
            },
          },
        },
      },
    });
  }
}

async function findImportUser() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const configured = await prisma.user.findUnique({ where: { username } });
  if (configured) return configured;

  const adminRoleUser = await prisma.user.findFirst({
    where: { roles: { some: { role: { name: "Admin" } } } },
    orderBy: { createdAt: "asc" },
  });
  if (adminRoleUser) return adminRoleUser;

  throw new Error("No admin user found. Run npm run db:seed before importing.");
}

async function loadProjectConfigs(vaultRoot: string) {
  const globalConfigPath = path.join(vaultRoot, "work", "Task Config.md");
  if (!existsSync(globalConfigPath)) {
    return loadFallbackProjects(vaultRoot);
  }

  const globalConfig = await readText(globalConfigPath);
  const rows = parseMarkdownTable(globalConfig, "Projects");
  const projects: ProjectConfig[] = [];

  for (const row of rows) {
    const key = slugifyKey(row.id || row.name);
    const taskFolder = normalizeVaultPath(row.task_folder || row.taskFolder || "");
    if (!key || !taskFolder) continue;

    const configFile = normalizeVaultPath(row.task_config_file || "");
    const projectConfig = configFile ? await readProjectConfig(vaultRoot, configFile) : null;
    projects.push({
      key,
      name: row.name || key,
      taskFolder: withTrailingSlash(taskFolder),
      configFile,
      owners: projectConfig?.owners.length ? projectConfig.owners : [],
      statuses: projectConfig?.statuses.length ? projectConfig.statuses : fallbackStatuses,
    });
  }

  return projects.length ? projects : loadFallbackProjects(vaultRoot);
}

async function loadFallbackProjects(vaultRoot: string) {
  const workDir = path.join(vaultRoot, "work");
  if (!existsSync(workDir)) return [];

  const entries = await readdir(workDir, { withFileTypes: true });
  const projects: ProjectConfig[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const taskDir = path.join(workDir, entry.name, "tasks");
    if (!existsSync(taskDir)) continue;

    const key = slugifyKey(entry.name.replace(/^\d+-/, ""));
    const configFile = normalizeVaultPath(path.posix.join("work", entry.name, "Task Config.md"));
    const projectConfig = existsSync(path.join(vaultRoot, ...configFile.split("/")))
      ? await readProjectConfig(vaultRoot, configFile)
      : null;
    projects.push({
      key,
      name: entry.name.replace(/^\d+-/, ""),
      taskFolder: withTrailingSlash(normalizeVaultPath(path.posix.join("work", entry.name, "tasks"))),
      configFile,
      owners: projectConfig?.owners.length ? projectConfig.owners : [],
      statuses: projectConfig?.statuses.length ? projectConfig.statuses : fallbackStatuses,
    });
  }

  return projects;
}

async function readProjectConfig(vaultRoot: string, configPath: string) {
  const content = await readText(path.join(vaultRoot, ...configPath.split("/")));
  const ownerRows = parseMarkdownTable(content, "Owners");
  const statusRows = parseMarkdownTable(content, "Statuses");

  const owners = ownerRows
    .map((row) => row.owner || row.name || "")
    .map((value) => value.trim())
    .filter(Boolean);

  const statuses = statusRows
    .map((row, index) => ({
      key: slugifyKey(row.tag || row.key || row.label),
      label: row.label || row.tag || row.key || "",
      done: parseBoolean(row.done),
      sortOrder: (index + 1) * 10,
    }))
    .filter((status) => status.key && status.label);

  return { owners, statuses };
}

async function listTaskFiles(vaultRoot: string, projects: ProjectConfig[]) {
  const files = new Set<string>();

  for (const project of projects) {
    const directory = path.join(vaultRoot, ...project.taskFolder.split("/").filter(Boolean));
    if (!existsSync(directory)) continue;

    for (const file of await walkMarkdownFiles(directory)) {
      files.add(file);
    }
  }

  return [...files].sort();
}

async function walkMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function parseTaskFile(
  vaultRoot: string,
  filePath: string,
  projectKey: string,
  statusDoneByKey: Map<string, boolean>,
  doneStatusKey: string,
): Promise<ParsedTask | null> {
  const sourcePath = sourcePathFor(vaultRoot, filePath);
  const content = await readText(filePath);
  const { frontmatter, body } = splitFrontmatter(content);
  const lines = body.split(/\r?\n/);
  const checkboxLines = lines
    .map((line, index) => ({ ...parseCheckboxLine(line), index }))
    .filter((line) => line.matched);
  const taskLine = checkboxLines[0];

  if (!taskLine) return null;

  const titleFallback = firstHeading(lines) || path.basename(filePath, ".md");
  const ownerKey = extractOwner(taskLine.content);
  const originalStatusKey = extractStatus(taskLine.content) || "phai-lam";
  const checked = taskLine.checked;
  const statusKey =
    checked && !statusDoneByKey.get(originalStatusKey) ? doneStatusKey : originalStatusKey;
  const startDate = extractDate(taskLine.content, "start");
  const dueDate = extractDate(taskLine.content, "due");
  const taskTypeValue = (frontmatter.work_task_type || "").toLowerCase();
  const parentSourcePath = frontmatter.work_task_parent
    ? normalizeVaultPath(frontmatter.work_task_parent)
    : null;
  const taskType: TaskType = taskTypeValue === "small" || parentSourcePath ? "small" : "big";
  const title = cleanTaskText(taskLine.content) || titleFallback;
  const description = taskDescription(lines, taskLine.index, checkboxLines.map((line) => line.index));
  const repeats = parseBoolean(frontmatter.work_task_repeats);
  const repeatEvery = Math.max(1, Number.parseInt(frontmatter.work_task_every || "1", 10) || 1);
  const repeatUnit = parseRepeatUnit(frontmatter.work_task_unit);
  const occurrence = dateFromKey(frontmatter.work_task_occurrence) || (repeats ? startDate || dueDate : null);
  const dueHistory = parseDueHistory(frontmatter.work_task_due_history);
  const seriesId = frontmatter.work_task_series_id?.trim() || null;

  const childTasks = checkboxLines.slice(1).map((line, index) => ({
    title: cleanTaskText(line.content) || `Nhiệm vụ con ${index + 1}`,
    done: line.checked,
    dueDate: extractDate(line.content, "due"),
    sortOrder: (index + 1) * 10,
  }));

  return {
    sourcePath,
    projectKey,
    title,
    description,
    taskType,
    parentSourcePath,
    ownerKey,
    statusKey,
    originalStatusKey,
    checked,
    startDate,
    dueDate,
    dueHistory,
    repeats,
    repeatEvery,
    repeatUnit,
    seriesId,
    occurrence,
    childTasks,
  };
}

async function ensureProjects(userId: string, projects: ProjectConfig[]) {
  const ids = new Map<string, string>();

  for (const project of projects) {
    const description = project.configFile
      ? `Imported from Obsidian ${project.configFile}`
      : "Imported from Obsidian";
    const existingByKey = await prisma.project.findUnique({
      where: { key: project.key },
      select: { id: true },
    });
    const existingByName = existingByKey
      ? null
      : (await prisma.project.findMany({
          select: { id: true, name: true },
        })).find((item) => slugifyKey(item.name) === slugifyKey(project.name));

    const item = existingByKey || existingByName
      ? await prisma.project.update({
          where: { id: (existingByKey || existingByName)!.id },
          data: {
            name: project.name,
            description,
            active: true,
          },
          select: { id: true },
        })
      : await prisma.project.create({
        data: {
          key: project.key,
          name: project.name,
          description,
          active: true,
        },
        select: { id: true },
      });
    ids.set(project.key, item.id);
  }

  const firstProjectId = ids.values().next().value;
  if (firstProjectId) {
    await syncUserCurrentProject(userId, firstProjectId);
  }

  return ids;
}

async function syncUserCurrentProject(userId: string, fallbackProjectId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      currentProjectId: true,
      currentProject: { select: { id: true, active: true } },
    },
  });
  if (!user) return;

  const currentProjectId =
    user.currentProjectId && user.currentProject?.id === user.currentProjectId && user.currentProject.active
      ? user.currentProjectId
      : fallbackProjectId;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { currentProjectId },
    }),
    prisma.userProject.deleteMany({
      where: { userId, projectId: { not: currentProjectId } },
    }),
    prisma.userProject.upsert({
      where: { userId_projectId: { userId, projectId: currentProjectId } },
      update: {},
      create: { userId, projectId: currentProjectId },
    }),
  ]);
}

async function ensureStatuses(
  userId: string,
  projects: ProjectConfig[],
  taskStatusKeys: Set<string>,
  statusLabelByKey: Map<string, string>,
  statusDoneByKey: Map<string, boolean>,
) {
  const statusesByKey = new Map<string, ProjectConfig["statuses"][number]>();

  for (const status of fallbackStatuses) {
    statusesByKey.set(status.key, status);
  }
  for (const project of projects) {
    for (const status of project.statuses) {
      statusesByKey.set(status.key, status);
    }
  }
  for (const key of taskStatusKeys) {
    if (!statusesByKey.has(key)) {
      statusesByKey.set(key, {
        key,
        label: statusLabelByKey.get(key) || key,
        done: statusDoneByKey.get(key) || false,
        sortOrder: (statusesByKey.size + 1) * 10,
      });
    }
  }

  const ids = new Map<string, string>();
  for (const status of statusesByKey.values()) {
    const item = await prisma.taskStatusOption.upsert({
      where: { ownerId_key: { ownerId: userId, key: status.key } },
      update: {
        label: status.label,
        color: statusColors[status.key] || "slate",
        sortOrder: status.sortOrder,
        done: status.done,
        active: true,
      },
      create: {
        ownerId: userId,
        key: status.key,
        label: status.label,
        color: statusColors[status.key] || "slate",
        sortOrder: status.sortOrder,
        done: status.done,
        active: true,
      },
      select: { id: true },
    });
    ids.set(status.key, item.id);
  }

  return ids;
}

async function ensureEmployees(userId: string, ownerNames: string[]) {
  const ids = new Map<string, string>();
  const usedKeys = new Set<string>();

  for (const name of ownerNames.map((value) => value.trim()).filter(Boolean)) {
    let key = slugifyKey(name) || "employee";
    const baseKey = key;
    let suffix = 2;
    while (usedKeys.has(key) && !ids.has(name)) {
      key = `${baseKey}-${suffix}`;
      suffix += 1;
    }
    usedKeys.add(key);

    const item = await prisma.employee.upsert({
      where: { ownerId_key: { ownerId: userId, key } },
      update: { name, active: true },
      create: { ownerId: userId, key, name, active: true },
      select: { id: true },
    });
    ids.set(name, item.id);
  }

  return ids;
}

function splitFrontmatter(content: string) {
  const normalized = content.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: {} as Record<string, string>, body: normalized };
  }

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) return { frontmatter: {} as Record<string, string>, body: normalized };

  const frontmatterLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n");
  const frontmatter: Record<string, string> = {};
  for (const line of frontmatterLines) {
    const match = /^([^:#]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    frontmatter[match[1].trim()] = unquote(match[2].trim());
  }

  return { frontmatter, body };
}

function parseMarkdownTable(content: string, heading: string) {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (headingIndex === -1) return [];

  const tableLines: string[] = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith("## ")) break;
    if (line.startsWith("|")) tableLines.push(line);
  }
  if (tableLines.length < 2) return [];

  const header = splitTableRow(tableLines[0]).map((cell) => normalizeHeader(cell));
  return tableLines.slice(1)
    .map(splitTableRow)
    .filter((cells) => cells.some((cell) => !/^:?-{3,}:?$/.test(cell.trim())))
    .map((cells) => Object.fromEntries(header.map((key, index) => [key, cells[index]?.trim() || ""])));
}

function splitTableRow(line: string) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseCheckboxLine(line: string) {
  const match = /^(\s*)[-*]\s+\[([^\]])\]\s+(.*)$/.exec(line);
  return {
    matched: Boolean(match),
    indent: match?.[1].length || 0,
    checked: ["x", "X"].includes(match?.[2] || ""),
    content: match?.[3] || "",
  };
}

function extractOwner(line: string) {
  return /#owner\/([^\s#]+)/u.exec(line)?.[1] || null;
}

function extractStatus(line: string) {
  return /#status\/([^\s#]+)/u.exec(line)?.[1] || null;
}

function extractDate(line: string, kind: "start" | "due") {
  const pattern =
    kind === "start"
      ? /(?:🛫|ðŸ›«)\s*(\d{4}-\d{2}-\d{2})/u
      : /(?:📅|ðŸ“…)\s*(\d{4}-\d{2}-\d{2})/u;
  return dateFromKey(pattern.exec(line)?.[1] || "");
}

function cleanTaskText(value: string) {
  return value
    .replace(/#owner\/[^\s#]+/gu, "")
    .replace(/#status\/[^\s#]+/gu, "")
    .replace(/(?:🛫|ðŸ›«)\s*\d{4}-\d{2}-\d{2}/gu, "")
    .replace(/(?:📅|ðŸ“…)\s*\d{4}-\d{2}-\d{2}/gu, "")
    .replace(/^#+\s*/, "")
    .trim();
}

function taskDescription(lines: string[], taskLineIndex: number, checkboxLineIndexes: number[]) {
  const excluded = new Set([taskLineIndex, ...checkboxLineIndexes]);
  const descriptionLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => index > taskLineIndex && !excluded.has(index) && !/^#\s+/.test(line.trim()))
    .map(({ line }) => line)
    .join("\n")
    .trim();

  return descriptionLines;
}

function firstHeading(lines: string[]) {
  return lines.find((line) => /^#\s+/.test(line.trim()))?.replace(/^#\s+/, "").trim() || "";
}

function parseDueHistory(value: string | undefined) {
  if (!value) return [];
  return [...value.matchAll(/\d{4}-\d{2}-\d{2}/g)].map((match) => match[0]);
}

function parseRepeatUnit(value: string | undefined): RepeatUnit {
  if (value === "week" || value === "month") return value;
  return "day";
}

function parseBoolean(value: string | undefined) {
  return ["true", "yes", "1", "x"].includes((value || "").trim().toLowerCase());
}

function dateFromKey(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sourcePathFor(vaultRoot: string, filePath: string) {
  return normalizeVaultPath(path.relative(vaultRoot, filePath));
}

function normalizeVaultPath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function withTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function slugifyKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function unquote(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function readText(filePath: string) {
  return readFile(filePath, "utf8");
}

function loadDotEnv(envPath: string) {
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    if (process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = unquote(match[2].trim());
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
