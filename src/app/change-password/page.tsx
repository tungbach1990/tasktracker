import { BarChart3 } from "lucide-react";

import { logoutAction } from "@/app/actions/auth";
import { ChangePasswordForm } from "@/app/change-password/change-password-form";
import { requireActiveUser } from "@/lib/authz";

export default async function ChangePasswordPage() {
  const user = await requireActiveUser();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-lg bg-slate-950 text-white">
            <BarChart3 size={22} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-normal text-slate-950">Đổi mật khẩu</h1>
            <p className="text-sm text-slate-500">@{user.username}</p>
          </div>
        </div>

        <ChangePasswordForm />

        <form action={logoutAction} className="mt-4">
          <button
            type="submit"
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Đăng xuất
          </button>
        </form>
      </section>
    </main>
  );
}
