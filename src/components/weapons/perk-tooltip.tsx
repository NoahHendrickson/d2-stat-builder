import type { ReactNode } from "react";
import type {
  ClarityClass,
  ClarityLine,
  ClarityText,
} from "@/lib/weapons/clarity";
import type { PerkRef } from "@/lib/weapons/types";
import { cn } from "@/lib/utils";

const ENHANCED = "font-medium text-exotic-line";

const CLASS_STYLE: Partial<Record<ClarityClass, string>> = {
  bold: "font-medium text-foreground",
  arc: "text-(--subclass-arc)",
  solar: "text-(--subclass-solar)",
  void: "text-(--subclass-void)",
  stasis: "text-(--subclass-stasis)",
  strand: "text-(--subclass-strand)",
  kinetic: "text-foreground",
  primary: "text-foreground",
  special: "text-(--subclass-strand)",
  heavy: "text-(--subclass-void)",
  barrier: "text-rose-300",
  overload: "text-sky-300",
  unstoppable: "text-orange-300",
};

/** Numbers stand out; `(↑ …)` enhanced values and Clarity's `🠚` transitions go gold. */
const HIGHLIGHT = /(\(↑ [^)]+\)|🠚)|([+-]?\d+(?:\.\d+)?(?:%|x|s|ms|HP)?)/g;

function highlight(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(HIGHLIGHT)) {
    if (match.index > at) nodes.push(text.slice(at, match.index));
    nodes.push(
      <span
        key={match.index}
        className={match[1] ? ENHANCED : "font-medium text-foreground"}
      >
        {match[1] === "🠚" ? "→" : match[0]}
      </span>,
    );
    at = match.index + match[0].length;
  }
  if (at < text.length) nodes.push(text.slice(at));
  return nodes;
}

function Run({ part }: { part: ClarityText }) {
  if (part.classNames?.includes("enhancedArrow"))
    return <span className={ENHANCED}>↑</span>;
  if (!part.text) return null;
  // Links can't be followed from a hover tooltip; keep them as plain text.
  return (
    <span className={cn(part.classNames?.map((name) => CLASS_STYLE[name]))}>
      {highlight(part.text)}
    </span>
  );
}

function ClarityLines({ lines }: { lines: ClarityLine[] }) {
  return lines.map((line, i) =>
    line.classNames?.includes("spacer") ? (
      <div key={i} className="h-2" aria-hidden />
    ) : (
      <p
        key={i}
        className={cn(line.classNames?.map((name) => CLASS_STYLE[name]))}
      >
        {line.linesContent?.map((part, j) => (
          <Run key={j} part={part} />
        ))}
      </p>
    ),
  );
}

/** A perk's tooltip body: Bungie's description, then Clarity's community insight. */
export function PerkTooltip({
  perk,
  insight,
}: {
  perk: PerkRef;
  insight: ClarityLine[] | undefined;
}) {
  const enhanced =
    perk.enhancedDescription && perk.enhancedDescription !== perk.description
      ? perk.enhancedDescription
      : undefined;
  return (
    <div className="grid gap-2 whitespace-normal">
      <p className="font-medium text-foreground uppercase tracking-wide">
        {perk.name}
        {!perk.currentlyCanRoll && (
          <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
            Retired
          </span>
        )}
      </p>
      {perk.description && (
        <p className="text-muted-foreground">{perk.description}</p>
      )}
      {enhanced && (
        <p className="text-muted-foreground">
          <span className={ENHANCED}>↑ Enhanced: </span>
          {enhanced}
        </p>
      )}
      {insight && (
        <div className="border-t border-foreground/10 pt-2 text-muted-foreground">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider">
            Community insight from Clarity
          </p>
          <ClarityLines lines={insight} />
        </div>
      )}
    </div>
  );
}
