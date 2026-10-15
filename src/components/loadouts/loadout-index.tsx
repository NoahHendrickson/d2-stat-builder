"use client";

import { memo, useEffect, useRef } from "react";
import type { SavedLoadout } from "@/lib/loadouts/types";
import { cn } from "@/lib/utils";

/**
 * The loadouts page's name column: every shown loadout by name, in list order. A click
 * scrolls the card list to that loadout; the one at the top of the list is filled.
 *
 * Memoized: the list re-renders on every scroll frame, this only when the shown
 * loadouts or the current one change.
 */
export const LoadoutIndex = memo(function LoadoutIndex({
  loadouts,
  activeId,
  onJump,
  className,
}: {
  loadouts: readonly SavedLoadout[];
  /** The loadout the card list is showing at its top. */
  activeId: string | undefined;
  onJump: (index: number) => void;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the current name in view as the cards scroll past. Only this column moves
  // (scrollIntoView would also scroll the page).
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !activeId) return;
    const el = scroller.querySelector<HTMLElement>(`[data-loadout-id="${CSS.escape(activeId)}"]`);
    if (!el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (bottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = bottom - scroller.clientHeight;
    }
  }, [activeId]);

  return (
    <nav aria-label="Loadouts by name" className={cn("min-h-0 flex-col", className)}>
      <div ref={scrollRef} className="d2-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ul className="flex flex-col">
          {loadouts.map((saved, index) => {
            const active = saved.id === activeId;
            return (
              <li key={saved.id}>
                <button
                  type="button"
                  data-loadout-id={saved.id}
                  aria-current={active ? "true" : undefined}
                  onClick={() => onJump(index)}
                  title={saved.loadout.name}
                  className={cn(
                    "normal:rounded-[8px] focus-visible:ring-outline-strong flex h-8 w-full items-center px-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-1",
                    active
                      ? "bg-foreground/8 normal:bg-foreground/6 text-foreground"
                      : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{saved.loadout.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
});
