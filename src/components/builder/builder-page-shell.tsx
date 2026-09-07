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
  // Figma 14:5181: the view is a 1640px frame beside the sidebar, content inset ~100px
  // on the left and ~77px on top at that size; smaller screens tighten the insets.
  return (
    <main className="mx-auto max-w-[102.5rem] px-6 py-6 pb-24 lg:px-12 lg:py-16 2xl:px-24">
      <BuilderPanel showInlineStatusCards={false} />
    </main>
  );
}
