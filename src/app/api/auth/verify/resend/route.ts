import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateOtp, hashToken } from "@/lib/auth/tokens";
import { sendVerificationEmail } from "@/lib/email";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { fieldErrors, resendCodeSchema } from "@/lib/validation/auth";
import { isAuthConfigured } from "@/lib/auth/config";
import {
  RESEND_COOLDOWN_MS,
  VERIFICATION_CODE_TTL_MS,
} from "@/lib/auth/tokens";

export async function POST(request: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: "Authentication is not configured." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = resendCodeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ errors: fieldErrors(parsed.error) }, { status: 400 });
  }

  const { email } = parsed.data;

  // Rate limit by IP + email, enforced server-side.
  const limit = checkEndpointRateLimit(request, "resend", email);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many resend attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Never reveal whether an email is registered: same shape whether or not a
  // user exists.
  if (!user || user.emailVerifiedAt) {
    return NextResponse.json(
      { ok: true, cooldownSeconds: RESEND_COOLDOWN_MS / 1000 },
      { status: 200 }
    );
  }

  // Server-side resend cooldown — this is the real enforcement, not the UI.
  if (user.emailVerificationLastSentAt) {
    const elapsed =
      Date.now() - user.emailVerificationLastSentAt.getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      const remainingSeconds = Math.ceil(
        (RESEND_COOLDOWN_MS - elapsed) / 1000
      );
      return NextResponse.json(
        {
          error: "Please wait before requesting another code.",
          remainingSeconds,
        },
        { status: 429, headers: { "Retry-After": String(remainingSeconds) } }
      );
    }
  }

  const code = generateOtp();
  const now = new Date();
  await prisma.$transaction([
    prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        code: code,
        codeHash: hashToken(code),
        expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS),
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationLastSentAt: now },
    }),
  ]);

  await sendVerificationEmail(email, code);

  return NextResponse.json(
    { ok: true, cooldownSeconds: RESEND_COOLDOWN_MS / 1000 },
    { status: 200 }
  );
}