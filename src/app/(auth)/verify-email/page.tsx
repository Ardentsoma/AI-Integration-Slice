import type { Metadata } from "next";
import SignInScreen from "@/components/auth/sign-in-screen";

export const metadata: Metadata = {
  title: "Verify Your Email | SCOPE",
};

export default function VerifyEmailPage() {
  return <SignInScreen preload="verify" />;
}