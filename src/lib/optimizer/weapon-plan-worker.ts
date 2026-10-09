import { planWeapons, type WeaponMixResult } from "./weapon-plan";
import type { OptimizerInput } from "./types";

export interface WeaponPlanRequest {
  seq: number;
  input: OptimizerInput;
}

export interface WeaponPlanResponse {
  seq: number;
  results: WeaponMixResult[] | null;
}

// The weapon-mix scan runs in its own worker so it never queues behind (or delays) the
// regular build search. One synchronous scan per request; the main thread cancels a
// stale one by terminating the worker.
const ctx = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent<WeaponPlanRequest>) => {
  const { seq, input } = e.data;
  ctx.postMessage({ seq, results: planWeapons(input) } satisfies WeaponPlanResponse);
};
