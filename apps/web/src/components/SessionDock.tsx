import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { haptic } from "../lib/haptic";
import type { TmuxSessionInfo } from "../lib/session-meta";
import { nextDockState, mayReconcileRoster, type DockState } from "../lib/dock-state";
import {
  createProgressAnimator,
  EASE_SETTLE,
  EASE_SHEET,
  REDUCED_MOTION_FADE_MS,
  TAP_CLOSE_MS,
  TAP_OPEN_MS,
  type ProgressAnimator,
} from "../lib/dock-motion";
import { useFlipMorph, type FlipTargets } from "../lib/useFlipMorph";
import { useDockDrag, settleDuration } from "../lib/useDockDrag";
import { SessionListRow } from "./SessionListRow";
import { getTelegramWebApp } from "../lib/telegram";

/**
 * The session dock (WORLD-416 §2–3): the terminal tab's switcher row —
 * horizontal chip strip + right-edge trigger — that morphs in place into an
 * anchored list panel opening DOWNWARD from the row. Replaces the retired
 * SessionSwitcherSheet (bottom sheet): the terminal stays visible, dimmed,
 * beneath the panel.
 *
 * Open/close paths: trigger tap, scrim tap, row select, row-background tap,
 * and the drag gesture (useDockDrag) — a vertical scrub on the switcher row
 * opens, on the open panel closes, both driving the same single-rAF
 * progress writer the tap animations use.
 *
 * Select semantics are SessionPicker's, preserved exactly (PR #299
 * escape-hatch): `onSelect(s.writable ? null : s.name)` — null is the
 * "view the server default" sentinel, so the synthesized fallback pill can
 * never target a literal session named "default".
 *
 * The roster prop may refresh every 30s; the DISPLAYED order freezes while
 * the dock is anything but closed (§2.3 guard — reordering under a finger
 * is the classic jank bug) and reconciles on settle-closed.
 */

/** Panel height budget: rows + top breathing room + bottom grabber zone. */
const ROW_HEIGHT = 52;
const PANEL_TOP_PAD = 6;
const PANEL_BOTTOM_ZONE = 18;
const PANEL_MAX_VH = 0.45;

interface SessionDockProps {
  sessions: TmuxSessionInfo[];
  /** resolved name of the session currently viewed (App resolves the
   *  default-session fallback before it gets here) */
  active: string;
  /** null selects the server default (writable) session */
  onSelect: (name: string | null) => void;
}

