import { AppShell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { ProjectsSettings, SettingsHeader } from "@/components/settings-forms";
import { hasPermission, requireActiveUser } from "@/lib/authz";
import { getSettingsData } from "@/lib/queries";

export default async function ProjectSettingsPage() {
  const user = await requireActiveUser();
  const settings = await getSettingsData(user.id);
  const canManageProjects = hasPermission(user, "project.manage");

  return (
    <AppShell user={user}>
      <PageHeader title="Cài đặt dự án" description="Dự án hiện tại của bạn do admin gán từ danh mục dự án chung." />
      <SettingsHeader current="projects" />
      <ProjectsSettings
        projects={settings.projects}
        currentProject={settings.currentProject}
        canManage={canManageProjects}
      />
    </AppShell>
  );
}
