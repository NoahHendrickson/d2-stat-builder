"use client";

import { memo } from "react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  enteredWeaponPowers,
  type PowerRangeSelection,
} from "@/lib/builder/selection-storage";
import { reachableGearPower, type ArmorPowerSpan } from "@/lib/builder/power-span";
import { cn } from "@/lib/utils";

const WEAPON_SLOTS = ["Kinetic", "Energy", "Heavy"] as const;
/** Upper bound on what a power input accepts — generous, the game's cap moves. */
const POWER_INPUT_MAX = 9999;

/** A typed power: a non-negative integer, else null. */
function parsePower(raw: string): number | null {
  const n = Math.round(Number(raw));
  return raw.trim() !== "" && Number.isFinite(n) && n >= 0
    ? Math.min(POWER_INPUT_MAX, n)
    : null;
}

/**
 * The "Power matters" toggle: constrain builds to a gear-power range, with the weapon
 * powers the build will be equipped alongside typed in by hand. The min / max inputs
 * commit on blur or Enter (not per keystroke, so typing a new maximum can't momentarily
 * drag the minimum with it); the slider commits live.
 */
export const PowerRangeControls = memo(function PowerRangeControls({
  value,
  onChange,
  armorSpan,
}: {
  value: PowerRangeSelection;
  onChange: (next: PowerRangeSelection) => void;
  /** Per-slot power extremes of the armor being searched; null while unknown. */
  armorSpan: ArmorPowerSpan | null;
}) {
  const { enabled, min, max, weapons } = value;
  // The gear power a build can land on with the weapons entered so far.
  const reach = armorSpan
    ? reachableGearPower(armorSpan, enteredWeaponPowers(value))
    : null;
  const outOfReach = reach !== null && (min > reach.max || max < reach.min);

  const commitMin = (n: number | null) => {
    if (n === null) return;
    onChange({ ...value, min: n, max: Math.max(n, max) });
  };
  const commitMax = (n: number | null) => {
    if (n === null) return;
    onChange({ ...value, min: Math.min(n, min), max: n });
  };
  const commitWeapon = (slot: number, n: number | null) => {
    const next = [...weapons] as PowerRangeSelection["weapons"];
    next[slot] = n;
    onChange({ ...value, weapons: next });
  };

  // Slider spans the reachable gear power, widened to keep both thumbs visible when the
  // stored range sits outside it (e.g. carried over from another class).
  const sliderMin = reach ? Math.min(reach.min, min) : min;
  const sliderMax = reach ? Math.max(reach.max, max) : max;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <span className="text-sm">Power matters</span>
          <p className="text-muted-foreground text-xs">
            Only show builds whose gear power lands in a range. Power is the
            game&apos;s average over the five armor pieces and the weapons you
            enter below.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => onChange({ ...value, enabled: checked })}
          aria-label="Power matters"
        />
      </div>

      {enabled && (
        <>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <PowerInput
                label="Minimum power"
                value={min}
                onCommit={commitMin}
              />
              <span className="text-muted-foreground text-xs">to</span>
              <PowerInput
                label="Maximum power"
                value={max}
                onCommit={commitMax}
              />
              {reach && (
                <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                  Reachable {reach.min}–{reach.max}
                </span>
              )}
            </div>
            {reach && sliderMax > sliderMin && (
              <Slider
                min={sliderMin}
                max={sliderMax}
                step={1}
                value={[min, max]}
                onValueChange={(v) => {
                  if (!Array.isArray(v) || v.length !== 2) return;
                  onChange({ ...value, min: v[0], max: v[1] });
                }}
                aria-label="Power range"
                className="cursor-pointer"
              />
            )}
            {outOfReach && reach && (
              <p className="text-destructive text-xs" role="status">
                No build can land in this range — with these weapons your gear
                reaches {reach.min}–{reach.max}.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm">Weapons</span>
              <span className="text-muted-foreground text-xs">
                Leave a slot blank to skip it
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {WEAPON_SLOTS.map((name, i) => (
                <label key={name} className="space-y-1">
                  <span className="text-muted-foreground block text-[10px] font-medium tracking-wide uppercase">
                    {name}
                  </span>
                  <PowerInput
                    label={`${name} weapon power`}
                    value={weapons[i]}
                    allowBlank
                    placeholder="—"
                    onCommit={(n) => commitWeapon(i, n)}
                    className="w-full"
                  />
                </label>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              The power of the weapons you&apos;ll equip with the build, averaged
              in with the armor.
            </p>
          </div>
        </>
      )}
    </div>
  );
});

/**
 * An uncontrolled numeric field that commits on blur / Enter. Keyed on the committed
 * value so an outside change (slider drag, normalization) re-renders the text, while
 * typing stays free — a controlled field would snap back on every keystroke. Invalid
 * text is reverted; a cleared field commits null only when `allowBlank`.
 */
function PowerInput({
  label,
  value,
  allowBlank = false,
  placeholder,
  onCommit,
  className,
}: {
  label: string;
  value: number | null;
  allowBlank?: boolean;
  placeholder?: string;
  onCommit: (n: number | null) => void;
  className?: string;
}) {
  return (
    <Input
      key={value ?? "blank"}
      type="number"
      inputMode="numeric"
      min={0}
      max={POWER_INPUT_MAX}
      step={1}
      defaultValue={value ?? ""}
      placeholder={placeholder}
      aria-label={label}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onBlur={(e) => {
        const raw = e.target.value;
        const blank = raw.trim() === "";
        const n = blank ? null : parsePower(raw);
        if (blank ? !allowBlank : n === null) {
          // Reverted: back to the committed value.
          e.target.value = value === null ? "" : String(value);
          return;
        }
        e.target.value = n === null ? "" : String(n);
        onCommit(n);
      }}
      className={cn(
        "h-8 w-16 px-2 text-center text-sm tabular-nums [appearance:textfield] md:text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        className,
      )}
    />
  );
}
