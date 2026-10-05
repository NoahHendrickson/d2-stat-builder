import type { ApplyStreamEvent, PlugRequest } from "@/lib/bungie/equip-server";

/** "skipped": never ran because the apply was cancelled. */
export type ApplyStepStatus = "pending" | "active" | "ok" | "fail" | "skipped";

export interface ApplyStep {
  id: string;
  name: string;
  icon?: string;
  watermark?: string;
  gearTier?: number;
  masterworked?: boolean;
  status: ApplyStepStatus;
  message?: string;
}

export interface ApplyProgressState {
  session: number;
  name: string;
  /** Set when the apply is one step of a longer run (an activity set): "Raid · 2 of 5". */
  batch?: string;
  steps: ApplyStep[];
  skipped: string[];
  finished?: "ok" | "partial" | "fail" | "cancelled";
  /** The apply can be stopped (it registered a cancel handler). */
  cancellable?: boolean;
  /** Cancel was pressed; waiting for the server to stop. */
  cancelling?: boolean;
}

export function itemStepId(instanceId: string) {
  return `item:${instanceId}`;
}

export function plugStepId(plug: Pick<PlugRequest, "itemInstanceId" | "socketIndex" | "plugItemHash">) {
  return `plug:${plug.itemInstanceId}:${plug.socketIndex}:${plug.plugItemHash}`;
}

function patchStep(steps: ApplyStep[], id: string, patch: Partial<ApplyStep>): ApplyStep[] {
  return steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

/** Apply one stream event to the step list. Unknown events leave the list unchanged. */
export function applyStreamEvent(steps: ApplyStep[], event: ApplyStreamEvent): ApplyStep[] {
  switch (event.type) {
    case "item-start":
      return patchStep(steps, itemStepId(event.itemInstanceId), { status: "active" });
    case "item":
      return patchStep(steps, itemStepId(event.result.itemInstanceId), {
        status: event.result.ok ? "ok" : "fail",
        message: event.result.message,
      });
    case "plug-start":
      return patchStep(steps, plugStepId(event.plug), { status: "active" });
    case "plug":
      return patchStep(steps, plugStepId(event.result), {
        status: event.result.ok ? "ok" : "fail",
        message: event.result.message,
      });
    case "cancelled":
      return steps.map((s) =>
        s.status === "pending" || s.status === "active" ? { ...s, status: "skipped" as const } : s,
      );
    case "error":
      return steps.map((s) =>
        s.status === "ok" || s.status === "fail"
          ? s
          : { ...s, status: "fail" as const, message: event.error },
      );
    default:
      return steps;
  }
}

export async function* readNdjsonLines(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf("\n");
      while (idx >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "").trim();
        buf = buf.slice(idx + 1);
        if (line) yield line;
        idx = buf.indexOf("\n");
      }
    }
    const last = buf.replace(/\r$/, "").trim();
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

export function parseApplyStreamEvent(line: string): ApplyStreamEvent | null {
  try {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== "object" || !("type" in value)) return null;
    const type = (value as { type: unknown }).type;
    if (typeof type !== "string") return null;
    return value as ApplyStreamEvent;
  } catch {
    return null;
  }
}

export function finishKind(steps: ApplyStep[]): "ok" | "partial" | "fail" {
  const failed = steps.some((s) => s.status === "fail");
  const ok = steps.some((s) => s.status === "ok");
  if (failed && ok) return "partial";
  if (failed) return "fail";
  return "ok";
}

type Listener = () => void;

let snapshot: ApplyProgressState | null = null;
let session = 0;
/** The running apply's cancel request, keyed to its session so a stale one can't fire. */
let cancelHandler: { session: number; cancel: () => Promise<void> } | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

export function getApplyProgress() {
  return snapshot;
}

export function subscribeApplyProgress(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissApplyProgress() {
  session += 1;
  snapshot = null;
  cancelHandler = null;
  emit();
}

export function beginApplyProgress(
  init: Omit<ApplyProgressState, "session" | "finished" | "cancellable" | "cancelling">,
  cancel?: () => Promise<void>,
): number {
  session += 1;
  snapshot = { ...init, session, cancellable: !!cancel };
  cancelHandler = cancel ? { session, cancel } : null;
  emit();
  return session;
}

/**
 * Ask the running apply to stop. The card shows "Cancelling" until the stream reports
 * the stop (or the apply finishes first); a failed request re-arms the button.
 */
export async function cancelApplyProgress() {
  const handler = cancelHandler;
  if (!snapshot || snapshot.finished || snapshot.cancelling) return;
  if (!handler || handler.session !== snapshot.session) return;
  snapshot = { ...snapshot, cancelling: true };
  emit();
  try {
    await handler.cancel();
  } catch (err) {
    if (snapshot?.session === handler.session && !snapshot.finished) {
      snapshot = { ...snapshot, cancelling: false };
      emit();
    }
    throw err;
  }
}

export function patchApplyProgress(id: number, event: ApplyStreamEvent) {
  if (snapshot?.session !== id) return;
  snapshot = { ...snapshot, steps: applyStreamEvent(snapshot.steps, event) };
  emit();
}

export function finishApplyProgress(id: number, finished: ApplyProgressState["finished"]) {
  if (snapshot?.session !== id) return;
  snapshot = { ...snapshot, finished, cancelling: false };
  if (cancelHandler?.session === id) cancelHandler = null;
  emit();
}
