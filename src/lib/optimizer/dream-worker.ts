import { solveDream, type DreamInput, type DreamResult } from "./dream";

export interface DreamRequest {
  seq: number;
  input: DreamInput;
}

/** A phase (how many new pieces the search is checking), then the result. */
export type DreamResponse =
  | { seq: number; kind: "phase"; newPieces: number }
  | { seq: number; kind: "result"; result: DreamResult };

// The dream search runs in its own worker so it never queues behind (or delays) the
// regular build search. It is one synchronous solve per request; the main thread
// cancels a stale one by terminating the worker.
const ctx = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent<DreamRequest>) => {
  const { seq, input } = e.data;
  const result = solveDream(input, {
    onPhase: (newPieces) =>
      ctx.postMessage({ seq, kind: "phase", newPieces } satisfies DreamResponse),
  });
  ctx.postMessage({ seq, kind: "result", result } satisfies DreamResponse);
};
