import { describe, expect, it } from "vitest";
import { resolveSessionPickerProps } from "../session-picker";
import type { TmuxSessionInfo } from "../../components/SessionPicker";

const mkSession = (overrides: Partial<TmuxSessionInfo> = {}): TmuxSessionInfo => ({
  name: "default",
  attached: true,
  activity: 0,
  command: "bash",
  alive: true,
  writable: true,
  ...overrides,
});

/**
 * Round-2 review (PR #299): resolveSessionPickerProps is the extracted,
 * unit-testable core of App.tsx's session-picker visibility logic. The bug
 * was an extra `sessionList.length > 0` guard that hid the picker (and its
 * escape-hatch pill back to the default session) whenever the roster fetch
 * failed or returned empty while a stale `#terminal&session=...` deep link
 * was active — exactly the moment the user most needed a way back.
 */
describe("resolveSessionPickerProps", () => {
  it("hides the picker with no sessions and no active deep link", () => {
    const r = resolveSessionPickerProps([], null, null);
    expect(r.visible).toBe(false);
    expect(r.sessions).toEqual([]);
  });

  it("hides the picker with exactly one known session and no deep link", () => {
    const r = resolveSessionPickerProps([mkSession()], null, "default");
    expect(r.visible).toBe(false);
  });

  it("shows the real roster when there's more than one session", () => {
    const sessions = [mkSession({ name: "default" }), mkSession({ name: "other", writable: false })];
    const r = resolveSessionPickerProps(sessions, null, "default");
    expect(r.visible).toBe(true);
    expect(r.sessions).toBe(sessions);
  });

  it("shows the real roster when a deep link names a session the roster knows", () => {
    const sessions = [mkSession({ name: "default" }), mkSession({ name: "other", writable: false })];
    const r = resolveSessionPickerProps(sessions, "other", "default");
    expect(r.visible).toBe(true);
    expect(r.sessions).toBe(sessions);
  });

  it("THE FIX: still renders an escape-hatch pill when the roster fetch failed (empty list) but a stale deep link is active", () => {
    // This is the exact strand scenario from the review comment: a hash
    // deep link names a non-default session, but /api/terminal/sessions
    // never resolved (or returned an empty roster), so sessionList is [].
    // The old `&& sessionList.length > 0` guard hid the picker entirely
    // here — the fix must still return visible: true with a synthesized
    // pill the user can click to get back to the default.
    const r = resolveSessionPickerProps([], "stale-unknown-session", null);
    expect(r.visible).toBe(true);
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0].writable).toBe(true);
    // Not equal to the stale session name — otherwise the synthesized pill
    // would render as "already active" and clicking it would no-op instead
    // of clearing activeSession back to the default.
    expect(r.sessions[0].name).not.toBe("stale-unknown-session");
  });

  it("synthesized pill uses the known default session name once it resolves", () => {
    const r = resolveSessionPickerProps([], "stale-unknown-session", "my-default");
    expect(r.visible).toBe(true);
    expect(r.sessions[0].name).toBe("my-default");
  });
});
