// Bumped on every call, so a pulse still waiting on an earlier scroll never fires.
let generation = 0;

/**
 * Scroll settings rows into view and pulse them (the d2-attention utility: fill plus
 * an outgoing hover ring), for a notice that points the player at settings to change.
 * The pulse waits for the scroll to stop, so the player sees all of it. Each call
 * replays it.
 */
export function highlightSettingRows(rows: readonly (HTMLElement | null)[]): void {
  const shown = rows.filter((row): row is HTMLElement => row !== null);
  if (!shown.length) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  shown[0].scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  const mine = ++generation;
  whenStill(shown[0], () => {
    if (mine !== generation) return;
    for (const row of shown) pulse(row);
  });
}

/** Call `done` once `el` has held its place for a few frames (or after 1.5 s). */
function whenStill(el: HTMLElement, done: () => void): void {
  const start = performance.now();
  let last = Number.NaN;
  let still = 0;
  const step = () => {
    const top = el.getBoundingClientRect().top;
    still = top === last ? still + 1 : 0;
    last = top;
    if (still >= 4 || performance.now() - start > 1500) done();
    else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function pulse(row: HTMLElement): void {
  row.classList.remove("d2-attention");
  // Reading layout restarts the animation when the class goes straight back on.
  void row.offsetWidth;
  row.classList.add("d2-attention");
  // The fill runs longest; the ring's end must not cut it short.
  const done = (event: AnimationEvent) => {
    if (event.animationName !== "d2-attention") return;
    row.classList.remove("d2-attention");
    row.removeEventListener("animationend", done);
  };
  row.addEventListener("animationend", done);
}
