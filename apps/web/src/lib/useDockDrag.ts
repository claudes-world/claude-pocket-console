import { useEffect, useRef } from "react";

/**
 * The session-dock drag gesture (WORLD-416 §2.2): vertical scrub on the
 * switcher row (open) and on the open panel (close), disambiguated from the
 * chip strip's native horizontal scroll, the tab swipe, and Telegram's
 * swipe-to-minimize by a deterministic per-touch axis-claim state machine.
 *
 * Listeners are native, attached with { passive: false } — React's synthetic
 * touchmove can be passive, and after a vertical claim every move must be
 * preventDefault()ed to kill residual scroll/overscroll. touchstart is NEVER
 * preventDefault()ed (hard Telegram-WebView rule — it breaks all Telegram
 * gestures); the claim only suppresses moves.
 *
 * Progress mapping: p = startP + (dy − dyAtClaim) / panelHeight — moving
 * down always raises p, up always lowers it, whichever surface claimed.
 * Past [0, 1] the finger meets 0.25× rubber-band resistance, surfaced to
 * the caller as `overshootPx` (a small translate on the reveal window).
 */

const CLAIM_SLOP_PX = 10;
/** Diagonal ties break horizontal — a mis-fired open is more annoying than
 *  a mis-fired scroll (scroll is the 100×/day gesture). ≈ steeper than 54°. */
const VERTICAL_BIAS = 1.4;
/** Native scroll veto: if the strip scrolled at all, the browser owns it. */
const NATIVE_SCROLL_VETO_PX = 2;
/** Release commit thresholds (§2.2). */
export const COMMIT_PROGRESS = 0.35;
export const COMMIT_VELOCITY = 0.5; // px/ms
/** Velocity window: derived from the last 80ms of samples. */
const VELOCITY_WINDOW_MS = 80;
const RUBBER_BAND = 0.25;
const MAX_OVERSHOOT_PX = 16;

export type GestureAxis = "vertical" | "horizontal" | "undecided";

/**
 * Pure axis classifier, exported for unit tests. `dy` is oriented TOWARD
 * the claiming direction (the caller negates it for the upward close-drag),
 * so "vertical" always means "the dock claims this touch".
 */
export function classifyDockGesture(dx: number, dy: number, scrollDelta: number): GestureAxis {
  if (Math.abs(scrollDelta) >= NATIVE_SCROLL_VETO_PX) return "horizontal";
  if (dy > CLAIM_SLOP_PX && dy > Math.abs(dx) * VERTICAL_BIAS) return "vertical";
  // Horizontal slop exceeded first — bail for the rest of this touch. An
  // anti-directional vertical move (dy below -slop) also bails: from the
  // row that's terminal territory, from the panel it's list territory.
  if (Math.abs(dx) > CLAIM_SLOP_PX || dy < -CLAIM_SLOP_PX) return "horizontal";
  return "undecided";
}

/**
 * Release rules (§2.2), pure for unit tests. `anchor` is the state a failed
 * commit returns to. Velocity is signed, positive = downward (opening).
 * A strong fling toward the anchor cancels even past the progress
 * threshold; otherwise progress OR velocity commits.
 */
export function resolveReleaseTarget(
  anchor: "closed" | "open",
  p: number,
  velocity: number,
): 0 | 1 {
  if (anchor === "closed") {
    if (velocity <= -COMMIT_VELOCITY) return 0;
    return p >= COMMIT_PROGRESS || velocity >= COMMIT_VELOCITY ? 1 : 0;
  }
  if (velocity >= COMMIT_VELOCITY) return 1;
  return p <= 1 - COMMIT_PROGRESS || velocity <= -COMMIT_VELOCITY ? 0 : 1;
}

/** Settle duration: animate the remaining distance at (roughly) the release
 *  velocity, clamped to [160, 320]ms (§2.2). */
export function settleDuration(remainingPx: number, velocityPxMs: number): number {
  const v = Math.max(Math.abs(velocityPxMs), 1e-6);
  return Math.min(320, Math.max(160, remainingPx / v));
}

/** The commit boundary in p-space for threshold-crossing haptics. */
export function commitBoundary(anchor: "closed" | "open"): number {
  return anchor === "closed" ? COMMIT_PROGRESS : 1 - COMMIT_PROGRESS;
}

export interface DockDragOptions {
  /** which vertical direction claims on this surface */
  direction: "down" | "up";
  /** native-scroll veto source (the chip strip's scrollLeft) */
  getScrollDelta?: () => number;
  /** extra claim gate evaluated at claim time (e.g. list-at-top rule);
   *  receives the touchstart target */
  canClaim?: (startTarget: EventTarget | null) => boolean;
  /** claim accepted: mount/measure; returns scrub context */
  onClaim: () => { heightPx: number; startP: number; anchor: "closed" | "open" };
  /** one rAF-batched frame during the scrub */
  onFrame: (p: number, overshootPx: number) => void;
  /** finger lifted (or touch cancelled) */
  onRelease: (r: { target: 0 | 1; velocity: number; p: number }) => void;
  onClaimHaptic?: () => void;
  onThresholdHaptic?: () => void;
  disableVerticalSwipes?: () => void;
}

/**
 * Attach the gesture to a surface. Returns the detach function. Non-React
 * core so tests can drive it with synthetic TouchEvents.
 */
