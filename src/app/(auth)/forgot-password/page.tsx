import type { Metadata } from "next";
import SignInScreen from "@/components/auth/sign-in-screen";

export const metadata: Metadata = {
  title: "Forgot Password | SCOPE",
};

export default function ForgotPasswordPage() {
  return <SignInScreen preload="forgot" />;
}