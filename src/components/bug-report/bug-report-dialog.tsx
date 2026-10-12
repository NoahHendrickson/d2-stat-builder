"use client";

import { useId, useState, useSyncExternalStore, type FormEvent } from "react";
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

// Whether the dialog is open lives here, not in the button: the sidebar that holds the
// button comes and goes (the mobile menu drawer, the desktop breakpoint), and the one
// dialog AppShell mounts has to outlive it.
let isOpen = false;
const listeners = new Set<() => void>();

function setOpen(open: boolean) {
  if (open === isOpen) return;
  isOpen = open;
  for (const listener of listeners) listener();
}

/** Open the "Report a bug" dialog. */
export const openBugReport = () => setOpen(true);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type Draft = { title: string; description: string };
const EMPTY: Draft = { title: "", description: "" };

/**
 * "Report a bug": a title and what happened. The page, window size and browser go
 * along with it. The draft and a send in flight outlive closing the dialog: the draft
 * clears once the report is sent, and a failure that lands while it's closed is a toast.
 */
export function BugReportDialog() {
  const open = useSyncExternalStore(subscribe, () => isOpen, () => false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/bug-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, context: readBugReportContext() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Couldn't send the report — try again");
      }
      setDraft(EMPTY);
      setOpen(false);
      toast.success("Thanks, your report was sent", "We'll take a look.");
    } catch (err) {
      const message =
        err instanceof TypeError
          ? "Couldn't reach the server — check your connection"
          : err instanceof Error
            ? err.message
            : "Couldn't send the report — try again";
      if (isOpen) setError(message);
      else toast.error("Your bug report wasn't sent", message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        {open && (
          <BugReportForm
            draft={draft}
            onDraftChange={setDraft}
            sending={sending}
            error={error}
            onCancel={() => setOpen(false)}
            onSend={send}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BugReportForm({
  draft,
  onDraftChange,
  sending,
  error,
  onCancel,
  onSend,
}: {
  draft: Draft;
  onDraftChange: (draft: Draft) => void;
  sending: boolean;
  error: string | null;
  onCancel: () => void;
  onSend: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const ready = draft.title.trim().length > 0 && draft.description.trim().length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) onSend();
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
          readOnly={sending}
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
          readOnly={sending}
          maxLength={MAX_DESCRIPTION_LENGTH}
          placeholder="What you did, what you expected, and what happened instead."
          className="max-h-[40vh] min-h-28"
          aria-describedby={error ? errorId : undefined}
        />
      </div>

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