export function SessionDock({ sessions, active, onSelect }: SessionDockProps) {
  const [state, setState] = useState<DockState>("closed");
  const [displayed, setDisplayed] = useState<TmuxSessionInfo[]>(sessions);
  // The panel exists in the DOM for every non-closed state.
  const mounted = state !== "closed";

  const stateRef = useRef(state);
  stateRef.current = state;
  const latestSessions = useRef(sessions);
  latestSessions.current = sessions;

  // Freeze-order guard: reconcile the displayed roster only while closed.
  useEffect(() => {
    if (mayReconcileRoster(stateRef.current)) setDisplayed(sessions);
  }, [sessions]);

  // ---- element registries (FLIP measurement targets) ----
  const chipButtons = useRef(new Map<string, HTMLElement>());
  const chipLabels = useRef(new Map<string, HTMLElement>());
  const rowLabels = useRef(new Map<string, HTMLElement>());
  const rowFurniture = useRef(new Map<string, Map<string, HTMLElement>>());
  const chipStripEl = useRef<HTMLDivElement | null>(null);
  const panelEl = useRef<HTMLDivElement | null>(null);
  const panelWrapEl = useRef<HTMLDivElement | null>(null);
  const listEl = useRef<HTMLDivElement | null>(null);
  const scrimEl = useRef<HTMLDivElement | null>(null);
  const morphLayerEl = useRef<HTMLDivElement | null>(null);

  const registerIn = (map: Map<string, HTMLElement>, key: string, el: HTMLElement | null) => {
    if (el) map.set(key, el);
    else map.delete(key);
  };
  const registerLabel = useCallback(
    (name: string, el: HTMLElement | null) => registerIn(rowLabels.current, name, el),
    [],
  );
  const registerFurniture = useCallback((name: string, key: string, el: HTMLElement | null) => {
    let per = rowFurniture.current.get(name);
    if (!per) rowFurniture.current.set(name, (per = new Map()));
    if (el) per.set(key, el);
    else per.delete(key);
  }, []);

  const displayedRef = useRef(displayed);
  displayedRef.current = displayed;

  const flip = useFlipMorph((): FlipTargets => ({
    chipButtons: chipButtons.current,
    chipLabels: chipLabels.current,
    chipStrip: chipStripEl.current,
    rowLabels: rowLabels.current,
    rowFurniture: new Map(
      [...rowFurniture.current].map(([name, per]) => [name, [...per.values()]]),
    ),
    rowOrder: displayedRef.current.map((s) => s.name),
    panel: panelEl.current,
    panelWrap: panelWrapEl.current,
    scrim: scrimEl.current,
    morphLayer: morphLayerEl.current,
  }));

  const animator = useRef<ProgressAnimator | null>(null);
  if (!animator.current) animator.current = createProgressAnimator((p) => flip.apply(p));
  const fadeOnlyRef = useRef(false);
  // "opening"/"closing" both animate; this dedupes begin() across the
  // toggle-mid-settle reversals (begin once per mounted episode).
  const morphActive = useRef(false);
  const panelHeightRef = useRef(0);
  // Set by a drag release: the settle animates the REMAINING distance at
  // (roughly) the release velocity, with the ease-out-quint curve (§2.2).
  const dragSettleMs = useRef<number | null>(null);
  const prevStateRef = useRef<DockState>("closed");

  const beginMorph = useCallback((atP: 0 | 1) => {
    // One layout pass, at gesture start (§2.4): size the window first so
    // Last rects are final.
    const wrap = panelWrapEl.current;
    if (wrap) {
      const natural = PANEL_TOP_PAD + displayedRef.current.length * ROW_HEIGHT + PANEL_BOTTOM_ZONE;
      const h = Math.min(natural, Math.round(window.innerHeight * PANEL_MAX_VH));
      wrap.style.height = `${h}px`;
      panelHeightRef.current = h;
    }
    const { fadeOnly } = flip.begin();
    fadeOnlyRef.current = fadeOnly;
    morphActive.current = true;
    animator.current!.set(atP);
  }, [flip]);

  const settleTo = useCallback((target: 1 | 0) => {
    const fromDrag = dragSettleMs.current;
    dragSettleMs.current = null;
    const duration = fadeOnlyRef.current
      ? REDUCED_MOTION_FADE_MS
      : fromDrag ?? (target === 1 ? TAP_OPEN_MS : TAP_CLOSE_MS);
    const ease = fromDrag && !fadeOnlyRef.current ? EASE_SETTLE : EASE_SHEET;
    animator.current!.animate(target, duration, ease, () => {
      const settled = nextDockState(stateRef.current, "settled");
      if (target === 1) {
        flip.end(true);
        morphActive.current = false;
      } else {
        flip.end(false);
        morphActive.current = false;
        // Reconcile the roster the moment we're closed (§2.3).
        setDisplayed(latestSessions.current);
      }
      setState(settled);
    });
  }, [flip]);

  // Mount-then-measure: when the panel enters the DOM for an open, size the
  // reveal window, run the FLIP measurement pass, then animate. Runs on
  // state edges only — reversals mid-settle just re-target the animator,
  // and a drag-claim mid-settle freezes it at the current p (interruptible).
  // A close that starts from settled-open needs a FRESH morph episode (the
  // open-settle already tore the last one down to drop will-change and the
  // clones): re-measure — hidden chips still have valid rects — and stamp
  // p=1 styles before animating down.
  useLayoutEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (state === "opening") {
      if (!morphActive.current) beginMorph(0);
      settleTo(1);
    } else if (state === "closing") {
      if (!morphActive.current) beginMorph(1);
      settleTo(0);
    } else if (state === "dragging") {
      animator.current!.cancel();
      // Claimed from settled closed/open: start a fresh morph episode at
      // the anchor's progress. Claimed mid-settle: the episode is live —
      // the cancel above froze it at the grab point.
      if (!morphActive.current) beginMorph(prev === "open" ? 1 : 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Telegram would minimize on a downward swipe over the open panel's list —
  // held for the whole mounted episode (open, dragging, and both settles),
  // re-enabled on settle-closed. The drag hook additionally disables at
  // claim time, before this effect can run.
  useEffect(() => {
    if (!mounted) return;
    const tg = getTelegramWebApp() as any;
    tg?.disableVerticalSwipes?.();
    return () => tg?.enableVerticalSwipes?.();
  }, [mounted]);

  const toggle = useCallback(() => {
    haptic.selection();
    setState((s) => nextDockState(s, "toggle"));
  }, []);

  const close = useCallback(() => {
    setState((s) => nextDockState(s, "close"));
  }, []);

  const openFromRowTap = useCallback((e: React.MouseEvent) => {
    // Plain tap on the row's background (not a chip / not the trigger).
    if (e.target !== e.currentTarget) return;
    haptic.selection();
    setState((s) => nextDockState(s, "open"));
  }, []);

  // ---- the drag gesture (§2.2) ----
  const rootEl = useRef<HTMLDivElement | null>(null);
  const grabZoneEl = useRef<HTMLDivElement | null>(null);

  const claimDrag = useCallback((anchor: "closed" | "open") => {
    // Synchronously mount the panel + run the measurement pass so the very
    // first scrub frame has real geometry to write.
    flushSync(() => setState((s) => nextDockState(s, "drag-claim")));
    return {
      heightPx: panelHeightRef.current || 1,
      startP: animator.current!.p,
      anchor,
    };
  }, []);

  const dragFrame = useCallback((p: number, overshootPx: number) => {
    animator.current!.set(p);
    const wrap = panelWrapEl.current;
    if (wrap) wrap.style.transform = overshootPx ? `translateY(${overshootPx}px)` : "";
  }, []);

  const dragRelease = useCallback((r: { target: 0 | 1; velocity: number; p: number }) => {
    const wrap = panelWrapEl.current;
    if (wrap && wrap.style.transform) {
      // Let the rubber-band overshoot relax on its own short curve.
      wrap.style.transition = "transform 160ms ease-out";
      wrap.style.transform = "";
      setTimeout(() => {
        if (wrap) wrap.style.transition = "";
      }, 200);
    }
    const remaining = Math.abs(r.target - r.p) * (panelHeightRef.current || 1);
    dragSettleMs.current = settleDuration(remaining, r.velocity);
    setState((s) => nextDockState(s, r.target === 1 ? "drag-release-open" : "drag-release-close"));
  }, []);

  const disableSwipesNow = useCallback(() => {
    (getTelegramWebApp() as any)?.disableVerticalSwipes?.();
  }, []);

  const claimHaptic = useCallback(() => haptic.impact("light"), []);

  // Open gesture: swipe down anywhere on the switcher row (chips, gaps, or
  // trigger). The strip's native horizontal scroll vetoes the claim.
  useDockDrag(rootEl, {
    direction: "down",
    getScrollDelta: () => chipStripEl.current?.scrollLeft ?? 0,
    onClaim: () => claimDrag("closed"),
    onFrame: dragFrame,
    onRelease: dragRelease,
    onClaimHaptic: claimHaptic,
    onThresholdHaptic: claimHaptic,
    disableVerticalSwipes: disableSwipesNow,
  });

  // Close gesture: swipe up on the open panel. At-top handoff (§2.2): the
  // internally-scrolled list keeps its scroll — the close-drag claims only
  // when the list can't scroll (or from the bottom grabber zone, which is
  // always a handle).
  useDockDrag(
    panelWrapEl,
    {
      direction: "up",
      canClaim: (startTarget) => {
        if (grabZoneEl.current && startTarget instanceof Node && grabZoneEl.current.contains(startTarget)) {
          return true;
        }
        const list = listEl.current;
        if (!list) return true;
        if (list.scrollTop > 0) return false;
        return list.scrollHeight - list.clientHeight <= 1;
      },
      onClaim: () => claimDrag("open"),
      onFrame: dragFrame,
      onRelease: dragRelease,
      onClaimHaptic: claimHaptic,
      onThresholdHaptic: claimHaptic,
      disableVerticalSwipes: disableSwipesNow,
    },
    mounted,
  );

  const handleSelect = useCallback((s: TmuxSessionInfo) => {
    haptic.selection();
    if (s.name !== active) onSelect(s.writable ? null : s.name);
    close();
  }, [active, onSelect, close]);

  const isOpenish = state === "open" || state === "opening";

  return (
    <div
      ref={rootEl}
      style={{
        display: "flex",
        alignItems: "stretch",
        borderBottom: "1px solid var(--color-border)",
        flexShrink: 0,
        position: "relative",
        zIndex: 30,
        background: "var(--color-bg)",
      }}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={openFromRowTap}
    >
      {/* Chip strip — scrolls x, left-anchored (absorbed SessionPicker).
          touch-action: pan-x is the gesture's CSS foundation (§2.2): the
          browser may own horizontal panning natively, but vertical moves
          stay cancelable by JS so the scrub can claim them. */}
      <div
        ref={chipStripEl}
        data-testid="session-picker"
        onClick={openFromRowTap}
        style={{
          display: "flex",
          gap: 6,
          padding: "6px 12px",
          overflowX: "auto",
          flex: 1,
          minWidth: 0,
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-x",
        }}
      >
        {displayed.map((s) => {
          const isActive = s.name === active;
          return (
            <button
              key={s.name}
              ref={(el) => registerIn(chipButtons.current, s.name, el)}
              type="button"
              onClick={() => {
                if (isActive) return;
                haptic.selection();
                onSelect(s.writable ? null : s.name);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "3px 10px",
                fontSize: 11,
                whiteSpace: "nowrap",
                flexShrink: 0,
                borderRadius: 999,
                cursor: "pointer",
                background: isActive ? "var(--color-surface)" : "none",
                color: isActive ? "var(--color-fg)" : "var(--color-muted)",
                border: isActive
                  ? "1px solid var(--color-accent-blue)"
                  : "1px solid var(--color-border)",
                fontWeight: isActive ? 600 : 400,
              }}
            >
              {/* FLIP shared element: dot + name, one node (§2.4). */}
              <span
                ref={(el) => registerIn(chipLabels.current, s.name, el)}
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: s.alive ? "var(--color-accent-green)" : "var(--color-subtle)",
                    display: "inline-block",
                  }}
                />
                {s.name}
              </span>
              {s.writable && (
                <span aria-label="writable session" style={{ marginLeft: 5 }}>&#9998;</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Trigger — right end, morphs ☰→✕ (§3.2). */}
      <button
        type="button"
        data-testid="session-list-button"
        aria-label={isOpenish ? "Close session list" : "Show all sessions in a list"}
        aria-expanded={isOpenish}
        onClick={toggle}
        style={{
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 13px",
          minWidth: 44,
          background: "none",
          border: "none",
          borderLeft: "1px solid var(--color-border)",
          cursor: "pointer",
          color: "var(--color-muted)",
          touchAction: "none",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "relative",
            width: 14,
            height: 10,
            display: "inline-block",
          }}
        >
          {/* three bars; outer pair rotates into the ✕, middle collapses —
              transform-only, 200ms */}
          <span style={{
            position: "absolute", left: 0, right: 0, top: 0, height: 2, borderRadius: 1,
            background: "currentColor",
            transition: "transform 200ms ease-out",
            transform: isOpenish ? "translateY(4px) rotate(45deg)" : "none",
          }} />
          <span style={{
            position: "absolute", left: 0, right: 0, top: 4, height: 2, borderRadius: 1,
            background: "currentColor",
            transition: "transform 200ms ease-out",
            transform: isOpenish ? "scaleX(0)" : "none",
          }} />
          <span style={{
            position: "absolute", left: 0, right: 0, top: 8, height: 2, borderRadius: 1,
            background: "currentColor",
            transition: "transform 200ms ease-out",
            transform: isOpenish ? "translateY(-4px) rotate(-45deg)" : "none",
          }} />
        </span>
      </button>

      {/* Grabber affordance — "this pulls", pointing down (§3.2). */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: 20,
          height: 3,
          borderRadius: 2,
          background: "var(--color-subtle)",
          pointerEvents: "none",
        }}
      />

      {mounted && (
        <>
          {/* Scrim — flat rgba layer over the terminal below the row. */}
          <div
            ref={scrimEl}
            data-testid="session-dock-scrim"
            onClick={close}
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              height: "100vh",
              background: "rgba(0, 0, 0, 1)",
              opacity: 0,
              zIndex: 1,
            }}
          />
          {/* Reveal window: the panel translates inside this overflow:hidden
              wrapper — pure transform, compositor-only (§2.4). */}
          <div
            ref={panelWrapEl}
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              overflow: "hidden",
              zIndex: 2,
              borderRadius: "0 0 16px 16px",
              pointerEvents: state === "open" ? "auto" : "none",
            }}
          >
            <div
              ref={panelEl}
              data-testid="session-dock-panel"
              aria-label="Terminal sessions"
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                background: "var(--color-bg-alt)",
                borderBottom: "1px solid var(--color-border-alt)",
                borderRadius: "0 0 16px 16px",
                transform: "translateY(-100%)",
                boxSizing: "border-box",
                paddingTop: PANEL_TOP_PAD,
              }}
            >
              <div
                ref={listEl}
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  touchAction: "pan-y",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {displayed.map((s) => (
                  <SessionListRow
                    key={s.name}
                    session={s}
                    isActive={s.name === active}
                    onSelect={handleSelect}
                    registerLabel={registerLabel}
                    registerFurniture={registerFurniture}
                  />
                ))}
              </div>
              {/* Bottom grabber — mirrors the row's, affords swipe-up-close;
                  always a valid close-drag handle even when the list scrolls. */}
              <div ref={grabZoneEl} style={{ display: "flex", justifyContent: "center", padding: "6px 0 9px", flexShrink: 0, touchAction: "none" }}>
                <div aria-hidden="true" style={{ width: 20, height: 3, borderRadius: 2, background: "var(--color-subtle)" }} />
              </div>
            </div>
          </div>
          {/* Flying-clone layer. */}
          <div
            ref={morphLayerEl}
            aria-hidden="true"
            style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 40 }}
          />
        </>
      )}
    </div>
  );
}
