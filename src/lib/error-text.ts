/** An error's message for a log line, or the thrown value itself when it isn't an Error. */
export const errorText = (err: unknown) => (err instanceof Error ? err.message : err);
