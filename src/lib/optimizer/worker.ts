import { runSolveSession } from "./session";
import type {
  BuildList,
  OptimizerOutput,
  OptimizerRequest,
  OptimizerResponse,
} from "./types";

// Runs the (CPU-heavy) combinatorial search off the main thread. Streams progress and
// ceiling updates as they refine, posts the build list as soon as the walk ends
// ("builds", skipped when it is empty), then posts the result — a capped search posts its
// frozen list (refining: true), optionally a strictly-better replacement ("better"),
// and always a final result. Each message echoes the request seq so the main thread
// can ignore superseded runs.
const ctx = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent<OptimizerRequest>) => {
  const { seq, input, carry } = e.data;
  const callbacks = {
    onProgress: (progress: number) =>
      ctx.postMessage({ seq, kind: "progress", progress } satisfies OptimizerResponse),
    onCeilings: (ceilings: number[]) =>
      ctx.postMessage({ seq, kind: "ceilings", ceilings } satisfies OptimizerResponse),
    onBuilds: (builds: BuildList) =>
      ctx.postMessage({ seq, kind: "builds", builds } satisfies OptimizerResponse),
    onBetter: (output: OptimizerOutput) =>
      ctx.postMessage({ seq, kind: "better", output } satisfies OptimizerResponse),
    onResult: (output: OptimizerOutput, refining: boolean, verified: boolean) =>
      ctx.postMessage({
        seq,
        kind: "result",
        output,
        refining,
        verified,
      } satisfies OptimizerResponse),
  };
  // Empty budget overrides (production defaults); `carry` threads the main thread's
  // cross-edit ceiling bounds into the session's first solve (see carryover.ts).
  runSolveSession(input, callbacks, {}, carry);
};
