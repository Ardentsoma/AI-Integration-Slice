import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { isAuthConfigured } from "@/lib/auth/config";
import SignOutButton from "./sign-out-button";

export const metadata: Metadata = {
  title: "Dashboard | SCOPE",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (!isAuthConfigured()) {
    redirect("/signin");
  }

  const user = await getSessionUser();

  // Server-side session check: no valid session (even a direct URL hit with
  // no referrer) bounces straight back to /signin.
  if (!user) {
    redirect("/signin");
  }

  const displayName = user.fullName || user.email.split("@")[0] || "designer";

  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-neutral-100 px-8 py-4">
        <span className="relative inline-block text-xl font-extrabold leading-none tracking-[0.04em] text-neutral-500">
          SCOPE
          <span className="absolute -bottom-1 right-0 h-[3px] w-7 rounded-sm bg-red-500" />
        </span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-neutral-300">Welcome, {displayName}</span>
          <SignOutButton />
        </div>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-3xl font-display tracking-tight text-neutral-500">
          Your projects are on the way.
        </h1>
        <p className="max-w-md leading-relaxed text-neutral-300">
          This is where clients, projects, and AI-generated project outlines
          will live. The client and project workspace is the next screen to
          build.
        </p>
        <a
          href="/dashboard/briefs"
          className="mt-4 rounded-md bg-neutral-500 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-neutral-600"
        >
          Turn a client brief into an outline
        </a>
      </section>
    </main>
  );
}