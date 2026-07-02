"use client";

import { CheckCircle, CircleNotch, XCircle } from "@phosphor-icons/react";
import { useArmory } from "@/lib/armory/use-armory";
import { useSession } from "@/lib/auth/use-session";
import {
  ARMOR_SLOTS,
  CLASS_NAMES,
  SLOT_LABELS,
  type ArmorSlot,
} from "@/lib/armory/stats";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type SlotCounts = Record<ArmorSlot, number>;
const emptyCounts = (): SlotCounts => ({
  helmet: 0,
  arms: 0,
  chest: 0,
  legs: 0,
  classItem: 0,
});

export function ArmoryStatus() {
  const session = useSession();
  const { data, isLoading, isError, error } = useArmory();

  if (!session.data?.authenticated) return null;

  const pieces = data?.pieces ?? [];
  const exotics = pieces.filter((p) => p.isExotic).length;

  const byClass = new Map<number, SlotCounts>();
  for (const p of pieces) {
    if (CLASS_NAMES[p.classType] === undefined) continue;
    const row = byClass.get(p.classType) ?? emptyCounts();
    row[p.slot] += 1;
    byClass.set(p.classType, row);
  }
  const classes = [0, 1, 2].filter((c) => byClass.has(c));

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isLoading && <CircleNotch weight="duotone" className="size-4 animate-spin" />}
          {isError && <XCircle weight="duotone" className="text-destructive size-4" />}
          {data && <CheckCircle weight="duotone" className="size-4 text-emerald-500" />}
          Your armor
        </CardTitle>
        <CardDescription>
          {isLoading && "Loading your Guardians' gear…"}
          {isError &&
            `Couldn't load inventory: ${(error as Error)?.message ?? "unknown error"}`}
          {data &&
            `${pieces.length} armor pieces · ${exotics} exotic across ${data.characters.length} characters.`}
        </CardDescription>
      </CardHeader>
      {data && pieces.length > 0 && (
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="pb-1 font-normal">Class</th>
                {ARMOR_SLOTS.map((s) => (
                  <th key={s} className="pb-1 text-right font-normal">
                    {SLOT_LABELS[s]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => {
                const row = byClass.get(c)!;
                return (
                  <tr key={c} className="border-border/50 border-t">
                    <td className="py-1">{CLASS_NAMES[c]}</td>
                    {ARMOR_SLOTS.map((s) => (
                      <td
                        key={s}
                        className="text-foreground py-1 text-right tabular-nums"
                      >
                        {row[s]}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      )}
    </Card>
  );
}
