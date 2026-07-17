/**
 * Session dock state machine (WORLD-416 §2.3), pure and unit-tested.
 *
 * PR-C ships the tap-only subset; the drag states (`dragging`,
 * `dragging-close`) arrive with the gesture in PR-D and extend this same
 * reducer. `settling-*` phases map to "opening"/"closing" here — they ignore
 * nothing: a toggle mid-settle reverses from the current progress
 * (interruptible animations are what "buttery" actually means).
 */

export type DockState = "closed" | "opening" | "open" | "closing";

export type DockEvent =
  /** trigger tap — toggles */
  | "toggle"
  /** programmatic open request (tap on the row background) */
  | "open"
  /** scrim tap / session selected / explicit dismiss */
  | "close"
  /** the settle animation reached its target */
  | "settled";

export function nextDockState(state: DockState, event: DockEvent): DockState {
  switch (event) {
    case "toggle":
      return state === "closed" || state === "closing" ? "opening" : "closing";
    case "open":
      return state === "open" ? state : "opening";
    case "close":
      return state === "closed" ? state : "closing";
    case "settled":
      if (state === "opening") return "open";
      if (state === "closing") return "closed";
      return state;
  }
}

/** The roster may not reorder under the user (§2.3 guard): displayed order
 *  is frozen except when fully closed. */
export function mayReconcileRoster(state: DockState): boolean {
  return state === "closed";
}
