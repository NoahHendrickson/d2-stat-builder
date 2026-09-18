"use client";

import { useState, type ReactNode } from "react";
import { Plus, TagSimple } from "@phosphor-icons/react";
import { normalizeTag } from "@/lib/loadouts/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

function filterSummary(selected: readonly string[]): string | undefined {
  if (selected.length === 0) return undefined;
  return selected.length === 1 ? `#${selected[0]}` : `${selected.length} tags`;
}

function TagPanel({
  tags,
  selected,
  query,
  onQueryChange,
  onToggle,
  onCreate,
}: {
  tags: readonly string[];
  selected: readonly string[];
  query: string;
  onQueryChange: (query: string) => void;
  onToggle: (tag: string, checked: boolean) => void;
  onCreate?: (tag: string) => void;
}) {
  const draft = normalizeTag(query);
  const needle = (draft ?? query.trim().replace(/^#+/, "").toLowerCase());
  const selectedSet = new Set(selected);
  const catalog = [...new Set([...tags, ...selected])];
  const shown = needle ? catalog.filter((tag) => tag.includes(needle)) : catalog;
  const canCreate = !!onCreate && draft !== null && !catalog.includes(draft);

  const create = () => {
    if (!onCreate || !draft || selectedSet.has(draft)) return;
    onCreate(draft);
    onQueryChange("");
  };

  return (
    <>
      <div
        className="flex items-center gap-1 p-1"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              create();
            }
          }}
          placeholder={onCreate ? "Search or create…" : "Search…"}
          aria-label={onCreate ? "Search or create tags" : "Search tags"}
          className="min-w-0 flex-1 [&::-webkit-search-cancel-button]:hidden"
        />
        {onCreate && (
          <Button
            type="button"
            size="icon"
            variant="dashed"
            disabled={!canCreate}
            aria-label={draft ? `Create tag ${draft}` : "Create tag"}
            onClick={create}
          >
            <Plus weight="bold" aria-hidden />
          </Button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="text-muted-foreground px-1.5 py-2 text-center text-xs">
          {draft && onCreate
            ? `Press + to create #${draft}.`
            : catalog.length === 0
              ? onCreate
                ? "Type a name and press + to create a tag."
                : "No tags yet."
              : "No matches."}
        </p>
      ) : (
        shown.map((tag) => (
          <DropdownMenuCheckboxItem
            key={tag}
            indicator="start"
            closeOnClick={false}
            checked={selectedSet.has(tag)}
            onCheckedChange={(checked) => onToggle(tag, checked === true)}
          >
            #{tag}
          </DropdownMenuCheckboxItem>
        ))
      )}
    </>
  );
}

function TagSubmenu({
  label,
  summary,
  showIcon,
  children,
  onClose,
}: {
  label: string;
  summary?: string;
  showIcon?: boolean;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <DropdownMenuSub
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DropdownMenuSubTrigger openOnHover>
        {showIcon ? <TagSimple weight="duotone" aria-hidden /> : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {summary ? (
          <span className="text-muted-foreground max-w-24 truncate text-xs">
            {summary}
          </span>
        ) : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent side="inline-end" align="start" className="w-64">
        {children}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** Assign / create tags on one loadout from its actions menu. */
export function LoadoutTagAssignSubmenu({
  assigned,
  tags,
  onToggle,
  onCreate,
}: {
  assigned: readonly string[];
  tags: readonly string[];
  onToggle: (tag: string, checked: boolean) => void;
  onCreate: (tag: string) => void;
}) {
  const [query, setQuery] = useState("");
  return (
    <TagSubmenu
      label="Tag"
      summary={filterSummary(assigned)}
      showIcon
      onClose={() => setQuery("")}
    >
      <TagPanel
        tags={tags}
        selected={assigned}
        query={query}
        onQueryChange={setQuery}
        onToggle={onToggle}
        onCreate={onCreate}
      />
    </TagSubmenu>
  );
}

/** Filter the loadouts list by tags that already exist. */
export function LoadoutTagFilterSubmenu({
  tags,
  selected,
  onToggle,
}: {
  tags: readonly string[];
  selected: readonly string[];
  onToggle: (tag: string, checked: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const empty = tags.length === 0 && selected.length === 0;
  return (
    <TagSubmenu
      label="Tag"
      summary={filterSummary(selected)}
      onClose={() => setQuery("")}
    >
      {empty ? (
        <p className="text-muted-foreground px-2 py-2.5 text-sm leading-5">
          No loadouts with tags
        </p>
      ) : (
        <TagPanel
          tags={tags}
          selected={selected}
          query={query}
          onQueryChange={setQuery}
          onToggle={onToggle}
        />
      )}
    </TagSubmenu>
  );
}
