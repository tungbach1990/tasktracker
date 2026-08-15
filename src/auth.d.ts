import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      enabled: boolean;
      mustChangePass: boolean;
      permissions: string[];
    } & DefaultSession["user"];
  }

  interface User {
    username?: string;
    enabled?: boolean;
    mustChangePass?: boolean;
    permissions?: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    username?: string;
    enabled?: boolean;
    mustChangePass?: boolean;
    permissions?: string[];
  }
}
