import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionDock } from "../SessionDock";
import type { TmuxSessionInfo } from "../../lib/session-meta";

/**
 * SessionDock (WORLD-416 §2–3), tap-only scope: closed/open rendering,
 * trigger toggling with aria-expanded, select semantics (the PR #299
 * escape-hatch sentinel), scrim close, freeze-order guard, reduced-motion
 * path. The drag gesture is PR-D and tested via useDockDrag.
 */

vi.mock("../../lib/haptic", () => ({
  haptic: { selection: vi.fn(), impact: vi.fn() },
}));
vi.mock("../../lib/telegram", () => ({
  getTelegramWebApp: () => null,
}));

const session = (name: string, over: Partial<TmuxSessionInfo> = {}): TmuxSessionInfo => ({
  name,
  attached: false,
  activity: 0,
  command: "claude",
  alive: true,
  writable: false,
  ...over,
});

const ROSTER = [
  session("claudes-world", { writable: true }),
  session("do-box--lane-a"),
  session("do-box--lane-b", { command: "bash", alive: false }),
];

const openDock = async () => {
  fireEvent.click(screen.getByTestId("session-list-button"));
  await waitFor(() =>
    expect(screen.getByTestId("session-list-button").getAttribute("aria-expanded")).toBe("true"),
  );
  // settle: rows become interactive once the state machine reaches "open"
  await waitFor(() =>
    expect(screen.getByTestId("session-dock-panel").parentElement!.style.pointerEvents).toBe("auto"),
  );
};

describe("SessionDock", () => {
  it("renders the chip strip closed, with the trigger on the right and no panel", () => {
    render(<SessionDock sessions={ROSTER} active="claudes-world" onSelect={vi.fn()} />);
    expect(screen.getByTestId("session-picker")).toBeTruthy();
    const trigger = screen.getByTestId("session-list-button");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("session-dock-panel")).toBeNull();
    // trigger sits AFTER the strip in the row (right end)
    const row = screen.getByTestId("session-picker").parentElement!;
    const kids = [...row.children];
    expect(kids.indexOf(screen.getByTestId("session-picker")))
      .toBeLessThan(kids.indexOf(trigger));
  });

  it("chip tap selects with the writable→null sentinel (PR #299)", () => {
    const onSelect = vi.fn();
    render(<SessionDock sessions={ROSTER} active="do-box--lane-a" onSelect={onSelect} />);
    fireEvent.click(screen.getByText("claudes-world"));
    expect(onSelect).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByText("do-box--lane-b"));
    expect(onSelect).toHaveBeenCalledWith("do-box--lane-b");
  });

  it("trigger tap opens the panel with rows for every session, then closes", async () => {
    render(<SessionDock sessions={ROSTER} active="claudes-world" onSelect={vi.fn()} />);
    await openDock();
    const rows = screen.getAllByTestId("session-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("claudes-world");
    // dead session subtitle
    expect(rows[2].textContent).toContain("ended");

    fireEvent.click(screen.getByTestId("session-list-button"));
    await waitFor(() => expect(screen.queryByTestId("session-dock-panel")).toBeNull());
    expect(screen.getByTestId("session-list-button").getAttribute("aria-expanded")).toBe("false");
  });

  it("row select fires the sentinel semantics and closes", async () => {
    const onSelect = vi.fn();
    render(<SessionDock sessions={ROSTER} active="do-box--lane-a" onSelect={onSelect} />);
    await openDock();
    const rows = screen.getAllByTestId("session-row");
    fireEvent.click(rows[0]); // writable default
    expect(onSelect).toHaveBeenCalledWith(null);
    await waitFor(() => expect(screen.queryByTestId("session-dock-panel")).toBeNull());
  });

  it("selecting the already-active row closes without selecting", async () => {
    const onSelect = vi.fn();
    render(<SessionDock sessions={ROSTER} active="do-box--lane-a" onSelect={onSelect} />);
    await openDock();
    fireEvent.click(screen.getAllByTestId("session-row")[1]);
    expect(onSelect).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("session-dock-panel")).toBeNull());
  });

  it("scrim tap closes", async () => {
    render(<SessionDock sessions={ROSTER} active="claudes-world" onSelect={vi.fn()} />);
    await openDock();
    fireEvent.click(screen.getByTestId("session-dock-scrim"));
    await waitFor(() => expect(screen.queryByTestId("session-dock-panel")).toBeNull());
  });

  it("freezes the displayed roster while open and reconciles after close", async () => {
    const { rerender } = render(
      <SessionDock sessions={ROSTER} active="claudes-world" onSelect={vi.fn()} />,
    );
    await openDock();

    const reordered = [ROSTER[2], ROSTER[0], ROSTER[1]];
    rerender(<SessionDock sessions={reordered} active="claudes-world" onSelect={vi.fn()} />);
    // still frozen in the pre-refresh order
    let rows = screen.getAllByTestId("session-row");
    expect(rows[0].textContent).toContain("claudes-world");

    fireEvent.click(screen.getByTestId("session-dock-scrim"));
    await waitFor(() => expect(screen.queryByTestId("session-dock-panel")).toBeNull());

    // reconciled on settle-closed: chips now lead with the refreshed order
    const strip = screen.getByTestId("session-picker");
    expect(strip.textContent!.indexOf("do-box--lane-b"))
      .toBeLessThan(strip.textContent!.indexOf("claudes-world"));
  });

  it("reduced motion: opens with no transform styles on rows or furniture", async () => {
    const mql = (matches: boolean) => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("matchMedia", vi.fn((q: string) =>
      mql(q.includes("prefers-reduced-motion"))));
    try {
      render(<SessionDock sessions={ROSTER} active="claudes-world" onSelect={vi.fn()} />);
      await openDock();
      for (const row of screen.getAllByTestId("session-row")) {
        for (const el of row.querySelectorAll<HTMLElement>("*")) {
          expect(el.style.transform).not.toContain("translate");
        }
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
