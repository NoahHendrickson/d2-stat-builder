/**
 * Forced interaction states for the playground stage. CSS can't fake `:hover` from
 * script, so every rule that uses one gets a twin keyed to an attribute instead:
 * `.x:hover` → `.x:is([data-force-hover] *)`. Setting `data-force-hover` on the stage
 * then shows every control inside it hovered, group-hover and `:has(:hover)` included.
 * The twins only match under that attribute, so they're inert anywhere else.
 */

export const FORCED_STATES = [
  { id: "hover", label: "Hover", attr: "data-force-hover" },
  { id: "focus", label: "Focus", attr: "data-force-focus" },
  { id: "active", label: "Pressed", attr: "data-force-active" },
] as const;

export type ForcedState = (typeof FORCED_STATES)[number]["id"];

const PSEUDO = /:(hover|focus-visible|focus|active)(?![\w-])/g;

const ATTR_FOR: Record<string, string> = {
  hover: "data-force-hover",
  "focus-visible": "data-force-focus",
  focus: "data-force-focus",
  active: "data-force-active",
};

/** Top-level commas only: `a:is(b, c), d` is two selectors, not three. */
function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** The forced twin of `selector`, or null when no part of it uses a state pseudo-class. */
export function forcedSelector(selector: string): string | null {
  const parts = splitSelectorList(selector).filter((part) => {
    PSEUDO.lastIndex = 0;
    return PSEUDO.test(part);
  });
  if (parts.length === 0) return null;
  return parts
    .map((part) => part.replace(PSEUDO, (_, name: string) => `:is([${ATTR_FOR[name]}] *)`))
    .join(", ");
}

type RuleParent = CSSStyleSheet | CSSGroupingRule;

function twinRules(parent: RuleParent) {
  const rules = parent.cssRules;
  // Backwards, so a twin inserted after rule i never shifts the rules still to visit.
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i];
    if (rule instanceof CSSStyleRule) {
      const twin = forcedSelector(rule.selectorText);
      if (twin) {
        // cssText is `selector { … }`, nested rules and all; swap only the selector.
        const body = rule.cssText.startsWith(rule.selectorText)
          ? rule.cssText.slice(rule.selectorText.length)
          : `{ ${rule.style.cssText} }`;
        try {
          parent.insertRule(`${twin} ${body}`, i + 1);
        } catch {
          // A pseudo-element before the state (`::-webkit-scrollbar-thumb:hover`)
          // has no valid twin; skip it.
        }
      }
    }
    if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules.length > 0) {
      twinRules(rule as CSSGroupingRule);
    }
  }
}

const done = new WeakSet<CSSStyleSheet>();

/**
 * Twins the state rules of every same-origin stylesheet not yet seen. Cheap to call
 * again: a dev reload swaps in a new sheet object, which gets picked up next time.
 */
export function installForcedStates() {
  for (const sheet of Array.from(document.styleSheets)) {
    if (done.has(sheet)) continue;
    try {
      twinRules(sheet);
      done.add(sheet);
    } catch {
      // Cross-origin sheets don't expose cssRules.
      done.add(sheet);
    }
  }
}
