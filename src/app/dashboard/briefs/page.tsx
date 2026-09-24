import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";
import { isAuthConfigured } from "@/lib/auth/config";
import { isAIConfigured } from "@/lib/ai/config";
import BriefsApp from "@/components/briefs/briefs-app";
import SignOutButton from "../sign-out-button";

export const metadata: Metadata = {
  title: "New Brief | SCOPE",
};

export const dynamic = "force-dynamic";

export default async function BriefsPage() {
  if (!isAuthConfigured()) {
    redirect("/signin");
  }

  const user = await getSessionUser();
  if (!user) {
    redirect("/signin");
  }

  const aiReady = isAIConfigured();

  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-neutral-100 px-8 py-4">
        <a
          href="/dashboard"
          className="relative inline-block text-xl font-extrabold leading-none tracking-[0.04em] text-neutral-500"
        >
          SCOPE
          <span className="absolute -bottom-1 right-0 h-[3px] w-7 rounded-sm bg-red-500" />
        </a>
        <div className="flex items-center gap-4">
          <SignOutButton />
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
        <div className="text-center">
          <h1 className="font-display text-3xl tracking-tight text-neutral-500">
            Turn a messy brief into a clear outline
          </h1>
          <p className="mt-2 text-neutral-300">
            Drop in the client&apos;s raw brief (.txt or .pdf, up to 5 MB) and
            SCOPE extracts goals, deliverables, a timeline, and budget notes.
          </p>
        </div>

        {!aiReady && (
          <div className="rounded-lg border-l-4 border-yellow-500 bg-yellow-50 px-5 py-4 text-sm text-yellow-700">
            AI and file storage are not configured yet. Add the keys from{" "}
            <code className="font-mono text-xs">.env.example</code> (
            GEMINI_API_KEY, DEEPSEEK_API_KEY, R2_*) before uploading — until
            then jobs will fail with a clear error instead of processing.
          </div>
        )}

        <BriefsApp />
      </section>
    </main>
  );
}