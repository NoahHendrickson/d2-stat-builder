import {
  buildTheorySpace,
  solveTheory,
  type TheoryInput,
  type TheoryResult,
  type TheorySpace,
} from "./theory";

export interface TheoryRequest {
  seq: number;
  input: TheoryInput;
}

export interface TheoryResponse {
  seq: number;
  result: TheoryResult;
}

// Theoretical builds run in their own worker. The roll space (every sum of five rolls)
// depends only on the archetypes, the owned pieces and the exotic (not its stat bonus), so
// it is kept across requests — dragging a target re-checks the sums without rebuilding them.
const ctx = self as unknown as Worker;
let cached: { key: string; space: TheorySpace } | null = null;

ctx.onmessage = (e: MessageEvent<TheoryRequest>) => {
  const { seq, input } = e.data;
  const { exotic } = input;
  const shape = exotic && { slot: exotic.slot, rolls: exotic.rolls, owned: exotic.owned };
  const key = JSON.stringify([input.archetypes, input.owned, shape]);
  if (cached?.key !== key) {
    cached = { key, space: buildTheorySpace(input.archetypes, input.owned, shape) };
  }
  const result = solveTheory(input, cached.space);
  ctx.postMessage({ seq, result } satisfies TheoryResponse);
};
