import { redirect } from "next/navigation";

export default function LegacyEmployeeSettingsRedirectPage() {
  redirect("/team");
}
