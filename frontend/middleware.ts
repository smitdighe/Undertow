import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { safeCallbackUrl } from "@/lib/utils/callback-url";

export async function middleware(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const { pathname, searchParams } = req.nextUrl;

  // Already authenticated and asking for /auth: send them on rather than render a
  // login form they don't need. Handled here, not in the page, so there is no
  // authenticated flash of the form before a client-side bounce.
  if (pathname === "/auth") {
    if (!token) return NextResponse.next();
    // safeCallbackUrl refuses /auth and off-origin targets, so this can't bounce
    // back here forever or be steered off-site by a crafted ?callbackUrl.
    return NextResponse.redirect(new URL(safeCallbackUrl(searchParams.get("callbackUrl")), req.url));
  }

  if (!token) {
    const signInUrl = new URL("/auth", req.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/auth"],
};
