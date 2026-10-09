"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  HelpCircleIcon,
  MoreHorizontalIcon,
  Search01Icon,
  SquareLock02Icon,
  SquareUnlock02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useProfile } from "@/lib/armory/use-profile";
import {
  ITEM_TAGS,
  TAG_LABELS,
  annotationsStore,
  setTag,
  type ItemTag,
} from "@/lib/inventory/annotations";
import type { InventoryItem, ManagerInventory } from "@/lib/inventory/build";
import { characterName, type Landing, type Place } from "@/lib/inventory/moves";
import { NO_PERKS, createPerkLookup } from "@/lib/inventory/perk-index";
import { dupeHashes, forEachItem, matchItems, parseSearch } from "@/lib/inventory/search";
import { applySuggestion, suggestSearch, vocabList, type SearchVocab, type Suggestion } from "@/lib/inventory/search-suggest";
import { useManifest } from "@/lib/manifest/use-manifest";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useStoreValue } from "@/lib/value-store";
import { useManagerActions } from "./manager-context";
import { moveAll } from "./move-all";
import { SearchResultsDrawer } from "./search-results-drawer";
import { searchMatches } from "./search-store";
import { TAG_ICONS } from "./tag-icons";
import { ViewMenu } from "./view-menu";

/**
 * Text that combines terms with grouping or `or`: a picked filter stays inline there,
 * since lifting it out into a chip (always ANDed) would change what the query means.
 */
const COMPOUND = /[()]|(^|\s)(or|and|not)(\s|$)/i;

/** A chip's label: the key muted, the value without its quotes. */
function ChipLabel({ term }: { term: string }) {
  const colon = term.indexOf(":");
  if (colon < 0) return <span className="truncate">{term}</span>;
  return (
    <span className="truncate">
      <span className="text-muted-foreground">{term.slice(0, colon + 1)}</span>
      {term.slice(colon + 1).replaceAll('"', "")}
    </span>
  );
}

/** Runs `f` the first time it's asked, then hands back the same answer. */
function once<T>(f: () => T): () => T {
  let value: { v: T } | undefined;
  return () => (value ??= { v: f() }).v;
}

/**
 * The manager's search box (DIM's query language, see lib/inventory/search.ts): items
 * it doesn't match are dimmed, and the menu beside it tags, locks, or moves every match.
 * Typing suggests completions for the term at the caret (Tab or Enter takes one); a
 * picked filter becomes a chip before the text, and the chips and text search together.
 * The match count opens every match in a drawer.
 */
