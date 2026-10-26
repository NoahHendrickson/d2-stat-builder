"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Roll } from "@/lib/weapons/pick-slots";
import type { PerkRef } from "@/lib/weapons/types";
import type { DpsSetup } from "@/lib/weapons/weapon-dps";
import { cn } from "@/lib/utils";

/** Setups shown before "Show more"; most weapons have one, a few up to seven. */
const DPS_SHOWN = 3;
const wholeNumber = new Intl.NumberFormat("en-US");

/**
 * The DPS sheet's tested setups for a weapon, highest DPS first. Each is its
 * numbers side by side, a label over each, then the perks it ran from the
 * weapon's grid as icons, then what the setup ran in the sheet's words.
 * "See perks" at the bottom picks the chosen setup's perks; when more than one
 * setup names perks, the setups are a choice between them (the first, at
 * the start), and once "See perks" is pressed, choosing one picks its perks
 * straight away.
 */
export function DpsSetups({
  setups,
  rolls,
  perks,
  onSeePerks,
}: {
  setups: DpsSetup[];
  /** Per setup, the grid perks it names, or null for none (see setupRolls). */
  rolls: (Roll | null)[];
  perks: readonly PerkRef[];
  onSeePerks: (roll: Roll) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [chosen, setChosen] = useState(() => rolls.findIndex(Boolean));
  // Once "See perks" is pressed, choosing another setup picks its perks too.
  const [live, setLive] = useState(false);
  function choose(i: number) {
    setChosen(i);
    const roll = rolls[i];
    if (live && roll && i !== chosen) onSeePerks(roll);
  }
  function toggleShowAll() {
    // Collapsing mustn't hide the chosen setup: the radio group would have no
    // stop for the keyboard, and See perks would pick a setup that isn't shown.
    // The choice moves to the first one still shown.
    if (showAll && chosen >= DPS_SHOWN) setChosen(rolls.slice(0, DPS_SHOWN).findIndex(Boolean));
    setShowAll((all) => !all);
  }
  const shown = showAll ? setups : setups.slice(0, DPS_SHOWN);
  const choosable = rolls.filter(Boolean).length > 1;
  const choices = shown.flatMap((_, i) => (rolls[i] ? [i] : []));
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  function step(from: number, by: number) {
    const at = choices.indexOf(from);
    const next = choices[(at + by + choices.length) % choices.length];
    if (next === undefined) return;
    choose(next);
    rowRefs.current[next]?.focus();
  }
  const roll = rolls[chosen];
  return (
    <div className="grid gap-5 text-[13px]">
      <div
        role={choosable ? "radiogroup" : undefined}
        aria-label={choosable ? "DPS setups" : undefined}
        className={cn("grid", choosable ? "gap-1" : "gap-5")}
      >
        {shown.map((setup, i) => {
          const named = Object.values(rolls[i] ?? {}).flatMap((index) => perks[index] ?? []);
          const option = choosable && rolls[i] != null;
          return (
            <div
              key={i}
              ref={(row) => {
                rowRefs.current[i] = row;
              }}
              role={option ? "radio" : undefined}
              aria-checked={option ? chosen === i : undefined}
              aria-label={option ? `${wholeNumber.format(setup.dps)} boss DPS: ${setup.setup}` : undefined}
              tabIndex={option ? (chosen === i ? 0 : -1) : undefined}
              onClick={option ? () => choose(i) : undefined}
              onKeyDown={
                option
                  ? (event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowRight") step(i, 1);
                      else if (event.key === "ArrowUp" || event.key === "ArrowLeft") step(i, -1);
                      else if (event.key === " " || event.key === "Enter") choose(i);
                      else return;
                      event.preventDefault();
                    }
                  : undefined
              }
              className={cn(
                "grid gap-2",
                // Out into the card's padding by its own, so the text stays
                // in line with the title; the chosen setup a faint frame and
                // fill (the frame always there, clear, so choosing doesn't
                // shift it).
                choosable &&
                  "-mx-2 border border-transparent p-2 outline-none focus-visible:d2-tile-selected normal:rounded-md",
                option && "cursor-pointer hover:bg-foreground/3",
                option &&
                  chosen === i &&
                  "border-foreground/16 bg-foreground/5 hover:bg-foreground/5",
              )}
            >
              <dl className="grid grid-cols-3 gap-x-3">
                <DpsFigure
                  name="Boss DPS"
                  hint="Sustained damage per second against a boss, reloads included"
                  value={wholeNumber.format(setup.dps)}
                />
                {(setup.reservesDamage !== undefined || setup.infinite) && (
                  <DpsFigure
                    name="Full reserves"
                    hint={
                      setup.infinite
                        ? "Unlimited ammo, so there are no reserves to run out of"
                        : "Total damage from firing full reserves"
                    }
                    value={
                      setup.reservesDamage !== undefined
                        ? wholeNumber.format(setup.reservesDamage)
                        : "Infinite"
                    }
                  />
                )}
                {setup.timeToEmpty !== undefined && (
                  <DpsFigure
                    name="Time to empty"
                    hint="Seconds to fire full reserves, reloads included"
                    value={`${setup.timeToEmpty.toFixed(1)} s`}
                  />
                )}
              </dl>
              {named.length > 0 && (
                // The grid's own round cells, small.
                <ul aria-label="Perks it ran" className="flex flex-wrap gap-1.5">
                  {named.map((perk) => (
                    <li
                      key={perk.hash}
                      title={perk.name}
                      className="flex size-7 items-center justify-center rounded-full border border-foreground/12 bg-foreground/4"
                    >
                      {perk.icon && (
                        <Image
                          src={`https://www.bungie.net${perk.icon}`}
                          alt={perk.name}
                          width={20}
                          height={20}
                          unoptimized
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {setup.setup && (
                <p className="text-xs text-muted-foreground">{setup.setup}</p>
              )}
            </div>
          );
        })}
      </div>
      {setups.length > DPS_SHOWN && (
        <Button size="sm" variant="ghost" className="justify-self-start" onClick={toggleShowAll}>
          {showAll ? "Show fewer" : `Show ${setups.length - DPS_SHOWN} more`}
        </Button>
      )}
      {roll && (
        // The primary buttons' size, across the card.
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            setLive(true);
            onSeePerks(roll);
          }}
        >
          See perks
        </Button>
      )}
    </div>
  );
}

/** One DPS number, larger, under its label; the label's title spells it out. */
function DpsFigure({
  name,
  hint,
  value,
}: {
  name: string;
  hint: string;
  value: string;
}) {
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <dt className="truncate text-xs text-muted-foreground" title={hint}>
        {name}
      </dt>
      <dd className="text-lg leading-6 font-medium tabular-nums">{value}</dd>
    </div>
  );
}
