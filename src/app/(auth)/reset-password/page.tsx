import type { Metadata } from "next";
import SignInScreen from "@/components/auth/sign-in-screen";

export const metadata: Metadata = {
  title: "Reset Password | SCOPE",
};

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return <SignInScreen preload="reset" token={token ?? null} />;
}