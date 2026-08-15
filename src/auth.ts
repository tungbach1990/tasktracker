import NextAuth from "next-auth";
import type { User } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

const credentialsSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

async function getUserPermissions(userId: string) {
  const userRoles = await prisma.userRole.findMany({
    where: { userId },
    include: {
      role: {
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      },
    },
  });

  return Array.from(
    new Set(
      userRoles.flatMap((userRole) =>
        userRole.role.permissions.map((rolePermission) => rolePermission.permission.key),
      ),
    ),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        username: { label: "Tên đăng nhập", type: "text" },
        password: { label: "Mật khẩu", type: "password" },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { username: parsed.data.username },
        });
        if (!user?.enabled) return null;

        const validPassword = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!validPassword) return null;

        const permissions = await getUserPermissions(user.id);

        return {
          id: user.id,
          name: user.displayName,
          email: user.username,
          username: user.username,
          enabled: user.enabled,
          mustChangePass: user.mustChangePass,
          permissions,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const appUser = user as User & {
          username?: string;
          enabled?: boolean;
          mustChangePass?: boolean;
          permissions?: string[];
        };
        token.id = appUser.id;
        token.username = appUser.username;
        token.enabled = appUser.enabled;
        token.mustChangePass = appUser.mustChangePass;
        token.permissions = appUser.permissions ?? [];
      }
      return token;
    },
    async session({ session, token }) {
      const sessionUser = session.user as typeof session.user & {
        id: string;
        username: string;
        enabled: boolean;
        mustChangePass: boolean;
        permissions: string[];
      };
      sessionUser.id = typeof token.id === "string" ? token.id : "";
      sessionUser.username = typeof token.username === "string" ? token.username : "";
      sessionUser.enabled = Boolean(token.enabled);
      sessionUser.mustChangePass = Boolean(token.mustChangePass);
      sessionUser.permissions = Array.isArray(token.permissions)
        ? token.permissions.map(String)
        : [];
      return session;
    },
  },
});
