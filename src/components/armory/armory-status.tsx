"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowsClockwise, CheckCircle, CircleNotch, XCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ArmoryDiagnosticsGate } from "@/components/armory/armory-diagnostics-gate";
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

const REFRESH_SUCCESS_MS = 2500;

export function ArmoryStatus() {
  const session = useSession();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, isFetching, refetch } = useArmory();
  const [refreshSucceeded, setRefreshSucceeded] = useState(false);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    },
    [],
  );

  const handleRefresh = async () => {
    setRefreshSucceeded(false);
    const result = await refetch();
    if (!result.isSuccess) return;

    void queryClient.invalidateQueries({ queryKey: ["armory-diagnostics-counts"] });

    setRefreshSucceeded(true);
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = setTimeout(
      () => setRefreshSucceeded(false),
      REFRESH_SUCCESS_MS,
    );
  };

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
      {!isLoading && (
        <CardContent className="space-y-4">
          <ArmoryDiagnosticsGate />
          {data && pieces.length > 0 && (
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
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={isFetching || refreshSucceeded}
            onClick={() => void handleRefresh()}
          >
            {isFetching ? (
              <CircleNotch weight="duotone" className="animate-spin" aria-hidden />
            ) : refreshSucceeded ? (
              <CheckCircle weight="duotone" className="text-emerald-500" aria-hidden />
            ) : (
              <ArrowsClockwise weight="duotone" aria-hidden />
            )}
            {isFetching ? "Refreshing…" : refreshSucceeded ? "Refreshed" : "Refresh gear"}
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
