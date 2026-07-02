"use client";

import { CheckCircle, CircleNotch, XCircle } from "@phosphor-icons/react";
import { useManifest } from "@/lib/manifest/use-manifest";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ManifestStatus() {
  const status = useManifest();

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {status.state === "loading" && (
            <CircleNotch weight="duotone" className="size-4 animate-spin" />
          )}
          {status.state === "ready" && (
            <CheckCircle weight="duotone" className="size-4 text-emerald-500" />
          )}
          {status.state === "error" && (
            <XCircle weight="duotone" className="text-destructive size-4" />
          )}
          Game data
        </CardTitle>
        <CardDescription>
          {status.state === "idle" && "Waiting to load the Destiny manifest…"}
          {status.state === "loading" && status.message}
          {status.state === "ready" && `Manifest ${status.manifest.version} ready.`}
          {status.state === "error" && `Couldn't load manifest: ${status.message}`}
        </CardDescription>
      </CardHeader>
      {status.state === "ready" && (
        <CardContent className="text-muted-foreground grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <Stat label="Armor + plugs" value={status.manifest.counts().DestinyInventoryItemDefinition} />
          <Stat label="Stats" value={status.manifest.counts().DestinyStatDefinition} />
          <Stat label="Armor sets" value={status.manifest.counts().DestinyEquipableItemSetDefinition} />
          <Stat label="Sandbox perks" value={status.manifest.counts().DestinySandboxPerkDefinition} />
        </CardContent>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="text-foreground tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}
