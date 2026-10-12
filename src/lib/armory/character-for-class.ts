/** Most-recently-played character of `classType`, or undefined if none. */
export function characterForClass<
  T extends { classType: number; dateLastPlayed: string },
>(characters: T[], classType: number): T | undefined {
  let best: T | undefined;
  for (const c of characters) {
    if (c.classType !== classType) continue;
    if (!best || c.dateLastPlayed > best.dateLastPlayed) best = c;
  }
  return best;
}

/** The most-recently-played character, or undefined when there are none. */
export function mostRecentCharacter<T extends { dateLastPlayed: string }>(
  characters: readonly T[],
): T | undefined {
  let best: T | undefined;
  for (const c of characters) if (!best || c.dateLastPlayed > best.dateLastPlayed) best = c;
  return best;
}
