/**
 * Session dock state machine (WORLD-416 §2.3), pure and unit-tested.
 *
 * `settling-*` phases map to "opening"/"closing" here — they ignore
 * nothing: a toggle mid-settle reverses from the current progress, and a
 * touch mid-settle grabs the panel at its current p ("drag-claim" is legal
 * from every state — interruptible animations are what "buttery" actually
 * means). One `dragging` state covers both the open-scrub from the row and
 * the close-scrub from the panel: the drag context (anchor) lives with the
 * gesture, only the release decides which way the machine settles.
 */

export type DockState = "closed" | "opening" | "open" | "closing" | "dragging";

export type DockEvent =
  /** trigger tap — toggles */
  | "toggle"
  /** programmatic open request (tap on the row background) */
  | "open"
  /** scrim tap / session selected / explicit dismiss */
  | "close"
  /** the settle animation reached its target */
  | "settled"
  /** a touch claimed the vertical axis (row or panel surface) */
  | "drag-claim"
  /** finger lifted, committing toward open */
  | "drag-release-open"
  /** finger lifted, committing toward closed */
  | "drag-release-close";

export function nextDockState(state: DockState, event: DockEvent): DockState {
  switch (event) {
    case "toggle":
      if (state === "dragging") return state;
      return state === "closed" || state === "closing" ? "opening" : "closing";
    case "open":
      return state === "open" || state === "dragging" ? state : "opening";
    case "close":
      return state === "closed" || state === "dragging" ? state : "closing";
    case "settled":
      if (state === "opening") return "open";
      if (state === "closing") return "closed";
      return state;
    case "drag-claim":
      return "dragging";
    case "drag-release-open":
      return state === "dragging" ? "opening" : state;
    case "drag-release-close":
      return state === "dragging" ? "closing" : state;
  }
}

/** The roster may not reorder under the user (§2.3 guard): displayed order
 *  is frozen except when fully closed. */
export function mayReconcileRoster(state: DockState): boolean {
  return state === "closed";
}
