"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowsCounterClockwise, CheckCircle, CircleNotch } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ClassGlyph } from "@/components/class-glyph";
import { ArmoryDiagnosticsGate } from "@/components/armory/armory-diagnostics-gate";
import { useArmory } from "@/lib/armory/use-armory";
import { useSession } from "@/lib/auth/use-session";
import {
  ARMOR_SLOTS,
  CLASS_NAMES,
  SLOT_LABELS,
  type ArmorSlot,
} from "@/lib/armory/stats";

type SlotCounts = Record<ArmorSlot, number>;
const emptyCounts = (): SlotCounts => ({
  helmet: 0,
  arms: 0,
  chest: 0,
  legs: 0,
  classItem: 0,
});

const REFRESH_SUCCESS_MS = 2500;

/**
 * Figma "Your armor" card (1:406): piece / exotic totals, a class × slot count grid
 * (class sigils down the left), and Refresh gear. `actions` renders on the button row's
 * far side (the sidebar puts the theme toggle there).
 */
export function ArmoryStatus({ actions }: { actions?: ReactNode }) {
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
    <section
      aria-label="Your armor"
      className="border-border bg-primary/6 flex w-full flex-col gap-6 rounded-2xl border p-4"
    >
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Your armor</h2>
        <p className="text-muted-foreground flex flex-wrap gap-x-4 text-sm tabular-nums">
          {isLoading && "Loading your Guardians' gear…"}
          {isError &&
            `Couldn't load inventory: ${(error as Error)?.message ?? "unknown error"}`}
          {data && (
            <>
              <span>{pieces.length} armor pieces</span>
              <span>{exotics} exotics</span>
            </>
          )}
        </p>
      </div>

      {classes.length > 0 && (
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr className="text-muted-foreground text-left font-normal">
              <th scope="col" className="border-border w-8 border-b pb-1 font-normal">
                <span className="sr-only">Class</span>
              </th>
              {ARMOR_SLOTS.map((s) => (
                <th
                  key={s}
                  scope="col"
                  className="border-border border-b pb-1 pl-1 font-normal whitespace-nowrap"
                >
                  {SLOT_LABELS[s]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {classes.map((c) => {
              const row = byClass.get(c)!;
              return (
                <tr key={c} className="h-5 align-middle">
                  <th scope="row" className="text-foreground/65 pt-1 text-center font-normal">
                    <ClassGlyph classType={c} className="mx-auto" />
                  </th>
                  {ARMOR_SLOTS.map((s) => (
                    <td key={s} className="pt-1 pl-1 font-medium tabular-nums">
                      {row[s]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {!isLoading && <ArmoryDiagnosticsGate />}

      <div className="flex items-center justify-between gap-2">
        <Button
          size="xs"
          disabled={isFetching || refreshSucceeded}
          onClick={() => void handleRefresh()}
        >
          {isFetching ? (
            <CircleNotch weight="duotone" className="animate-spin" aria-hidden />
          ) : refreshSucceeded ? (
            <CheckCircle weight="duotone" className="text-emerald-500" aria-hidden />
          ) : (
            <ArrowsCounterClockwise weight="duotone" aria-hidden />
          )}
          {isFetching ? "Refreshing…" : refreshSucceeded ? "Refreshed" : "Refresh gear"}
        </Button>
        {actions}
      </div>
    </section>
  );
}
