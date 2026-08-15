import { AppShell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { DashboardSettings, SettingsHeader } from "@/components/settings-forms";
import { requireActiveUser } from "@/lib/authz";
import { getSettingsData } from "@/lib/queries";

export default async function DashboardSettingsPage() {
  const user = await requireActiveUser();
  const settings = await getSettingsData(user.id);

  return (
    <AppShell user={user}>
      <PageHeader
        title="Cài đặt tổng quan"
        description="Bật tắt phần hiển thị, đổi thứ tự và chỉnh giới hạn cho trang tổng quan cá nhân."
      />
      <SettingsHeader current="dashboard" />
      <DashboardSettings sections={settings.dashboardSections} />
    </AppShell>
  );
}
