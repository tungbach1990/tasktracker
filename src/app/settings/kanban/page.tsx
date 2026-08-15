import { AppShell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { KanbanSettings, SettingsHeader } from "@/components/settings-forms";
import { requireActiveUser } from "@/lib/authz";
import { getSettingsData } from "@/lib/queries";

export default async function KanbanSettingsPage() {
  const user = await requireActiveUser();
  const settings = await getSettingsData(user.id);

  return (
    <AppShell user={user}>
      <PageHeader
        title="Cài đặt Kanban"
        description="Tùy biến cột, thứ tự và độ rộng Kanban riêng cho tài khoản."
      />
      <SettingsHeader current="kanban" />
      <KanbanSettings columns={settings.kanbanColumns} statuses={settings.statuses} />
    </AppShell>
  );
}
