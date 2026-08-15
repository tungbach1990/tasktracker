"use server";

import bcrypt from "bcryptjs";

import { signOut } from "@/auth";
import { requireActiveUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export async function changePasswordAction(
  _previousState: string | null | undefined,
  formData: FormData,
): Promise<string | null> {
  const user = await requireActiveUser();
  const currentPassword = String(formData.get("currentPassword") || "");
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (newPassword.length < 8) {
    return "Mật khẩu mới cần ít nhất 8 ký tự.";
  }

  if (newPassword !== confirmPassword) {
    return "Mật khẩu xác nhận không khớp.";
  }

  const dbUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
  });

  const validCurrentPassword = await bcrypt.compare(currentPassword, dbUser.passwordHash);
  if (!validCurrentPassword) {
    return "Mật khẩu hiện tại không đúng.";
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(newPassword, 12),
      mustChangePass: false,
    },
  });

  await signOut({ redirectTo: "/login" });
  return null;
}
