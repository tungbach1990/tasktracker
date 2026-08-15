import { PageHeader } from "@/components/page-header";
import { CreateProjectForm, ProjectCatalogPanel, UserProjectAssignmentPanel } from "@/components/project-admin";
import { AppShell } from "@/components/shell";
import { requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { ensureGlobalDefaultProject } from "@/lib/projects";

export default async function ProjectsAdminPage() {
  const currentUser = await requirePermission("project.manage");
  await ensureGlobalDefaultProject(prisma);
  const [projects, users] = await Promise.all([
    prisma.project.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "asc" }, { name: "asc" }],
    }),
    prisma.user.findMany({
      include: { currentProject: true },
      orderBy: { username: "asc" },
    }),
  ]);
  const activeProjects = projects.filter((project) => project.active);

  return (
    <AppShell user={currentUser}>
      <PageHeader title="Dự án" description="Quản lý danh mục dự án chung và dự án hiện tại của từng người dùng." />

      <section className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Tạo dự án</h2>
          <CreateProjectForm />
        </div>
        <ProjectCatalogPanel projects={projects} />
        <div className="xl:col-span-2">
          <UserProjectAssignmentPanel users={users} activeProjects={activeProjects} />
        </div>
      </section>
    </AppShell>
  );
}
