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
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  readBugReportContext,
} from "@/lib/bug-reports/bug-report";
import { toast } from "@/lib/toast";

type Draft = { title: string; description: string };
const EMPTY: Draft = { title: "", description: "" };

/**
 * "Report a bug": a title and what happened. The page, window size and browser go
 * along with it. The draft outlives closing the dialog, so a stray click loses nothing;
 * it clears once the report is sent.
 */
export function BugReportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <BugReportForm
            draft={draft}
            onDraftChange={setDraft}
            onCancel={() => onOpenChange(false)}
            onSent={() => {
              setDraft(EMPTY);
              onOpenChange(false);
              toast.success("Thanks, your report was sent", "We'll take a look.");
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BugReportForm({
  draft,
  onDraftChange,
  onCancel,
  onSent,
}: {
  draft: Draft;
  onDraftChange: (draft: Draft) => void;
  onCancel: () => void;
  onSent: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = draft.title.trim().length > 0 && draft.description.trim().length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/bug-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, website, context: readBugReportContext() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Couldn't send the report — try again");
      }
      onSent();
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "Couldn't reach the server — check your connection"
          : err instanceof Error
            ? err.message
            : "Couldn't send the report — try again",
      );
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Report a bug</DialogTitle>
        <DialogDescription>
          Tell us what went wrong. The page you&rsquo;re on and your browser are sent with it.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <label htmlFor={titleId} className="text-sm font-medium">
          Title
        </label>
        <Input
          id={titleId}
          value={draft.title}
          onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
          maxLength={MAX_TITLE_LENGTH}
          placeholder="Equip skips my helmet"
          autoComplete="off"
          autoFocus
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={descriptionId} className="text-sm font-medium">
          What happened?
        </label>
        <Textarea
          id={descriptionId}
          value={draft.description}
          onChange={(e) => onDraftChange({ ...draft, description: e.target.value })}
          maxLength={MAX_DESCRIPTION_LENGTH}
          placeholder="What you did, what you expected, and what happened instead."
          className="max-h-[40vh] min-h-28"
          aria-describedby={error ? errorId : undefined}
        />
      </div>

      {/* Hidden from people and screen readers; see decodeBugReport. */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="absolute -left-[9999px] size-px opacity-0"
      />

      {error && (
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready || sending}>
          {sending ? "Sending…" : "Send report"}
        </Button>
      </DialogFooter>
    </form>
  );
}