export function attachDockDrag(el: HTMLElement, opts: DockDragOptions): () => void {
  type Phase = "undecided" | "claimed" | "bailed";
  let phase: Phase = "undecided";
  let x0 = 0;
  let y0 = 0;
  let scroll0 = 0;
  let startTarget: EventTarget | null = null;
  let ctx: { heightPx: number; startP: number; anchor: "closed" | "open" } | null = null;
  let dyAtClaim = 0;
  let latestDy = 0;
  let raf = 0;
  let lastSideAbove = false;
  let samples: { t: number; y: number }[] = [];

  const orient = (dy: number) => (opts.direction === "down" ? dy : -dy);

  const computeP = (dy: number) => {
    if (!ctx) return 0;
    const raw = ctx.startP + (dy - dyAtClaim) / ctx.heightPx;
    if (raw > 1) return 1 + (raw - 1) * RUBBER_BAND;
    if (raw < 0) return raw * RUBBER_BAND;
    return raw;
  };

  const frame = () => {
    raf = 0;
    if (phase !== "claimed" || !ctx) return;
    const p = computeP(latestDy);
    const over = p > 1
      ? Math.min((p - 1) * ctx.heightPx, MAX_OVERSHOOT_PX)
      : p < 0
        ? Math.max(p * ctx.heightPx, -MAX_OVERSHOOT_PX)
        : 0;
    opts.onFrame(Math.min(1, Math.max(0, p)), over);

    const boundary = commitBoundary(ctx.anchor);
    const above = p >= boundary;
    if (above !== lastSideAbove) {
      opts.onThresholdHaptic?.();
      lastSideAbove = above;
    }
  };

  const velocityNow = () => {
    const cutoff = performance.now() - VELOCITY_WINDOW_MS;
    const win = samples.filter((s) => s.t >= cutoff);
    if (win.length < 2) return 0;
    const first = win[0];
    const last = win[win.length - 1];
    const dt = last.t - first.t;
    return dt > 0 ? (last.y - first.y) / dt : 0;
  };

  const reset = () => {
    phase = "undecided";
    ctx = null;
    samples = [];
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      phase = "bailed";
      return;
    }
    phase = "undecided";
    ctx = null;
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
    scroll0 = opts.getScrollDelta?.() ?? 0;
    startTarget = e.target;
    samples = [{ t: performance.now(), y: e.touches[0].clientY }];
  };

  const onTouchMove = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - x0;
    const dy = touch.clientY - y0;
    samples.push({ t: performance.now(), y: touch.clientY });
    if (samples.length > 32) samples.shift();

    if (phase === "bailed") return;
    if (phase === "undecided") {
      const scrollDelta = (opts.getScrollDelta?.() ?? 0) - scroll0;
      const axis = classifyDockGesture(dx, orient(dy), scrollDelta);
      if (axis === "horizontal") {
        phase = "bailed";
        return;
      }
      if (axis === "undecided") return;
      if (opts.canClaim && !opts.canClaim(startTarget)) {
        phase = "bailed";
        return;
      }
      ctx = opts.onClaim();
      phase = "claimed";
      dyAtClaim = dy;
      lastSideAbove = computeP(dy) >= commitBoundary(ctx.anchor);
      opts.disableVerticalSwipes?.();
      opts.onClaimHaptic?.();
    }
    // claimed: we own every subsequent move.
    e.preventDefault();
    latestDy = dy;
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const finish = (cancelled: boolean) => {
    if (phase !== "claimed" || !ctx) {
      reset();
      return;
    }
    const velocity = cancelled ? 0 : velocityNow();
    const pRaw = computeP(latestDy);
    const p = Math.min(1, Math.max(0, pRaw));
    const target = cancelled
      ? ((ctx.anchor === "closed" ? 0 : 1) as 0 | 1)
      : resolveReleaseTarget(ctx.anchor, p, velocity);
    opts.onRelease({ target, velocity, p });
    reset();
  };

  const onTouchEnd = () => finish(false);
  const onTouchCancel = () => finish(true);

  el.addEventListener("touchstart", onTouchStart, { passive: true });
  el.addEventListener("touchmove", onTouchMove, { passive: false });
  el.addEventListener("touchend", onTouchEnd, { passive: true });
  el.addEventListener("touchcancel", onTouchCancel, { passive: true });
  return () => {
    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("touchmove", onTouchMove);
    el.removeEventListener("touchend", onTouchEnd);
    el.removeEventListener("touchcancel", onTouchCancel);
    reset();
  };
}

/** React wrapper: attaches while `enabled` and the element exists. Options
 *  are read through a ref, so callers may pass fresh closures every render. */
export function useDockDrag(
  elRef: React.RefObject<HTMLElement | null>,
  opts: DockDragOptions,
  enabled = true,
): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    const el = elRef.current;
    if (!enabled || !el) return;
    return attachDockDrag(el, {
      direction: optsRef.current.direction,
      getScrollDelta: () => optsRef.current.getScrollDelta?.() ?? 0,
      canClaim: (t) => optsRef.current.canClaim?.(t) ?? true,
      onClaim: () => optsRef.current.onClaim(),
      onFrame: (p, o) => optsRef.current.onFrame(p, o),
      onRelease: (r) => optsRef.current.onRelease(r),
      onClaimHaptic: () => optsRef.current.onClaimHaptic?.(),
      onThresholdHaptic: () => optsRef.current.onThresholdHaptic?.(),
      disableVerticalSwipes: () => optsRef.current.disableVerticalSwipes?.(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, elRef]);
}
