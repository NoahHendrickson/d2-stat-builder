import { describe, expect, it } from "vitest";
import { loadingView, type LoadingInputs } from "./progress";

const base: LoadingInputs = {
  sessionPending: false,
  sessionError: false,
  authenticated: true,
  manifest: { state: "ready" },
  armoryPending: false,
  armoryError: false,
};

describe("loadingView", () => {
  it("shows the session stage while the session is resolving", () => {
    const view = loadingView({ ...base, sessionPending: true, authenticated: false });
    expect(view.phase).toBe("loading");
    expect(view.message).toMatch(/session/i);
    expect(view.target).toBeGreaterThan(0);
    expect(view.target).toBeLessThan(0.1);
  });

  it("hides for signed-out visitors once the session resolves", () => {
    const view = loadingView({ ...base, authenticated: false });
    expect(view.phase).toBe("hidden");
  });

  it("maps manifest progress into its stage band", () => {
    const start = loadingView({
      ...base,
      manifest: { state: "loading", message: "Downloading game data (0/9)…", progress: 0 },
    });
    const mid = loadingView({
      ...base,
      manifest: { state: "loading", message: "Downloading game data (5/9)…", progress: 5 / 9 },
    });
    expect(start.phase).toBe("loading");
    expect(start.message).toBe("Downloading game data (0/9)…");
    expect(start.target).toBeCloseTo(0.08);
    expect(mid.target).toBeGreaterThan(start.target);
    expect(mid.target).toBeLessThan(0.78);
  });

  it("treats an idle manifest as the start of the manifest stage", () => {
    const view = loadingView({ ...base, manifest: { state: "idle" } });
    expect(view.phase).toBe("loading");
    expect(view.target).toBeCloseTo(0.08);
  });

  it("shows the armory stage while gear is loading", () => {
    const view = loadingView({ ...base, armoryPending: true });
    expect(view.phase).toBe("loading");
    expect(view.message).toMatch(/gear/i);
    expect(view.target).toBeGreaterThanOrEqual(0.78);
    expect(view.target).toBeLessThan(1);
  });

  it("is done once everything is ready", () => {
    const view = loadingView(base);
    expect(view.phase).toBe("done");
    expect(view.target).toBe(1);
  });

  it("hides on any error so the inline status cards take over", () => {
    expect(loadingView({ ...base, sessionError: true }).phase).toBe("hidden");
    expect(
      loadingView({ ...base, manifest: { state: "error", message: "boom" } }).phase,
    ).toBe("hidden");
    expect(loadingView({ ...base, armoryPending: true, armoryError: true }).phase).toBe(
      "hidden",
    );
  });
});
