import type { TmuxSessionInfo } from "../components/SessionPicker";

export interface SessionPickerVisibility {
  /** Whether the picker should render at all. */
  visible: boolean;
  /** Sessions to hand to <SessionPicker>. Only meaningful when visible. */
  sessions: TmuxSessionInfo[];
}

/**
 * Decide whether the terminal tab's SessionPicker renders, and what session
 * list to give it.
 *
 * Renders when there's an actual choice (more than one known session) OR a
 * hash deep-link points at a non-default session (`activeSession !== null`)
 * — that second case is the escape hatch for a stale `#terminal&session=...`
 * link: the picker gives the user a pill back to the default even for a
 * session name the roster doesn't recognize.
 *
 * Round-2 review (PR #299): an earlier version additionally required
 * `sessionList.length > 0` to render at all, which defeated exactly that
 * escape hatch whenever `/api/terminal/sessions` failed (or returned an
 * empty roster) while a stale session was active — the user was stranded on
 * the error frame with literally no picker on screen. When the roster is
 * empty but there's still a non-default `activeSession` to escape from, this
 * synthesizes a single "default" pill instead of hiding the picker.
 */
export function resolveSessionPickerProps(
  sessionList: TmuxSessionInfo[],
  activeSession: string | null,
  defaultSession: string | null,
): SessionPickerVisibility {
  const visible = sessionList.length > 1 || activeSession !== null;
  if (!visible) return { visible: false, sessions: [] };
  if (sessionList.length > 0) return { visible: true, sessions: sessionList };
  return {
    visible: true,
    sessions: [
      {
        // The literal `name` here is cosmetic label text only — it is NOT
        // used to target a tmux session. SessionPicker's onClick calls
        // `onSelect(s.writable ? null : s.name)`, and this synthesized
        // entry is always `writable: true`, so clicking it always calls
        // `onSelect(null)` — the "view the server default" sentinel — never
        // `onSelect("default")`. That's true even before `defaultSession`
        // has resolved (name falls back to the string "default" purely for
        // display), so there is no risk of targeting a literal, possibly
        // nonexistent, session named "default" (reviewed as a candidate
        // bug in round-2, confirmed false positive against SessionPicker's
        // actual click handler).
        name: defaultSession ?? "default",
        attached: false,
        activity: 0,
        command: "",
        alive: true,
        writable: true,
      },
    ],
  };
}
