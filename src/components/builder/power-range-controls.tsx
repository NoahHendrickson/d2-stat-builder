"use client";

import { memo, useId, useMemo, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  enteredWeaponPowers,
  samePowerRangeSelection,
  type PowerRangeSelection,
} from "@/lib/builder/selection-storage";
import {
  armorPowerSpan,
  reachableGearPower,
  seedPowerRange,
} from "@/lib/builder/power-span";
import { DREAMERS_BOND_POWER } from "@/lib/armory/dreamers-bond";
import { cn } from "@/lib/utils";
import { PowerValue } from "@/components/power-value";

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
 * powers the build will be equipped alongside typed in by hand. Owns the first-enable
 * policy: turning the switch on with no bounds yet seeds the top five gear-power levels
 * the candidate armor can reach. The min / max inputs commit on blur or Enter (not per
 * keystroke, so typing a new maximum can't momentarily drag the minimum with it); the
 * slider commits live. A commit that changes nothing is dropped, so a field blurred
 * untouched doesn't re-render the builder or re-save. Closes with the "Force Dreamer's
 * Bond" checkbox: the 21-power collections class item is a power-range lever, so it
 * lives here rather than as a standalone pin.
 */
export const PowerRangeControls = memo(function PowerRangeControls({
  value,
  onChange,
  slotPieces,
  dreamersItemName,
}: {
  value: PowerRangeSelection;
  onChange: (next: PowerRangeSelection) => void;
  /**
   * The optimizer's candidate pieces per slot AS THEY WILL BE while Power matters is on
   * (the toggle itself can change the pool — a checked Dreamer's Bond takes over the
   * class-item slot only once it's enabled). Only power and exotic-ness are read.
   */
  slotPieces: readonly (readonly { power?: number; isExotic: boolean }[])[];
  /** Class-specific collections item: Dreamer's Bond / Cloak / Mark. */
  dreamersItemName: string;
}) {
  const { enabled, bounds, weapons, dreamersBond, legacyArmor } = value;
  const dreamersId = useId();
  const legacyArmorId = useId();
  const armorSpan = useMemo(() => armorPowerSpan(slotPieces), [slotPieces]);
  // The gear power a build can land on with the weapons entered so far.
  const reach = armorSpan
    ? reachableGearPower(armorSpan, enteredWeaponPowers(value))
    : null;
  const outOfReach =
    reach !== null &&
    bounds !== null &&
    (bounds.min > reach.max || bounds.max < reach.min);

  const emit = (next: PowerRangeSelection) => {
    if (!samePowerRangeSelection(value, next)) onChange(next);
  };
  const onToggle = (checked: boolean) => {
    let next: PowerRangeSelection = { ...value, enabled: checked };
    if (checked && next.bounds === null && armorSpan) {
      const seed = seedPowerRange(armorSpan, enteredWeaponPowers(next));
      if (seed) next = { ...next, bounds: seed };
    }
    emit(next);
  };
  const commitMin = (n: number | null) => {
    if (n === null) return;
    emit({ ...value, bounds: { min: n, max: Math.max(n, bounds?.max ?? n) } });
  };
  const commitMax = (n: number | null) => {
    if (n === null) return;
    emit({ ...value, bounds: { min: Math.min(n, bounds?.min ?? n), max: n } });
  };
  const commitWeapon = (slot: number, n: number | null) => {
    const next = [...weapons] as PowerRangeSelection["weapons"];
    next[slot] = n;
    emit({ ...value, weapons: next });
  };

  // Slider spans the reachable gear power, widened to keep both thumbs visible when the
  // stored range sits outside it (e.g. carried over from another class).
  const sliderMin = reach && bounds ? Math.min(reach.min, bounds.min) : 0;
  const sliderMax = reach && bounds ? Math.max(reach.max, bounds.max) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <span className="text-sm d2:font-medium">Power matters</span>
          <p className="text-muted-foreground text-xs">
            Only show builds whose gear power lands in a range. Festival of
            the Lost masks count as power 0, so your masks join the helmet
            candidates while this is on.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          aria-label="Power matters"
        />
      </div>

      {enabled && (
        <ol
          className="list-none space-y-4 rounded-md border border-power/30 bg-power/10 p-3"
          aria-label="Power matters steps"
        >
          <Step n={1}>
            <div>
              <p className="text-sm d2:font-medium">
                Set the power range you want
              </p>
              <p className="text-muted-foreground text-xs">
                Gear power is the game&apos;s average over the five armor
                pieces and the weapons you enter next. Pick the light level
                you want the build to land in.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <PowerInput
                  label="Minimum power"
                  value={bounds?.min ?? null}
                  onCommit={commitMin}
                />
                <span className="text-muted-foreground text-xs">to</span>
                <PowerInput
                  label="Maximum power"
                  value={bounds?.max ?? null}
                  onCommit={commitMax}
                />
                {reach && (
                  <span className="ml-auto flex items-baseline gap-1.5 text-xs tabular-nums">
                    <span className="d2-label d2:text-[10px]">Reach</span>
                    <PowerValue value={`${reach.min}–${reach.max}`} size="xs" />
                  </span>
                )}
              </div>
              {reach && bounds && sliderMax > sliderMin && (
                <Slider
                  min={sliderMin}
                  max={sliderMax}
                  step={1}
                  value={[bounds.min, bounds.max]}
                  onValueChange={(v) => {
                    if (!Array.isArray(v) || v.length !== 2) return;
                    emit({ ...value, bounds: { min: v[0], max: v[1] } });
                  }}
                  aria-label="Power range"
                  className="cursor-pointer"
                />
              )}
              {outOfReach && reach && (
                <p className="text-destructive text-xs" role="status">
                  No build can land in this range — with these weapons your
                  gear reaches {reach.min}–{reach.max}.
                </p>
              )}
            </div>
          </Step>

          <Step n={2}>
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-sm d2:font-medium">
                Enter the weapons you&apos;ll use
              </p>
              <span className="text-muted-foreground text-xs">
                Leave a slot blank to skip it
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              Figure out what you want to run, then input their light level.
              Ideally have at least one 10-power weapon and the others at 300
              or below. The lower your weapons, the better stats you&apos;ll
              get — the armor can sit higher.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {WEAPON_SLOTS.map((name, i) => (
                <label key={name} className="space-y-1">
                  <span className="d2-label block text-[10px] tracking-wide uppercase d2:tracking-(--tracking-label)">
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
          </Step>

          <Step n={3}>
            <div className="flex items-start gap-3">
              <Checkbox
                id={legacyArmorId}
                checked={legacyArmor}
                onCheckedChange={(checked) =>
                  emit({ ...value, legacyArmor: checked === true })
                }
                className="mt-0.5 cursor-pointer"
              />
              <label
                htmlFor={legacyArmorId}
                className="cursor-pointer space-y-0.5"
              >
                <span className="block text-sm d2:font-medium">
                  Turn on legacy armor
                </span>
                <span className="text-muted-foreground block text-xs">
                  If you&apos;re having trouble landing in range, include
                  Armor 2.0 legendaries. They can&apos;t be tuned and join no
                  set, but their lower power can help.
                </span>
              </label>
            </div>
          </Step>

          <Step n={4}>
            <div className="flex items-start gap-3">
              <Checkbox
                id={dreamersId}
                checked={dreamersBond}
                onCheckedChange={(checked) =>
                  emit({ ...value, dreamersBond: checked === true })
                }
                className="mt-0.5 cursor-pointer"
              />
              <label htmlFor={dreamersId} className="cursor-pointer space-y-0.5">
                <span className="block text-sm d2:font-medium">
                  Force {dreamersItemName}
                </span>
                <span className="text-muted-foreground block text-xs">
                  If you&apos;re still having trouble, pin the collections
                  class item at power {DREAMERS_BOND_POWER} with no stats. It
                  drags the average down so the other four pieces carry the
                  build.
                </span>
              </label>
            </div>
          </Step>
        </ol>
      )}
    </div>
  );
});

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex list-none gap-3">
      <span
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-power/20 text-[11px] font-medium tabular-nums text-power"
        aria-hidden
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
    </li>
  );
}

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
