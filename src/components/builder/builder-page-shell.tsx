"use client";

import { useEffect, useState } from "react";
import { SignInCard } from "@/components/auth/sign-in-card";
import { useSession } from "@/lib/auth/use-session";
import { ArmoryStatus } from "@/components/armory/armory-status";
import { BuilderPanel } from "@/components/builder/builder-panel";

const WIDE_BREAKPOINT_PX = 1536;

function useMinWidth(minWidth: number) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [minWidth]);

  return matches;
}

export function BuilderPageShell() {
  const wide = useMinWidth(WIDE_BREAKPOINT_PX);
  const session = useSession();
  const authed = session.data?.authenticated ?? false;

  if (!authed) {
    return (
      <main className="mx-auto max-w-md px-6 py-6">
        <SignInCard />
      </main>
    );
  }

  if (wide) {
    return (
      <div className="mx-auto flex max-w-[calc(80rem+22rem+2rem)] gap-8 px-6 py-6">
        <aside className="w-[22rem] shrink-0 self-start">
          <div className="sticky top-[58px] opacity-80">
            <ArmoryStatus />
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <BuilderPanel showInlineStatusCards={false} />
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <BuilderPanel showInlineStatusCards />
    </main>
  );
}
