/**
 * Motion primitives for the session dock (WORLD-416 §2).
 *
 * The dock's open/close is a single scalar `progress p ∈ [0, 1]` that drives
 * every visual (panel translate, scrim, FLIP clones, fades) through ONE
 * requestAnimationFrame writer mutating styles on refs directly — no React
 * state per frame (same discipline as BottomSheet's drag and TabUnderline).
 * Tap-open animates p over time; the drag gesture (PR-D scope) scrubs p
 * directly. Both feed the same writer.
 */

/**
 * CSS cubic-bezier(x1, y1, x2, y2) evaluated in JS, so rAF-driven progress
 * matches what a CSS transition would do. Solves x(t) = u for t by Newton
 * with a bisection fallback, then returns y(t). Endpoints are exact.
 */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (u: number) => number {
  const bez = (t: number, a: number, b: number) => {
    const inv = 1 - t;
    return 3 * inv * inv * t * a + 3 * inv * t * t * b + t * t * t;
  };
  const bezDx = (t: number) => {
    const inv = 1 - t;
    return 3 * inv * inv * x1 + 6 * inv * t * (x2 - x1) + 3 * t * t * (1 - x2);
  };
  return (u: number) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let t = u;
    for (let i = 0; i < 6; i++) {
      const dx = bezDx(t);
      if (dx < 1e-6) break;
      t -= (bez(t, x1, x2) - u) / dx;
    }
    if (t < 0 || t > 1 || Math.abs(bez(t, x1, x2) - u) > 1e-4) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 24; i++) {
        t = (lo + hi) / 2;
        if (bez(t, x1, x2) < u) lo = t;
        else hi = t;
      }
    }
    return bez(t, y1, y2);
  };
}

/** Tap open/close: the iOS sheet curve — decisive start, soft landing. */
export const EASE_SHEET = cubicBezier(0.32, 0.72, 0, 1);
/** Gesture-release settle: ease-out-quint feel, no bounce (§2.2). */
export const EASE_SETTLE = cubicBezier(0.22, 1, 0.36, 1);

export const TAP_OPEN_MS = 280;
export const TAP_CLOSE_MS = 240;
export const REDUCED_MOTION_FADE_MS = 120;

export interface ProgressAnimator {
  /** Current progress — live during animation, final value after. */
  readonly p: number;
  /** Animate from the CURRENT p to `to` (interruptible: a new call starts
   *  from wherever the last one is now). */
  animate(to: number, durationMs: number, ease: (u: number) => number, onDone?: () => void): void;
  /** Set p immediately (drag scrub path), cancelling any animation. */
  set(p: number): void;
  /** Cancel the in-flight animation, keeping the current p. */
  cancel(): void;
}

/**
 * The single-writer rAF driver: every frame calls `write(p)` exactly once.
 * `write` performs all direct style mutations for that frame.
 */
export function createProgressAnimator(write: (p: number) => void): ProgressAnimator {
  let current = 0;
  let raf = 0;

  const cancel = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  return {
    get p() {
      return current;
    },
    animate(to, durationMs, ease, onDone) {
      cancel();
      const from = current;
      if (durationMs <= 0 || from === to) {
        current = to;
        write(current);
        onDone?.();
        return;
      }
      const t0 = performance.now();
      // Deliberately ignores the rAF-provided timestamp: its origin is not
      // guaranteed to match performance.now() everywhere (jsdom's differs
      // outright), and mixing the two froze u below 0. performance.now()
      // inside the frame is monotonic with t0 by construction.
      const frame = () => {
        const u = Math.min(1, (performance.now() - t0) / durationMs);
        current = from + (to - from) * ease(u);
        write(current);
        if (u < 1) {
          raf = requestAnimationFrame(frame);
        } else {
          raf = 0;
          onDone?.();
        }
      };
      raf = requestAnimationFrame(frame);
    },
    set(p) {
      cancel();
      current = p;
      write(current);
    },
    cancel,
  };
}
