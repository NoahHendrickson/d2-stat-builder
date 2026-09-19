"use client";

import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { SettingRow } from "@/components/builder/setting-row";
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
 * Underlight settings: the "Power matters" checkbox, with the gear-power range,
 * weapon powers, legacy armor, and Dreamer's Bond nested underneath while it's
 * on. Owns the first-enable policy: turning it on with no bounds yet seeds the
 * top five gear-power levels the candidate armor can reach. The min / max
 * inputs commit on blur or Enter; the slider commits live.
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
  const rootRef = useRef<HTMLDivElement>(null);
  // Follow the open animation only for a click, not a restored already-on state.
  const revealOnExpand = useRef(false);
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
    if (checked) revealOnExpand.current = true;
    emit(next);
  };

  // The nested settings grow downward. At the bottom of the pane that would hide
  // them under the fold, so keep the expanding block in view as it opens — the
  // checkbox slides up, the new rows appear, and we stop once the top hits the
  // scrollport (remaining rows stay a scroll away).
  useLayoutEffect(() => {
    if (!enabled || !revealOnExpand.current) return;
    revealOnExpand.current = false;
    const el = rootRef.current;
    if (!el) return;
    return followExpandInView(el);
  }, [enabled]);

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
    <div ref={rootRef} className="flex flex-col">
      <SettingRow
        checkbox
        checked={enabled}
        onCheckedChange={onToggle}
        title="Power matters"
        description="Only show builds whose gear power lands in a range. Festival of the Lost masks count as power 0, so your masks join the helmet candidates while this is on."
      />

      <div
        className={cn(
          "grid [overflow-anchor:none] transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none",
          enabled ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden" inert={!enabled}>
          <div className="flex flex-col gap-4 pt-4">
            <SettingRow
              title="Set the target light level you want"
              description="Gear power is the game's average over the five armor pieces and the weapons you enter next. Pick the light level you want the build to land in."
            >
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
                  <span className="ml-auto flex items-center gap-1.5">
                    <span className="d2-label text-[10px]">Reach</span>
                    <PowerValue
                      value={`${reach.min}–${reach.max}`}
                      size="xs"
                      tone="gold"
                      className="gap-0.5 text-xs items-center"
                    />
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
            </SettingRow>

            <SettingRow
              title="Choose the weapons you want to use"
              description="Figure out what you want to run, then input their light level. Ideally have at least one 10-power weapon and the others at 300 or below. The lower your weapons, the better stats you'll get — the armor can sit higher."
            >
              <p className="text-muted-foreground text-xs">
                Leave a slot blank to skip it
              </p>
              <div className="grid grid-cols-3 gap-2">
                {WEAPON_SLOTS.map((name, i) => (
                  <label key={name} className="space-y-1">
                    <span className="d2-label block text-[10px]">{name}</span>
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
            </SettingRow>

            <SettingRow
              checkbox
              checked={legacyArmor}
              onCheckedChange={(checked) =>
                emit({ ...value, legacyArmor: checked })
              }
              title="Use legacy armor"
              description="If you're having trouble landing in range, include Armor 2.0 legendaries. They can't be tuned and join no set, but their lower power can help."
            />

            <SettingRow
              checkbox
              checked={dreamersBond}
              onCheckedChange={(checked) =>
                emit({ ...value, dreamersBond: checked })
              }
              title={`Force ${dreamersItemName}`}
              description={`If you're still having trouble, pin the collections class item at power ${DREAMERS_BOND_POWER} with no stats. It drags the average down so the other four pieces carry the build.`}
            />
          </div>
        </div>
      </div>
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

/** Breathing room so the last revealed row isn't flush against the scrollport. */
const EXPAND_INSET = 12;
/** Matches `duration-300` plus a frame so reduced-motion (no transition) still disconnects. */
const EXPAND_FOLLOW_MS = 400;

function nearestScrollPort(el: HTMLElement): HTMLElement | Window {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
      return node;
    }
    node = node.parentElement;
  }
  return window;
}

/**
 * Keep `el` in view while its height animates open: scroll just enough that the
 * growing bottom stays visible, but never so far that the top leaves the port.
 * Driven by rAF because ResizeObserver often skips `grid-template-rows` frames.
 */
function followExpandInView(el: HTMLElement): () => void {
  const port = nearestScrollPort(el);
  let stopped = false;
  let raf = 0;
  const stick = () => {
    const rect = el.getBoundingClientRect();
    const portRect =
      port instanceof Window
        ? { top: 0, bottom: window.innerHeight }
        : port.getBoundingClientRect();
    if (rect.top <= portRect.top) return;
    const overflow = rect.bottom + EXPAND_INSET - portRect.bottom;
    if (overflow <= 0) return;
    const dy = Math.min(overflow, rect.top - portRect.top);
    if (dy <= 0) return;
    if (port instanceof Window) window.scrollBy(0, dy);
    else port.scrollTop += dy;
  };
  const tick = () => {
    if (stopped) return;
    stick();
    raf = requestAnimationFrame(tick);
  };
  // Release the port without touching scrollTop: wheel/touch mean the user has
  // taken over, and scrolling once more here would fight their own input.
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
  };
  // The transition is over: one last correction, then release.
  const finish = () => {
    if (stopped) return;
    stick();
    stop();
  };
  tick();
  port.addEventListener("wheel", stop, { passive: true });
  port.addEventListener("touchstart", stop, { passive: true });
  const done = window.setTimeout(finish, EXPAND_FOLLOW_MS);
  return () => {
    window.clearTimeout(done);
    port.removeEventListener("wheel", stop);
    port.removeEventListener("touchstart", stop);
    stop();
  };
}
