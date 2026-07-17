import { describe, expect, it } from "vitest";
import { mayReconcileRoster, nextDockState, type DockState } from "../dock-state";
import { cubicBezier } from "../dock-motion";

describe("nextDockState", () => {
  it("toggles closed→opening and open→closing", () => {
    expect(nextDockState("closed", "toggle")).toBe("opening");
    expect(nextDockState("open", "toggle")).toBe("closing");
  });

  it("reverses mid-settle (interruptible animations)", () => {
    expect(nextDockState("opening", "toggle")).toBe("closing");
    expect(nextDockState("closing", "toggle")).toBe("opening");
  });

  it("settles opening→open and closing→closed, and nowhere else", () => {
    expect(nextDockState("opening", "settled")).toBe("open");
    expect(nextDockState("closing", "settled")).toBe("closed");
    expect(nextDockState("open", "settled")).toBe("open");
    expect(nextDockState("closed", "settled")).toBe("closed");
  });

  it("close is idempotent from closed, open is idempotent from open", () => {
    expect(nextDockState("closed", "close")).toBe("closed");
    expect(nextDockState("open", "open")).toBe("open");
    expect(nextDockState("opening", "close")).toBe("closing");
    expect(nextDockState("closing", "open")).toBe("opening");
  });
});

describe("mayReconcileRoster (freeze-order guard §2.3)", () => {
  it("allows reconcile only while fully closed", () => {
    const frozen: DockState[] = ["opening", "open", "closing"];
    for (const s of frozen) expect(mayReconcileRoster(s)).toBe(false);
    expect(mayReconcileRoster("closed")).toBe(true);
  });
});

describe("cubicBezier", () => {
  it("is exact at the endpoints and clamps outside them", () => {
    const ease = cubicBezier(0.32, 0.72, 0, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(-0.5)).toBe(0);
    expect(ease(1.5)).toBe(1);
  });

  it("is monotonic and matches known anchor values", () => {
    const ease = cubicBezier(0.32, 0.72, 0, 1);
    let prev = 0;
    for (let u = 0; u <= 1.0001; u += 0.01) {
      const y = ease(u);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
    // linear curve sanity: y == x everywhere
    const linear = cubicBezier(1 / 3, 1 / 3, 2 / 3, 2 / 3);
    for (const u of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(linear(u)).toBeCloseTo(u, 4);
    }
    // decisive start: well above linear early on
    expect(ease(0.25)).toBeGreaterThan(0.5);
  });
});
