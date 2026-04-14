import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { usePreferences } from "../usePreferences";
import { __resetForTests } from "../../lib/cloud-storage";

/**
 * Integration tests for the usePreferences hook. We exercise the hook
 * against the localStorage fallback (no Telegram global installed) since
 * that path is deterministic under jsdom and covers the React-specific
 * behaviours we care about here: default-on-first-render, async load,
 * optimistic write, and key-change re-sync.
 *
 * The cloud-storage tests already cover the Telegram-backend async
 * callbacks — this file focuses on the hook contract.
 */

beforeEach(() => {
  __resetForTests();
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("usePreferences", () => {
  it("returns the default value on first render", () => {
    const { result } = renderHook(() =>
      usePreferences<boolean>("toggle", true),
    );
    expect(result.current[0]).toBe(true);
  });

  it("hydrates from storage after mount", async () => {
    // Seed localStorage with an existing blob.
    localStorage.setItem(
      "cpc_dashboard_prefs",
      JSON.stringify({ toggle: false }),
    );
    const { result } = renderHook(() =>
      usePreferences<boolean>("toggle", true),
    );
    // Initial render: default.
    expect(result.current[0]).toBe(true);
    // After the async load resolves, the stored value takes over.
    await waitFor(() => expect(result.current[0]).toBe(false));
  });

  it("updates state synchronously when setValue is called (optimistic)", async () => {
    const { result } = renderHook(() =>
      usePreferences<number>("count", 0),
    );
    await waitFor(() => expect(result.current[0]).toBe(0));
    act(() => {
      result.current[1](7);
    });
    expect(result.current[0]).toBe(7);
  });

  it("persists the written value so a fresh mount sees it", async () => {
    const first = renderHook(() =>
      usePreferences<string>("name", "anon"),
    );
    await waitFor(() => expect(first.result.current[0]).toBe("anon"));
    act(() => {
      first.result.current[1]("liam");
    });
    // Wait for the write to drain to the backend.
    await waitFor(() => {
      const raw = localStorage.getItem("cpc_dashboard_prefs");
      expect(raw && JSON.parse(raw).name).toBe("liam");
    });

    first.unmount();
    __resetForTests();

    const second = renderHook(() =>
      usePreferences<string>("name", "anon"),
    );
    await waitFor(() => expect(second.result.current[0]).toBe("liam"));
  });

  it("does not re-fire the storage load on default-value identity changes", async () => {
    // Re-rendering with a fresh default object literal must NOT overwrite
    // the loaded value — the default is captured on first render.
    localStorage.setItem(
      "cpc_dashboard_prefs",
      JSON.stringify({ list: ["a", "b"] }),
    );
    const { result, rerender } = renderHook(
      ({ def }: { def: string[] }) =>
        usePreferences<string[]>("list", def),
      { initialProps: { def: [] as string[] } },
    );
    await waitFor(() =>
      expect(result.current[0]).toEqual(["a", "b"]),
    );
    rerender({ def: ["fresh", "default"] });
    // Stored value must still win after the rerender.
    expect(result.current[0]).toEqual(["a", "b"]);
  });

  it("re-loads when the key prop changes", async () => {
    localStorage.setItem(
      "cpc_dashboard_prefs",
      JSON.stringify({ alpha: 1, beta: 2 }),
    );
    const { result, rerender } = renderHook(
      ({ k }: { k: string }) => usePreferences<number>(k, 0),
      { initialProps: { k: "alpha" } },
    );
    await waitFor(() => expect(result.current[0]).toBe(1));
    rerender({ k: "beta" });
    await waitFor(() => expect(result.current[0]).toBe(2));
  });

  it("concurrent writes from two hooks against different keys both persist", async () => {
    const h1 = renderHook(() =>
      usePreferences<boolean>("a", false),
    );
    const h2 = renderHook(() =>
      usePreferences<boolean>("b", false),
    );
    await waitFor(() => expect(h1.result.current[0]).toBe(false));
    await waitFor(() => expect(h2.result.current[0]).toBe(false));
    act(() => {
      h1.result.current[1](true);
      h2.result.current[1](true);
    });
    await waitFor(() => {
      const raw = localStorage.getItem("cpc_dashboard_prefs");
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed).toEqual({ a: true, b: true });
    });
  });
});
