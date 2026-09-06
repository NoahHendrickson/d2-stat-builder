"use client";

import { SignInCard } from "@/components/auth/sign-in-card";
import { useSession } from "@/lib/auth/use-session";
import { BuilderPanel } from "@/components/builder/builder-panel";

export function BuilderPageShell() {
  const session = useSession();
  const authed = session.data?.authenticated ?? false;

  if (!authed) {
    return (
      <main className="mx-auto max-w-md px-6 py-6">
        <SignInCard />
      </main>
    );
  }

  // The armory summary lives in the app sidebar, so the panel never shows it inline.
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 pb-24 lg:px-8 lg:py-8 lg:pb-8">
      <BuilderPanel showInlineStatusCards={false} />
    </main>
  );
}
