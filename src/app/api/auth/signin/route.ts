import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, DUMMY_PASSWORD_HASH } from "@/lib/auth/password";
import { createSignedSession } from "@/lib/auth/session";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/session-cookie";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { fieldErrors, signInSchema } from "@/lib/validation/auth";
import { isAuthConfigured } from "@/lib/auth/config";

export async function POST(request: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: "Authentication is not configured." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = signInSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ errors: fieldErrors(parsed.error) }, { status: 400 });
  }

  const { email, password } = parsed.data;

  const limit = checkEndpointRateLimit(request, "signin", email);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Deliberately run bcrypt against a dummy hash when the account doesn't
  // exist so response timing doesn't reveal which emails are registered.
  const passwordOk = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, DUMMY_PASSWORD_HASH);

  if (!user || !passwordOk) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  if (!user.emailVerifiedAt) {
    return NextResponse.json(
      {
        error: "Please verify your email before signing in.",
        pendingVerification: true,
      },
      { status: 403 }
    );
  }

  const { cookieValue } = await createSignedSession(user.id);

  const response = NextResponse.json(
    {
      user: { id: user.id, email: user.email, fullName: user.fullName },
    },
    { status: 200 }
  );
  response.cookies.set(SESSION_COOKIE, cookieValue, sessionCookieOptions());
  return response;
}