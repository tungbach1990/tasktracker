import { AppShell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { SettingsHeader, StatusesSettings } from "@/components/settings-forms";
import { requireActiveUser } from "@/lib/authz";
import { getSettingsData } from "@/lib/queries";

export default async function StatusSettingsPage() {
  const user = await requireActiveUser();
  const settings = await getSettingsData(user.id);

  return (
    <AppShell user={user}>
      <PageHeader title="Cài đặt trạng thái" description="Tùy chỉnh luồng trạng thái, màu, thứ tự và trạng thái hoàn thành." />
      <SettingsHeader current="statuses" />
      <StatusesSettings statuses={settings.statuses} />
    </AppShell>
  );
}
