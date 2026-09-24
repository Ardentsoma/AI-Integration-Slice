import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  getAuthSecret,
  sessionCookieOptions,
  verifySessionCookie,
} from "@/lib/auth/session-cookie";

export async function POST(request: NextRequest) {
  // Idempotent: even with no/invalid cookie we return 200 and clear the cookie.
  const value = request.cookies.get(SESSION_COOKIE)?.value;
  if (value) {
    try {
      const verified = await verifySessionCookie(value, getAuthSecret());
      if (verified) {
        await prisma.session.deleteMany({ where: { id: verified.sessionId } });
      }
    } catch {
      // Non-fatal — the cookie is cleared below regardless.
    }
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}