export function ManagerSearch({ inventory }: { inventory: ManagerInventory }) {
  /** What's typed in the field (the chips aren't part of it). */
  const [query, setQuery] = useState("");
  /** Filters picked from the suggestions, each a whole term (`is:handcannon`). */
  const [chips, setChips] = useState<string[]>([]);
  const fullQuery = [...chips, query.trim()].filter(Boolean).join(" ");
  const deferred = useDeferredValue(fullQuery);
  const parsed = useMemo(() => parseSearch(deferred), [deferred]);
  const annotations = useStoreValue(annotationsStore);
  const { query: profile } = useProfile();
  const manifestStatus = useManifest();
  const manifest = manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;
  const perks = useMemo(
    () => (profile.data && manifest ? createPerkLookup(profile.data, manifest) : NO_PERKS),
    [profile.data, manifest],
  );
  const dupes = useMemo(() => dupeHashes(inventory), [inventory]);
  const matches = useMemo(
    () =>
      parsed?.ok
        ? matchItems(inventory, parsed.predicate, { annotations, ...perks, dupes })
        : null,
    [inventory, parsed, annotations, perks, dupes],
  );

  useEffect(() => {
    searchMatches.set(matches);
  }, [matches]);
  useEffect(() => () => searchMatches.set(null), []);

  const error = parsed && !parsed.ok ? parsed.error : undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const [showResults, setShowResults] = useState(false);
  // Clearing the search closes the drawer for good, not until the next search.
  if (showResults && !matches) setShowResults(false);

  // What the account holds, for suggestions; perk names are read only once asked for.
  const vocab = useMemo<SearchVocab>(() => {
    const all: InventoryItem[] = [];
    forEachItem(inventory, (item) => all.push(item));
    const instanced = once(() => all.filter((i) => i.instanceId));
    return {
      types: once(() => vocabList(instanced().map((i) => i.typeName).filter(Boolean))),
      names: once(() => vocabList(all.map((i) => i.name))),
      stats: once(() => vocabList(all.flatMap((i) => Object.keys(i.stats ?? {})).filter((s) => s !== "total"))),
      perks: once(() => vocabList(instanced().flatMap((i) => perks.perks(i)))),
      origins: once(() => vocabList(instanced().flatMap((i) => perks.origins(i)))),
    };
  }, [inventory, perks]);

  const listId = useId();
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(0);
  const suggestions = useMemo(
    () => (open ? suggestSearch(query, caret, vocab) : undefined),
    [open, query, caret, vocab],
  );
  const options = suggestions?.items;
  const [active, setActive] = useState(0);
  // The top row is what Tab and Enter take, so reset to it whenever the list changes.
  const [activeFor, setActiveFor] = useState(options);
  if (activeFor !== options) {
    setActiveFor(options);
    setActive(0);
  }
  // The highlighted suggestion, ghosted after the text when the caret is at its end: the
  // rest of it when it carries on from what's typed, otherwise the whole term after an
  // arrow. Tab (or →) takes it.
  const ghostOf = options?.[active];
  let ghost: string | undefined;
  if (suggestions && ghostOf && caret === query.length && suggestions.end === query.length) {
    const typed = query.slice(suggestions.start);
    ghost = ghostOf.text.toLowerCase().startsWith(typed.toLowerCase())
      ? ghostOf.text.slice(typed.length)
      : `  → ${ghostOf.text}`;
  }

  const moveCaret = (at: number) => {
    setCaret(at);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(at, at));
  };

  const accept = (option: Suggestion) => {
    if (!suggestions) return;
    const before = query.slice(0, suggestions.start);
    const after = query.slice(suggestions.end);
    // A finished filter becomes a chip; a key (`perk:`) still wants its value typed.
    if (!option.text.endsWith(":") && !COMPOUND.test(before + after)) {
      if (!chips.includes(option.text)) setChips([...chips, option.text]);
      setQuery(before + after.trimStart());
      moveCaret(before.length);
      return;
    }
    const next = applySuggestion(query, suggestions, option.text);
    setQuery(next.query);
    moveCaret(next.caret);
  };

  const removeChip = (chip: string) => {
    setChips(chips.filter((c) => c !== chip));
    inputRef.current?.focus();
  };

  const clearAll = () => {
    setChips([]);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const option = options?.[active];
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        if (!options) break;
        e.preventDefault();
        setActive((i) => (e.key === "ArrowDown" ? Math.min(i + 1, options.length - 1) : Math.max(i - 1, 0)));
        break;
      case "Tab":
      case "Enter":
        if (!option || e.shiftKey) break;
        e.preventDefault();
        accept(option);
        break;
      case "ArrowRight":
        // At the end of the text, → takes the ghosted suggestion (like a shell's).
        if (!option || !ghost || e.currentTarget.selectionEnd !== query.length) break;
        e.preventDefault();
        accept(option);
        break;
      case "Escape":
        // One layer at a time: suggestions, then the text, then the chips.
        if (options) setOpen(false);
        else if (query) setQuery("");
        else setChips([]);
        break;
      case "Backspace": {
        // At the start of the field, take back the last chip.
        const { selectionStart, selectionEnd } = e.currentTarget;
        if (selectionStart !== 0 || selectionEnd !== 0 || chips.length === 0) break;
        e.preventDefault();
        setChips(chips.slice(0, -1));
        break;
      }
    }
  };

  // Global "F" focuses search (ignored while typing in any field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "f" && e.key !== "F") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A full-bleed header band (the page's padding cancelled on the top and sides): a
  // click anywhere on it that isn't a control lands in the input.
  return (
    <div
      className="flex min-h-14 shrink-0 cursor-text items-center gap-2 border-b border-foreground/15 bg-foreground/10 px-4 transition-colors hover:bg-foreground/12 focus-within:border-foreground/35 focus-within:bg-foreground/12 lg:px-6"
      onMouseDown={(e) => {
        // contains() skips clicks bubbling up (through React) from portalled popovers.
        const target = e.target as HTMLElement;
        if (!e.currentTarget.contains(target) || target.closest("button, input")) return;
        e.preventDefault();
        inputRef.current?.focus();
      }}
    >
      <HugeiconsIcon icon={Search01Icon} className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <div className="peer relative flex min-w-24 flex-1 flex-wrap items-center gap-x-1.5 self-stretch">
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => removeChip(chip)}
            aria-label={`Remove filter ${chip}`}
            className="flex h-7 max-w-full shrink-0 cursor-pointer items-center gap-1.5 bg-foreground/15 px-2.5 font-mono text-[13px] outline-none transition-colors hover:bg-foreground/22 focus-visible:ring-1 focus-visible:ring-outline-strong rounded-full"
          >
            <ChipLabel term={chip} />
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="text-muted-foreground size-3 shrink-0" aria-hidden />
          </button>
        ))}
        <div className="relative flex min-w-24 flex-1 self-stretch">
          {ghost && (
            // Mirrors the typed text invisibly so the ghost starts where the text ends.
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center overflow-hidden text-base whitespace-pre"
            >
              <span className="invisible">{query}</span>
              <span className="text-muted-foreground/70">{ghost}</span>
              <kbd className="text-muted-foreground border-foreground/20 ml-2 flex h-5 shrink-0 items-center border px-1 font-sans text-[11px]">
                Tab
              </kbd>
            </span>
          )}
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
              setOpen(true);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={onKeyDown}
            onBlur={() => setOpen(false)}
            placeholder={chips.length ? "Add a filter or search" : "Find items"}
            aria-label="Search items"
            aria-keyshortcuts="F"
            aria-expanded={options !== undefined}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={options?.[active] ? `${listId}-${active}` : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "manager-search-error" : undefined}
            autoComplete="off"
            spellCheck={false}
            className="placeholder:text-muted-foreground relative h-14 w-full bg-transparent text-base outline-none [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        {options && (
          <div
            id={listId}
            role="listbox"
            aria-label="Search suggestions"
            className="d2-glass normal:rounded-[10px] absolute top-full left-0 z-50 mt-1 flex w-[min(26rem,calc(100vw-2rem))] cursor-default flex-col p-1 text-sm"
            // Keep focus (and the caret) in the input while clicking rows.
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.map((option, i) => (
              <div
                key={option.text}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => accept(option)}
                className={cn(
                  "normal:rounded-[8px] flex cursor-pointer items-center gap-3 px-2 py-1.5",
                  i === active && "bg-foreground/10",
                )}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{option.text}</span>
                <span className="text-muted-foreground shrink-0 text-xs">{option.hint}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {fullQuery.length === 0 && (
        <kbd
          aria-hidden
          className="text-muted-foreground border-foreground/20 flex h-5 min-w-5 shrink-0 items-center justify-center border px-1 font-sans text-xs peer-focus-within:hidden"
        >
          F
        </kbd>
      )}
      {(query.length > 0 || chips.length > 0) && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clearAll}
          className="text-muted-foreground hover:text-foreground flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-none normal:rounded-[6px] outline-none focus-visible:ring-1 focus-visible:ring-outline-strong"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" aria-hidden />
        </button>
      )}
      <span id="manager-search-error" className="flex min-w-0 text-sm tabular-nums" aria-live="polite">
        {error ? (
          <span className="text-destructive truncate">{error}</span>
        ) : matches ? (
          <TooltipLabel label="Show them all">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={showResults}
              onClick={() => setShowResults((s) => !s)}
              className="text-muted-foreground hover:text-foreground aria-expanded:text-foreground normal:rounded-[6px] cursor-pointer truncate px-1 underline decoration-foreground/30 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-1 focus-visible:ring-outline-strong"
            >
              {matches.size.toLocaleString()} {matches.size === 1 ? "item" : "items"}
            </button>
          </TooltipLabel>
        ) : null}
      </span>
      {matches && matches.size > 0 && <BulkActions inventory={inventory} matches={matches} />}
      <SearchHelp />
      <ViewMenu />
      <SearchResultsDrawer
        inventory={inventory}
        query={deferred}
        matches={matches}
        open={showResults}
        onClose={() => setShowResults(false)}
      />
    </div>
  );
}

