import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateResetToken, hashToken } from "@/lib/auth/tokens";
import { sendPasswordResetEmail } from "@/lib/email";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { fieldErrors, requestResetSchema } from "@/lib/validation/auth";
import { isAuthConfigured } from "@/lib/auth/config";
import { RESET_TOKEN_TTL_MS } from "@/lib/auth/tokens";

export async function POST(request: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: "Authentication is not configured." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = requestResetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ errors: fieldErrors(parsed.error) }, { status: 400 });
  }

  const { email } = parsed.data;

  const limit = checkEndpointRateLimit(request, "resetRequest", email);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many reset requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Same response whether or not the account exists — no user enumeration.
  if (user && user.emailVerifiedAt) {
    const token = generateResetToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const resetUrl = `${request.nextUrl.origin}/reset-password?token=${token}`;
    await sendPasswordResetEmail(email, resetUrl);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}