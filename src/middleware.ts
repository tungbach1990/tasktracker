import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

const publicPaths = ["/login"];
const passwordPath = "/change-password";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
  });

  if (!token && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.nextUrl));
  }

  if (token?.mustChangePass && pathname !== passwordPath && !pathname.startsWith("/api/auth")) {
    return NextResponse.redirect(new URL(passwordPath, request.nextUrl));
  }

  if (token && pathname === "/login") {
    const destination = token.mustChangePass ? passwordPath : "/dashboard";
    return NextResponse.redirect(new URL(destination, request.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
