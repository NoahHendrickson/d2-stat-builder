"use client";

import { SignInCard } from "@/components/auth/sign-in-card";
import { useSession } from "@/lib/auth/use-session";
import { BuilderPanel } from "@/components/builder/builder-panel";
import { useDesktopLayout } from "@/components/app-shell";

export function BuilderPageShell() {
  const session = useSession();
  const authed = session.data?.authenticated ?? false;
  const desktop = useDesktopLayout();

  if (!authed) {
    return (
      <main className="mx-auto max-w-md px-6 py-6">
        <SignInCard />
      </main>
    );
  }

  // Desktop shows armor/account in the main-column header. Inline cards are
  // only for the narrow-viewport drawer. Bottom padding is for the mobile
  // builds bar; the shell card already insets the view on desktop.
  return (
    <main className="px-6 py-6 pb-24 lg:pb-6">
      <BuilderPanel showInlineStatusCards={!desktop} />
    </main>
  );
}
