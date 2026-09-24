import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { isAuthConfigured } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!isAuthConfigured()) {
    redirect("/signin");
  }

  const user = await getSessionUser();
  redirect(user ? "/dashboard" : "/signin");
}