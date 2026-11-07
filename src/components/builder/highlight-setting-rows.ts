// Bumped on every call, so a scroll that a newer call replaced never reports in.
let generation = 0;

/**
 * Scroll `rows` (in page order) into view and resolve `true` once the scroll has
 * stopped, so a highlight played then is seen whole. Resolves `false` when a newer call
 * took over.
 */
export function scrollRowsIntoView(rows: readonly (HTMLElement | null)[]): Promise<boolean> {
  const mine = ++generation;
  const first = rows.find((row): row is HTMLElement => row !== null);
  if (!first) return Promise.resolve(false);
  const last = rows.findLast((row): row is HTMLElement => row !== null) ?? first;
  const top = first.getBoundingClientRect().top;
  const bottom = last.getBoundingClientRect().bottom;
  const settled = () => mine === generation;
  if (top >= 0 && bottom <= window.innerHeight) return Promise.resolve(settled());
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  first.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  return (reduce ? Promise.resolve() : scrollStopped(first)).then(settled);
}

/**
 * When the scroll that moves `el` stops. `scrollend` where the browser has it (caught
 * on the document in the capture phase: it doesn't bubble from the scroller);
 * otherwise `el` holding still for a few frames once it has started moving. Gives up
 * after 1.5 s either way.
 */
function scrollStopped(el: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      document.removeEventListener("scrollend", finish, true);
      resolve();
    };
    setTimeout(finish, 1500);
    if ("onscrollend" in window) {
      document.addEventListener("scrollend", finish, true);
      return;
    }
    const start = el.getBoundingClientRect().top;
    let last = start;
    let still = 0;
    const step = () => {
      if (finished) return;
      const top = el.getBoundingClientRect().top;
      // Only count still frames once the scroll has begun.
      still = top !== start && top === last ? still + 1 : 0;
      last = top;
      if (still >= 4) finish();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
