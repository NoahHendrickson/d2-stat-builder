"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  defaultLinkName,
  MAX_LINK_NAME_LENGTH,
  normalizeLinkUrl,
  type SavedLink,
} from "@/lib/links/links";

/** Add a link, or edit `link` when given. */
export function LinkDialog({
  open,
  onOpenChange,
  link,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  link?: SavedLink;
  onSubmit: (values: Omit<SavedLink, "id">) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Keyed so each open starts from the link's values, not the last edit. */}
        {open && (
          <LinkForm
            key={link?.id ?? "new"}
            link={link}
            onCancel={() => onOpenChange(false)}
            onSubmit={(values) => {
              onSubmit(values);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LinkForm({
  link,
  onCancel,
  onSubmit,
}: {
  link?: SavedLink;
  onCancel: () => void;
  onSubmit: (values: Omit<SavedLink, "id">) => void;
}) {
  const nameId = useId();
  const urlId = useId();
  const errorId = useId();
  const [name, setName] = useState(link?.name ?? "");
  const [url, setUrl] = useState(link?.url ?? "");
  const [showError, setShowError] = useState(false);
  const normalized = normalizeLinkUrl(url);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!normalized) {
      setShowError(true);
      return;
    }
    onSubmit({
      url: normalized,
      name: name.trim().slice(0, MAX_LINK_NAME_LENGTH) || defaultLinkName(normalized),
    });
  };

  const invalid = showError && !normalized;

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{link ? "Edit link" : "Add a link"}</DialogTitle>
        <DialogDescription>
          A spreadsheet or site you keep coming back to. It opens in a new tab.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <label htmlFor={urlId} className="text-sm font-medium">
          URL
        </label>
        <Input
          id={urlId}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => setShowError(url.trim().length > 0)}
          placeholder="docs.google.com/spreadsheets/…"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          autoFocus={!link}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
        />
        {invalid && (
          <p id={errorId} className="text-destructive text-xs">
            Enter a web address, like docs.google.com/spreadsheets/…
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={nameId} className="text-sm font-medium">
          Name
        </label>
        <Input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_LINK_NAME_LENGTH}
          placeholder={normalized ? defaultLinkName(normalized) : "Raid builds"}
          autoComplete="off"
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{link ? "Save" : "Add link"}</Button>
      </DialogFooter>
    </form>
  );
}
