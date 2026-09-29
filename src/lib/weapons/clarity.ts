/**
 * Community perk insights from the Clarity database (the same feed DIM shows
 * under "Community Insight"): exact numbers, durations and quirks that Bungie's
 * tooltip text leaves out. Keyed by plug hash, so base and enhanced tiers are
 * separate entries.
 */

export const CLARITY_URL =
  "https://database-clarity.github.io/Live-Clarity-Database/descriptions/dim.json";

/** Styling tokens Clarity attaches to a line or a run of text. */
export type ClarityClass =
  | "bold"
  | "spacer"
  | "enhancedArrow"
  | "arc"
  | "solar"
  | "void"
  | "stasis"
  | "strand"
  | "kinetic"
  | "primary"
  | "special"
  | "heavy"
  | "barrier"
  | "overload"
  | "unstoppable"
  | "hunter"
  | "titan"
  | "warlock";

export interface ClarityText {
  text?: string;
  classNames?: ClarityClass[];
  link?: string;
}

export interface ClarityLine {
  linesContent?: ClarityText[];
  classNames?: ClarityClass[];
}

export interface ClarityPerk {
  hash: number;
  name: string;
  descriptions?: { en?: ClarityLine[] };
}

export type ClarityMap = Record<string, ClarityPerk>;

const NUMBER = /\d+(?:\.\d+)?%?/g;
/** Enhanced-tier lines that only restate a bump the merged numbers already show. */
const REDUNDANT_ENHANCED = /increased by a further|Buff Duration is increased/i;

function isSpacer(line: ClarityLine | undefined): boolean {
  return line?.classNames?.includes("spacer") ?? false;
}

export function lineText(line: ClarityLine): string {
  return line.linesContent?.map((part) => part.text ?? "").join("") ?? "";
}

/** `25% for 5 seconds` + `25% for 5.5 seconds` → `25% for 5 (↑ 5.5) seconds`. */
export function mergeLineNumbers(base: string, enhanced: string): string {
  const baseNumbers = [...base.matchAll(NUMBER)];
  const enhancedNumbers = [...enhanced.matchAll(NUMBER)];
  if (!baseNumbers.length || baseNumbers.length !== enhancedNumbers.length)
    return base;

  let result = base;
  for (let i = baseNumbers.length - 1; i >= 0; i--) {
    const from = baseNumbers[i];
    const to = enhancedNumbers[i][0];
    if (from[0] === to) continue;
    const at = from.index;
    result = `${result.slice(0, at)}${from[0]} (↑ ${to})${result.slice(at + from[0].length)}`;
  }
  return result;
}

/** Drop the ▲/↑ prefixes Clarity puts on enhanced-only lines (an enhancedArrow part replaces them). */
function stripArrowText(lines: ClarityLine[]): ClarityLine[] {
  return lines.flatMap((line) => {
    if (isSpacer(line)) return [line];
    const parts = (line.linesContent ?? [])
      .map((part) =>
        part.classNames?.includes("enhancedArrow")
          ? part
          : { ...part, text: part.text?.replace(/^[\s▲↑]+/, "") },
      )
      .filter(
        (part) => part.classNames?.includes("enhancedArrow") || part.text,
      );
    return parts.length ? [{ ...line, linesContent: parts }] : [];
  });
}

/**
 * Base and enhanced insight as one block: paired lines show the enhanced value
 * inline as `(↑ …)`, lines only the enhanced tier has keep their arrow.
 */
function mergeTiers(
  base: ClarityLine[],
  enhanced: ClarityLine[],
): ClarityLine[] {
  const extra = enhanced.filter(
    (line) => !REDUNDANT_ENHANCED.test(lineText(line)),
  );
  const result: ClarityLine[] = [];
  let b = 0;
  let e = 0;
  while (b < base.length || e < extra.length) {
    const baseLine = base[b];
    const enhancedLine = extra[e];
    if (baseLine && isSpacer(baseLine)) {
      result.push(baseLine);
      b++;
      if (isSpacer(enhancedLine)) e++;
    } else if (!baseLine) {
      result.push(...stripArrowText([enhancedLine]));
      e++;
    } else if (!enhancedLine) {
      result.push(baseLine);
      b++;
    } else {
      const merged = mergeLineNumbers(
        lineText(baseLine),
        lineText(enhancedLine),
      );
      result.push(
        merged === lineText(baseLine)
          ? baseLine
          : {
              classNames: baseLine.classNames,
              linesContent: [
                {
                  text: merged,
                  classNames: baseLine.linesContent?.[0]?.classNames,
                },
              ],
            },
      );
      b++;
      e++;
    }
  }
  return result;
}

/** The insight lines to show for a perk, or undefined when Clarity has none. */
export function clarityLines(
  map: ClarityMap | undefined,
  perk: { hash: number; alternateHashes?: number[] },
): ClarityLine[] | undefined {
  if (!map) return undefined;
  const base = map[perk.hash]?.descriptions?.en;
  const enhancedHash = perk.alternateHashes?.[0];
  const enhanced =
    enhancedHash == null ? undefined : map[enhancedHash]?.descriptions?.en;
  const single = base ?? enhanced;
  const lines =
    base?.length && enhanced?.length
      ? mergeTiers(base, enhanced)
      : stripArrowText(single ?? []);
  // Dropping redundant enhanced lines can strand a spacer at either end.
  while (isSpacer(lines.at(-1))) lines.pop();
  while (isSpacer(lines[0])) lines.shift();
  return lines.length ? lines : undefined;
}
