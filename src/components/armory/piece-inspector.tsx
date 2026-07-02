"use client";

import { useMemo, useState } from "react";
import { useArmory } from "@/lib/armory/use-armory";
import { useSession } from "@/lib/auth/use-session";
import {
  CLASS_NAMES,
  SLOT_LABELS,
  STAT_LABELS,
  STAT_ORDER,
  offArchetypeIndices,
} from "@/lib/armory/stats";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function PieceInspector() {
  const session = useSession();
  const { data } = useArmory();
  const [query, setQuery] = useState("");

  // Must run before the early return (rules of hooks), so the guard lives inside.
  const pieces = data?.pieces;
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      pieces && q.length >= 2
        ? pieces.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 10)
        : [],
    [pieces, q],
  );

  if (!session.data?.authenticated || !data) return null;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Inspect a piece</CardTitle>
        <CardDescription>
          Search your gear by name to check computed stats — masterworked base,
          with the raw roll in parentheses (no mods). Compare to the game.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Input
          placeholder="Search a piece name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {matches.map((p) => (
          <div
            key={p.instanceId}
            className="border-border/60 rounded-lg border p-3 text-sm"
          >
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-medium">{p.name}</span>
              <span className="text-muted-foreground text-xs">
                {CLASS_NAMES[p.classType] ?? "—"} · {SLOT_LABELS[p.slot]} ·{" "}
                {p.location}
              </span>
              {p.isExotic && (
                <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                  Exotic
                </Badge>
              )}
              {p.isArtifice && (
                <Badge variant="outline" className="px-1 py-0 text-[10px]">
                  Artifice
                </Badge>
              )}
              {p.tunedStat !== undefined && (
                <Badge variant="outline" className="px-1 py-0 text-[10px]">
                  Tunable
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {STAT_ORDER.map((key, i) => (
                <span key={key} className="tabular-nums">
                  <span className="text-muted-foreground">
                    {STAT_LABELS[key].slice(0, 3)}
                  </span>{" "}
                  <span className="text-foreground">{p.stats[i]}</span>
                  <span className="text-muted-foreground/50">
                    {" "}
                    ({p.baseStats[i]})
                  </span>
                </span>
              ))}
            </div>
            {p.tunedStat !== undefined && (
              <div className="text-muted-foreground mt-1.5 text-xs">
                Tuned:{" "}
                <span className="text-foreground">
                  {STAT_LABELS[STAT_ORDER[p.tunedStat]]}
                </span>
                {" — directional +5 / −5 · Balanced +1 → "}
                {offArchetypeIndices(p.baseStats)
                  .map((i) => STAT_LABELS[STAT_ORDER[i]].slice(0, 3))
                  .join(", ")}
              </div>
            )}
          </div>
        ))}
        {q.length >= 2 && matches.length === 0 && (
          <p className="text-muted-foreground text-sm">No matching pieces.</p>
        )}
      </CardContent>
    </Card>
  );
}
