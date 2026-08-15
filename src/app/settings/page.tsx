import { AppShell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { SettingsHeader, SettingsOverview } from "@/components/settings-forms";
import { hasPermission, requireActiveUser } from "@/lib/authz";
import { getSettingsData } from "@/lib/queries";

export default async function SettingsPage() {
  const user = await requireActiveUser();
  const settings = await getSettingsData(user.id);
  const canManageProjects = hasPermission(user, "project.manage");

  return (
    <AppShell user={user}>
      <PageHeader
        title="Cài đặt"
        description="Tùy biến trạng thái, tổng quan và Kanban cho riêng tài khoản của bạn. Nhân sự trực tiếp được quản lý ở trang Đội nhóm."
      />
      <SettingsHeader />
      <SettingsOverview
        projectCount={canManageProjects ? settings.projects.length : settings.currentProject ? 1 : 0}
        statusCount={settings.statuses.length}
        dashboardCount={settings.dashboardSections.length}
        kanbanCount={settings.kanbanColumns.length}
        canManageProjects={canManageProjects}
      />
    </AppShell>
  );
}
