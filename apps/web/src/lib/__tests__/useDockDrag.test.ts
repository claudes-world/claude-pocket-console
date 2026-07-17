import { describe, expect, it } from "vitest";
import {
  classifyDockGesture,
  commitBoundary,
  resolveReleaseTarget,
  settleDuration,
  COMMIT_PROGRESS,
  COMMIT_VELOCITY,
} from "../useDockDrag";
import { nextDockState } from "../dock-state";

/**
 * Gesture math (WORLD-416 §2.2), pure-function coverage: the axis-claim
 * truth table (angle bias, slop, native-scroll veto), the release commit
 * table (progress/velocity), the settle-duration clamp, and the dragging
 * extensions of the dock state machine. The full touch pipeline is
 * covered on-device (device-QA gate) and best-effort in playwright.
 */

describe("classifyDockGesture", () => {
  it("stays undecided inside the 10px slop", () => {
    expect(classifyDockGesture(4, 8, 0)).toBe("undecided");
    expect(classifyDockGesture(-9, 9, 0)).toBe("undecided");
  });

  it("claims vertical only past slop AND steeper than the 1.4 bias", () => {
    expect(classifyDockGesture(0, 11, 0)).toBe("vertical");
    expect(classifyDockGesture(7, 11, 0)).toBe("vertical"); // 11 > 7*1.4=9.8
    expect(classifyDockGesture(8, 11, 0)).toBe("undecided"); // 11 < 8*1.4=11.2
    expect(classifyDockGesture(-7, 11, 0)).toBe("vertical"); // sign-agnostic dx
  });

  it("diagonal ties break horizontal (scroll is the 100x/day gesture)", () => {
    // both axes past slop, angle shallower than the bias -> horizontal
    expect(classifyDockGesture(11, 12, 0)).toBe("horizontal");
  });

  it("bails horizontal once |dx| crosses slop first", () => {
    expect(classifyDockGesture(11, 3, 0)).toBe("horizontal");
    expect(classifyDockGesture(-11, 3, 0)).toBe("horizontal");
  });

  it("native strip scroll vetoes the claim outright", () => {
    expect(classifyDockGesture(0, 40, 2)).toBe("horizontal");
    expect(classifyDockGesture(0, 40, -3)).toBe("horizontal");
    expect(classifyDockGesture(0, 40, 1)).toBe("vertical"); // sub-veto jitter
  });

  it("ignores anti-directional drags (upward from closed is terminal territory)", () => {
    expect(classifyDockGesture(0, -11, 0)).toBe("horizontal");
  });
});

describe("resolveReleaseTarget", () => {
  it("commits open past the progress threshold regardless of slow drift", () => {
    expect(resolveReleaseTarget("closed", COMMIT_PROGRESS, 0)).toBe(1);
    expect(resolveReleaseTarget("closed", 0.34, 0)).toBe(0);
  });

  it("commits open on a fast downward flick below the threshold", () => {
    expect(resolveReleaseTarget("closed", 0.1, COMMIT_VELOCITY)).toBe(1);
    expect(resolveReleaseTarget("closed", 0.1, 0.49)).toBe(0);
  });

  it("a strong fling back toward the anchor cancels even past the threshold", () => {
    expect(resolveReleaseTarget("closed", 0.6, -COMMIT_VELOCITY)).toBe(0);
    expect(resolveReleaseTarget("open", 0.4, COMMIT_VELOCITY)).toBe(1);
  });

  it("mirrors the rules for the close drag (anchor open)", () => {
    expect(resolveReleaseTarget("open", 1 - COMMIT_PROGRESS, 0)).toBe(0);
    expect(resolveReleaseTarget("open", 0.66, 0)).toBe(1);
    expect(resolveReleaseTarget("open", 0.9, -COMMIT_VELOCITY)).toBe(0);
  });

  it("exposes the matching haptic boundary per anchor", () => {
    expect(commitBoundary("closed")).toBe(COMMIT_PROGRESS);
    expect(commitBoundary("open")).toBe(1 - COMMIT_PROGRESS);
  });
});

describe("settleDuration", () => {
  it("animates remaining distance at the release velocity, clamped to [160, 320]", () => {
    expect(settleDuration(100, 0.5)).toBe(200);
    expect(settleDuration(300, 0.5)).toBe(320); // 600ms clamped down
    expect(settleDuration(20, 2)).toBe(160); // 10ms clamped up
    expect(settleDuration(50, 0)).toBe(320); // zero velocity -> slowest
  });
});

describe("dock state machine: dragging extensions", () => {
  it("drag-claim grabs from every state (interruptible settles)", () => {
    for (const s of ["closed", "opening", "open", "closing", "dragging"] as const) {
      expect(nextDockState(s, "drag-claim")).toBe("dragging");
    }
  });

  it("release routes to the matching settle, only from dragging", () => {
    expect(nextDockState("dragging", "drag-release-open")).toBe("opening");
    expect(nextDockState("dragging", "drag-release-close")).toBe("closing");
    expect(nextDockState("open", "drag-release-close")).toBe("open");
  });

  it("taps cannot fight an active finger", () => {
    expect(nextDockState("dragging", "toggle")).toBe("dragging");
    expect(nextDockState("dragging", "close")).toBe("dragging");
    expect(nextDockState("dragging", "open")).toBe("dragging");
    expect(nextDockState("dragging", "settled")).toBe("dragging");
  });
});
