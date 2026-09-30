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
 * A weapon's stats, compact enough to sit beside the perk grid: name and value
 * over a bar. What `stats` adds to `base` shows green, what it takes away
 * red, with the signed change beside the value.
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
    <dl className="grid min-w-44 max-w-56 flex-1 basis-44 gap-4 text-xs">
      {rows.map((name) => {
        const from = base[name]!;
        const value = stats[name] ?? from;
        const delta = value - from;
        return (
          <div key={name}>
            <div className="flex justify-between gap-2">
              <dt className="truncate text-muted-foreground">{name}</dt>
              <dd
                className={cn(
                  "flex shrink-0 gap-1.5 tabular-nums",
                  delta > 0 && "text-positive",
                  delta < 0 && "text-destructive",
                )}
              >
                {delta !== 0 && (
                  <span className="opacity-80">
                    {delta > 0 ? `+${delta}` : `−${-delta}`}
                  </span>
                )}
                <span>{value}</span>
              </dd>
            </div>
            {!NUMBERS.includes(name) && (
              // The optimizer's stat-target bar (ui/slider): a 10px well in a
              // frame of the app's line 3px out, the fill wearing the white
              // line, but filled white rather than green.
              <div
                aria-hidden
                className="relative mx-[3px] mt-2.5 h-2.5 before:pointer-events-none before:absolute before:-inset-[3px] before:d2-line before:content-['']"
              >
                <div
                  className="d2-line-white absolute inset-y-0 left-0 bg-foreground/80"
                  style={{ width: `${clamp(Math.min(value, from))}%` }}
                />
                {value !== from && (
                  <div
                    className={cn(
                      "absolute inset-y-0",
                      value > from ? "bg-positive" : "bg-destructive",
                    )}
                    style={{
                      left: `${clamp(Math.min(value, from))}%`,
                      width: `${clamp(Math.max(value, from)) - clamp(Math.min(value, from))}%`,
                    }}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </dl>
  );
}
