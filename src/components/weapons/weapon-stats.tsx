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

/**
 * A weapon's stats as the game's inspect screen lists them: name, value and
 * bar on one line. What `stats` adds to `base` shows green, what it takes
 * away red, with the signed change in a column of its own past the bar so a
 * perk preview never shifts the rows.
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
    <dl className="grid min-w-64 max-w-sm flex-1 basis-72 grid-cols-[auto_1.75rem_minmax(0,1fr)_1.75rem] items-center gap-x-2.5 gap-y-2 text-[13px]">
      {rows.map((name) => {
        const from = base[name]!;
        const value = stats[name] ?? from;
        const delta = value - from;
        const bar = !NUMBERS.includes(name);
        const low = clamp(Math.min(value, from));
        const high = clamp(Math.max(value, from));
        return (
          <div key={name} className="contents">
            <dt className="text-right text-muted-foreground">{name}</dt>
            <dd
              className={cn(
                "text-right tabular-nums",
                delta > 0 && "text-positive",
                delta < 0 && "text-destructive",
              )}
            >
              {value}
            </dd>
            <dd aria-hidden className="min-w-0">
              {bar && (
                // A solid green fill on a faint, outlined track (the Normal
                // theme's own green there). A preview's change continues the
                // fill as its own piece: light for a gain (green would vanish
                // against the fill), red for a loss.
                <div className="relative h-2.5 border border-foreground/50 bg-foreground/18 normal:h-2 normal:overflow-hidden normal:rounded-full normal:bg-foreground/16">
                  <div
                    className="absolute inset-y-0 left-0 bg-(--emphatic-bright) transition-[width] duration-150 motion-reduce:transition-none normal:rounded-full normal:bg-(--normal-green)"
                    style={{ width: `${low}%` }}
                  />
                  {/* Always drawn (hidden at rest) so a preview slides in. */}
                  <div
                    className={cn(
                      "absolute inset-y-0 transition-[left,width] duration-150 motion-reduce:transition-none normal:rounded-full",
                      delta > 0 ? "bg-foreground/55" : "bg-destructive",
                      delta === 0 && "opacity-0",
                    )}
                    style={{ left: `${low}%`, width: `${high - low}%` }}
                  />
                </div>
              )}
            </dd>
            <dd
              className={cn(
                "text-xs tabular-nums",
                delta > 0 ? "text-positive" : "text-destructive",
              )}
            >
              {delta !== 0 && (delta > 0 ? `+${delta}` : `−${-delta}`)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
