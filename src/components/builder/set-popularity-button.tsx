"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import type { Manifest } from "@/lib/manifest/load";

// Opened by few sessions; keep it and its snapshot out of the builder's initial load.
const SetPopularityDialog = dynamic(
  () => import("@/components/builder/set-popularity-dialog").then((m) => m.SetPopularityDialog),
  { ssr: false },
);

/** The Set bonuses header's Popularity button, sized like its Reset buttons; opens the set popularity dialog. */
export function SetPopularityButton({ manifest, classType }: { manifest?: Manifest; classType: number | null }) {
  // Mounted from its first open on (lazy chunk), then kept so it closes with its animation.
  const [open, setOpen] = useState<boolean | null>(null);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Popularity
      </Button>
      {open !== null && (
        <SetPopularityDialog open={open} onOpenChange={setOpen} manifest={manifest} classType={classType} />
      )}
    </>
  );
}
