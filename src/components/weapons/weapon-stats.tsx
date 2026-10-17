import { cn } from "@/lib/utils";
import {
  WEAPON_STAT_NUMBERS as NUMBERS,
  WEAPON_STAT_ORDER as ORDER,
} from "@/lib/weapons/stat-order";

function rank(name: string) {
  const at = ORDER.indexOf(name);
  if (at >= 0) return at;
  const number = NUMBERS.indexOf(name);
  return number >= 0 ? 100 + number : 50;
}

const clamp = (value: number) => Math.min(Math.max(value, 0), 100);

/** Drawn as the game's recoil arc rather than a bar. */
const RECOIL = "Recoil Direction";

/**
 * Where a Recoil Direction stat sends the gun, in degrees off vertical (right is
 * positive): the community-measured curve, straight up at 95 and 100, swinging
 * further left and right the lower it goes.
 */
function recoilAngle(value: number) {
  return Math.sin((value + 5) * ((2 * Math.PI) / 20)) * (100 - value);
}

/** A point on the arc's rim, `degrees` off vertical, in a 2×1 box centred on (1, 1). */
function rim(degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return `${1 + Math.sin(radians)},${1 - Math.cos(radians)}`;
}

/**
 * The game's recoil indicator: a faint half circle with a white wedge where the
 * gun kicks. The wedge leans with the recoil and widens as the stat drops; 95
 * and 100 are a thin line straight up.
 */
function RecoilArc({ value }: { value: number }) {
  // Scaled down a little, as the in-game arc is, and kept inside the half circle.
  const lean = Math.max(-90, Math.min(90, recoilAngle(value) * 0.8));
  // Wider the further it leans, and the lower the stat even when it points
  // straight up (55 and 95 both do), never thinner than a hairline.
  const spread = Math.max(2, Math.abs(lean) * 0.75, (100 - value) * 0.4);
  const from = Math.max(-90, lean - spread);
  const to = Math.min(90, lean + spread);
  return (
    <svg viewBox="0 0 2 1" className="h-3.5 w-7 shrink-0 self-center" aria-hidden>
      <path d="M0,1 A1,1 0 0,1 2,1 Z" className="fill-foreground/20" />
      <path
        d={`M1,1 L${rim(from)} A1,1 0 0,1 ${rim(to)} Z`}
        className="fill-foreground"
      />
    </svg>
  );
}

/**
 * A weapon's stats, each a bar the full width of its container with the name
 * over its left end and the value over its right. What `stats` adds to `base`
 * shows green, what it takes away red, with the signed change just left of
 * the value, so a perk preview never moves the value itself. Recoil Direction
 * shows the game's arc beside its name instead of a bar.
 */
export function WeaponStats({
  base,
  stats,
}: {
  base: Record<string, number>;
  stats: Record<string, number>;
}) {
  const rows = Object.keys(base).sort((a, b) => rank(a) - rank(b));
  return (
    <dl className="grid gap-y-4 text-[13px]">
      {rows.map((name) => {
        const from = base[name]!;
        const value = stats[name] ?? from;
        const delta = value - from;
        const bar = !NUMBERS.includes(name) && name !== RECOIL;
        const low = clamp(Math.min(value, from));
        const high = clamp(Math.max(value, from));
        return (
          <div key={name} className="grid gap-1">
            <div className="flex items-baseline gap-2">
              <dt className="min-w-0 flex-1 truncate text-muted-foreground">
                {name}
              </dt>
              {name === RECOIL && <RecoilArc value={value} />}
              {delta !== 0 && (
                <dd
                  className={cn(
                    "text-xs tabular-nums",
                    delta > 0 ? "text-positive" : "text-destructive",
                  )}
                >
                  {delta > 0 ? `+${delta}` : `−${-delta}`}
                </dd>
              )}
              <dd
                className={cn(
                  "tabular-nums",
                  delta > 0 && "text-positive",
                  delta < 0 && "text-destructive",
                )}
              >
                {value}
              </dd>
            </div>
            {bar && (
              // The stat in a green that dims left to right, lit across its
              // upper-right half by a sheen cut corner to corner, inside a pale
              // green line; the rest of the track a faint grey. A preview keeps
              // it one bar: a gain stretches the green out to the new value and
              // lightens the stretch it gained, a loss ends the green at the new
              // value and carries on to the old one in red drawn the same way,
              // with no line between them. The Normal theme rounds the bar, so
              // it drops the lines.
              <dd
                aria-hidden
                className="relative h-2 normal:overflow-hidden normal:rounded-full"
              >
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 border border-[color-mix(in_srgb,var(--emphatic-bright)_75%,white)] bg-[linear-gradient(to_top_right,transparent_50%,rgb(255_255_255/0.16)_50%),linear-gradient(to_right,var(--emphatic-bright),var(--emphatic-light))] transition-[width] duration-150 motion-reduce:transition-none normal:rounded-full normal:border-0",
                    delta < 0 && "border-r-0 normal:rounded-r-none",
                    (delta > 0 ? high : low) === 0 && "border-0",
                  )}
                  style={{ width: `${delta > 0 ? high : low}%` }}
                />
                {/* Both always drawn (hidden at rest) so a preview fades in. */}
                <div
                  className={cn(
                    "absolute inset-y-0 bg-white/40 transition-[left,width,opacity] duration-150 motion-reduce:transition-none normal:rounded-r-full",
                    delta <= 0 && "opacity-0",
                  )}
                  style={{ left: `${low}%`, width: `${delta > 0 ? high - low : 0}%` }}
                />
                <div
                  className={cn(
                    "absolute inset-y-0 border border-l-0 border-[color-mix(in_srgb,var(--destructive)_70%,white)] bg-[linear-gradient(to_top_right,transparent_50%,rgb(255_255_255/0.16)_50%),linear-gradient(to_right,var(--destructive),color-mix(in_srgb,var(--destructive)_80%,black))] transition-[left,width,opacity] duration-150 motion-reduce:transition-none normal:rounded-r-full normal:border-0",
                    delta >= 0 && "opacity-0",
                  )}
                  style={{ left: `${low}%`, width: `${delta < 0 ? high - low : 0}%` }}
                />
                <div
                  className="absolute inset-y-0 right-0 bg-foreground/18 transition-[left] duration-150 motion-reduce:transition-none normal:bg-foreground/16"
                  style={{ left: `${high}%` }}
                />
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}
