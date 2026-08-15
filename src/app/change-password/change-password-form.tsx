"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";

import { changePasswordAction } from "@/app/actions/account";

export function ChangePasswordForm() {
  const [error, formAction, pending] = useActionState(changePasswordAction, null);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <label className="block">
        <span className="text-xs font-semibold uppercase text-slate-500">Mật khẩu hiện tại</span>
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      </label>

      <label className="block">
        <span className="text-xs font-semibold uppercase text-slate-500">Mật khẩu mới</span>
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      </label>

      <label className="block">
        <span className="text-xs font-semibold uppercase text-slate-500">Xác nhận mật khẩu</span>
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      </label>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
      >
        <KeyRound size={16} aria-hidden="true" />
        Đổi mật khẩu
      </button>
    </form>
  );
}