const HELP: [string, string][] = [
  ["fatebringer", "Name, type, or perk contains it"],
  ["stasis  hunter  smg", "Keywords work without is: too"],
  ["is:weapon  is:armor  is:exotic", "Kind and rarity"],
  ["is:crafted  is:craftable  is:deepsight", "Item state"],
  ["is:locked  is:dupe  is:equipped  is:invault", "Lock, duplicates, where it is"],
  ["tag:junk  tag:none  is:tagged", "Your tags"],
  ["is:solar  is:dark  is:heavy  is:overload", "Element, ammo, champion"],
  ["is:handcannon  is:lfr  is:adept", "Weapon type, adept"],
  ["is:hunter  is:helmet  is:powerslot", "Class and slot"],
  ["power:>=400  tier:5", "Power and gear tier"],
  ["stat:total:>=60  stat:range:>50", "Any stat by name"],
  ['perk:"kill clip"  exactperk:"kill clip"', "Perks"],
  ['origin:"veist stinger"', "Origin trait"],
  ["a or b   -is:exotic   (a or b) c", "Combine, negate, group"],
];

function SearchHelp() {
  return (
    <Popover>
      <TooltipLabel label="Search help">
        <PopoverTrigger
          aria-label="Search help"
          className="text-muted-foreground hover:text-foreground data-[popup-open]:text-foreground flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-none normal:rounded-[10px] outline-none focus-visible:ring-1 focus-visible:ring-outline-strong"
        >
          <HugeiconsIcon icon={HelpCircleIcon} className="size-4" aria-hidden />
        </PopoverTrigger>
      </TooltipLabel>
      <PopoverContent align="end" className="w-[28rem] gap-2 p-3 text-xs">
        <p className="d2-label">Search</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {HELP.map(([example, meaning]) => (
            <div key={example} className="contents">
              <dt className="font-mono whitespace-pre">{example}</dt>
              <dd className="text-muted-foreground">{meaning}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

/** Tag, lock, or move every item the search matches. */
function BulkActions({ inventory, matches }: { inventory: ManagerInventory; matches: ReadonlySet<string> }) {
  const actions = useManagerActions();
  const found = useMemo(() => {
    const out: { item: InventoryItem; place: Place }[] = [];
    forEachItem(inventory, (item, place) => {
      if (matches.has(item.key)) out.push({ item, place });
    });
    return out;
  }, [inventory, matches]);
  const instanced = found.filter((f) => f.item.instanceId);
  const ids = instanced.map((f) => f.item.instanceId!);
  const plural = (n: number) => `${n.toLocaleString()} ${n === 1 ? "item" : "items"}`;
  const count = plural(found.length);

  const moveMatches = (to: Landing) => {
    if (actions) moveAll(actions, found.map((f) => f.item), to);
  };

  const tag = (t: ItemTag | undefined) => {
    setTag(ids, t);
    toast.success(t ? `Tagged ${ids.length} as ${TAG_LABELS[t]}` : `Cleared tags on ${ids.length}`);
  };

  return (
    <DropdownMenu>
      <TooltipLabel label={`Act on ${count}`}>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />} aria-label={`Act on ${count}`}>
          <HugeiconsIcon icon={MoreHorizontalIcon} aria-hidden />
        </DropdownMenuTrigger>
      </TooltipLabel>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{count}</DropdownMenuLabel>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={ids.length === 0}>Tag as</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              {ITEM_TAGS.map((t) => (
                <DropdownMenuItem key={t} onClick={() => tag(t)}>
                  <HugeiconsIcon icon={TAG_ICONS[t]} aria-hidden />
                  {TAG_LABELS[t]}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => tag(undefined)}>
                <HugeiconsIcon icon={Cancel01Icon} aria-hidden />
                Clear tag
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            disabled={instanced.length === 0}
            onClick={() => actions?.lock(instanced.map((f) => f.item), true)}
          >
            <HugeiconsIcon icon={SquareLock02Icon} aria-hidden />
            Lock
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={instanced.length === 0}
            onClick={() => actions?.lock(instanced.map((f) => f.item), false)}
          >
            <HugeiconsIcon icon={SquareUnlock02Icon} aria-hidden />
            Unlock
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          {inventory.characters.map((c) => (
            <DropdownMenuItem key={c.id} onClick={() => moveMatches({ kind: "character", characterId: c.id })}>
              {characterName(c)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => moveMatches({ kind: "vault" })}>Vault</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
