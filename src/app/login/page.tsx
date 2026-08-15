import { BarChart3 } from "lucide-react";

import { LoginForm } from "@/app/login/login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-lg bg-slate-950 text-white">
            <BarChart3 size={22} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-normal text-slate-950">Task Tracker</h1>
            <p className="text-sm text-slate-500">Bảng công việc nội bộ</p>
          </div>
        </div>

        <LoginForm />
      </section>
    </main>
  );
}
