import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { generateOtp, hashToken } from "@/lib/auth/tokens";
import { sendVerificationEmail } from "@/lib/email";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { fieldErrors, signUpSchema } from "@/lib/validation/auth";
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
  const parsed = signUpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ errors: fieldErrors(parsed.error) }, { status: 400 });
  }

  const { fullName, email, password } = parsed.data;

  const limit = checkEndpointRateLimit(request, "signup", email);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const passwordHash = await hashPassword(password);

  let user;
  try {
    user = await prisma.user.create({ data: { email, passwordHash, fullName } });
  } catch (error) {
    // Unique constraint on email (see schema): the same signup submitted twice
    // must not create a second account or throw a 500. Re-issue a verification
    // code for the existing account instead and answer gracefully.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (!existing) throw error;
      if (existing.emailVerifiedAt) {
        return NextResponse.json({ alreadyVerified: true }, { status: 200 });
      }
      user = existing;
    } else {
      throw error;
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
    { requiresVerification: true, cooldownSeconds: RESEND_COOLDOWN_MS / 1000 },
    { status: 200 }
  );
}