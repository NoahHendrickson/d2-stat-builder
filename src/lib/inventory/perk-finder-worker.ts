import { findPerkFinderResult, type PerkFinderArgs, type PerkFinderResult } from "./perk-finder";

export interface PerkFinderRequest {
  seq: number;
  args: PerkFinderArgs;
}

export interface PerkFinderResponse {
  seq: number;
  result: PerkFinderResult;
}

// The perk finder's cover search runs here so a big one (many copies, ranked picks in
// every column) never freezes the page. One synchronous solve per request; the main
// thread cancels a stale one by terminating the worker.
const ctx = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent<PerkFinderRequest>) => {
  const { seq, args } = e.data;
  const result = findPerkFinderResult(args.items, args.priority, args.mode, args.customOrder, args.combos);
  ctx.postMessage({ seq, result } satisfies PerkFinderResponse);
};
