"use client";

import { useActionState } from "react";
import { KeyRound, LogIn } from "lucide-react";

import { loginAction } from "@/app/actions/auth";

export function LoginForm() {
  const [error, formAction, pending] = useActionState(loginAction, null);

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <label className="block">
        <span className="text-xs font-semibold uppercase text-slate-500">Tên đăng nhập</span>
        <input
          name="username"
          autoComplete="username"
          required
          className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      </label>

      <label className="block">
        <span className="text-xs font-semibold uppercase text-slate-500">Mật khẩu</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
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
        {pending ? <KeyRound size={16} aria-hidden="true" /> : <LogIn size={16} aria-hidden="true" />}
        Đăng nhập
      </button>
    </form>
  );
}
