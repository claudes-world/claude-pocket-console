import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  getPref,
  setPref,
  isAvailable,
  __resetForTests,
} from "../cloud-storage";

/**
 * Tests for the unified preferences wrapper. We exercise both backends:
 *
 *   1. The Telegram CloudStorage path, via a fake that mimics the async
 *      err-first-callback contract and holds values in a plain Map.
 *
 *   2. The localStorage fallback, using jsdom's built-in implementation.
 *
 * Notable behaviours under test:
 *
 * - Serialization of concurrent writes (two setPref against the same key
 *   must not lose the second write, and two setPref against DIFFERENT keys
 *   must both land in the final blob).
 * - Round-trip through the aggregate blob (stored under a single key).
 * - Graceful degradation when CloudStorage is absent / throws / reports
 *   isSupported() === false.
 * - Safe parsing of corrupt/non-object stored values.
 */

type Cb<T = void> = (err: Error | null | string, value?: T) => void;

interface FakeCloudStorageOptions {
  isSupported?: boolean;
  throwOnIsSupported?: boolean;
  failNextSet?: boolean;
  initial?: Record<string, string>;
}

function makeFakeCloudStorage(opts: FakeCloudStorageOptions = {}) {
  const store = new Map<string, string>(
    Object.entries(opts.initial ?? {}),
  );
  let failNextSet = opts.failNextSet ?? false;
  const cs = {
    isSupported: vi.fn(() => {
      if (opts.throwOnIsSupported) throw new Error("no");
      return opts.isSupported ?? true;
    }),
    getItem: vi.fn((key: string, cb: Cb<string>) => {
      // Async callback to match the real Telegram API, which uses
      // postMessage under the hood and never resolves synchronously.
      queueMicrotask(() => cb(null, store.get(key) ?? ""));
    }),
    setItem: vi.fn(
      (key: string, value: string, cb?: Cb<boolean>) => {
        queueMicrotask(() => {
          if (failNextSet) {
            failNextSet = false;
            cb?.(new Error("injected failure"));
            return;
          }
          store.set(key, value);
          cb?.(null, true);
        });
      },
    ),
    removeItem: vi.fn((key: string, cb?: (err: Error | null) => void) => {
      queueMicrotask(() => {
        store.delete(key);
        cb?.(null);
      });
    }),
    getKeys: vi.fn((cb: Cb<string[]>) => {
      queueMicrotask(() => cb(null, Array.from(store.keys())));
    }),
    __store: store,
  };
  return cs;
}

function installTelegram(cs: ReturnType<typeof makeFakeCloudStorage> | null) {
  // @ts-expect-error — test harness monkey-patch
  window.Telegram = cs ? { WebApp: { CloudStorage: cs } } : undefined;
}

beforeEach(() => {
  __resetForTests();
  localStorage.clear();
  installTelegram(null);
});

afterEach(() => {
  installTelegram(null);
  localStorage.clear();
});

describe("isAvailable()", () => {
  it("returns false when no Telegram global exists", () => {
    expect(isAvailable()).toBe(false);
  });

  it("returns true when CloudStorage.isSupported() returns true", () => {
    installTelegram(makeFakeCloudStorage({ isSupported: true }));
    expect(isAvailable()).toBe(true);
  });

  it("returns false when CloudStorage.isSupported() returns false", () => {
    installTelegram(makeFakeCloudStorage({ isSupported: false }));
    expect(isAvailable()).toBe(false);
  });

  it("returns false when CloudStorage.isSupported() throws", () => {
    installTelegram(makeFakeCloudStorage({ throwOnIsSupported: true }));
    expect(isAvailable()).toBe(false);
  });

  it("returns false when CloudStorage object is missing from WebApp", () => {
    // @ts-expect-error — test harness
    window.Telegram = { WebApp: {} };
    expect(isAvailable()).toBe(false);
  });

  it("returns false when CloudStorage has no isSupported function (absent = not supported)", () => {
    // An old polyfill might expose the CloudStorage object but omit isSupported.
    // We must treat absence as "not supported", NOT "assume yes".
    // @ts-expect-error — test harness: intentionally omitting isSupported
    window.Telegram = { WebApp: { CloudStorage: { getItem: () => {}, setItem: () => {} } } };
    expect(isAvailable()).toBe(false);
  });
});

describe("localStorage fallback", () => {
  it("returns the default when nothing is stored", async () => {
    expect(await getPref("foo", "default")).toBe("default");
  });

  it("round-trips a string value through localStorage", async () => {
    await setPref("greeting", "hello");
    __resetForTests();
    expect(await getPref("greeting", "fallback")).toBe("hello");
  });

  it("round-trips boolean, number, and object values", async () => {
    await setPref("flag", true);
    await setPref("count", 42);
    await setPref("obj", { a: 1, b: [2, 3] });
    __resetForTests();
    expect(await getPref("flag", false)).toBe(true);
    expect(await getPref("count", 0)).toBe(42);
    expect(await getPref("obj", {})).toEqual({ a: 1, b: [2, 3] });
  });

  it("stores all keys under a single aggregate localStorage key", async () => {
    await setPref("a", 1);
    await setPref("b", 2);
    await setPref("c", 3);
    // Exactly one CPC prefs key should exist — not one per setting.
    const cpcKeys = Object.keys(localStorage).filter((k) =>
      k.startsWith("cpc_dashboard_prefs"),
    );
    expect(cpcKeys).toEqual(["cpc_dashboard_prefs"]);
    const raw = localStorage.getItem("cpc_dashboard_prefs")!;
    expect(JSON.parse(raw)).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("recovers from corrupt JSON in localStorage by returning defaults", async () => {
    localStorage.setItem("cpc_dashboard_prefs", "{not valid json");
    expect(await getPref("anything", "dflt")).toBe("dflt");
  });

  it("ignores non-object stored values (arrays, primitives)", async () => {
    localStorage.setItem("cpc_dashboard_prefs", JSON.stringify([1, 2, 3]));
    expect(await getPref("x", "dflt")).toBe("dflt");
  });
});

describe("CloudStorage backend", () => {
  it("reads from Telegram CloudStorage when available", async () => {
    const cs = makeFakeCloudStorage({
      initial: {
        cpc_dashboard_prefs: JSON.stringify({ theme: "dark" }),
      },
    });
    installTelegram(cs);
    expect(await getPref("theme", "light")).toBe("dark");
    expect(cs.getItem).toHaveBeenCalledWith(
      "cpc_dashboard_prefs",
      expect.any(Function),
    );
  });

  it("writes go to CloudStorage, not localStorage", async () => {
    const cs = makeFakeCloudStorage();
    installTelegram(cs);
    await setPref("hidden", true);
    expect(cs.setItem).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("cpc_dashboard_prefs")).toBeNull();
    expect(cs.__store.get("cpc_dashboard_prefs")).toBe(
      JSON.stringify({ hidden: true }),
    );
  });

  it("de-duplicates concurrent first-load getItem calls", async () => {
    const cs = makeFakeCloudStorage({
      initial: { cpc_dashboard_prefs: JSON.stringify({ a: 1 }) },
    });
    installTelegram(cs);
    // Fire three reads in parallel before any resolve.
    const [a, b, c] = await Promise.all([
      getPref("a", 0),
      getPref("a", 0),
      getPref("a", 0),
    ]);
    expect([a, b, c]).toEqual([1, 1, 1]);
    // Exactly one underlying getItem call — subsequent reads hit the cache
    // or the in-flight loadPromise.
    expect(cs.getItem).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent writes against the same key without losing updates", async () => {
    const cs = makeFakeCloudStorage();
    installTelegram(cs);
    // Prime the snapshot so both writes see the same base.
    await getPref("counter", 0);
    await Promise.all([setPref("counter", 1), setPref("counter", 2)]);
    // Both writes must have been applied — final value is whichever ran
    // last (we guarantee ordering, not which one "wins" beyond that).
    expect(await getPref("counter", 0)).toBe(2);
    expect(cs.setItem).toHaveBeenCalledTimes(2);
  });

  it("serialized writes to different keys all land in the final blob", async () => {
    const cs = makeFakeCloudStorage();
    installTelegram(cs);
    await Promise.all([
      setPref("a", 1),
      setPref("b", 2),
      setPref("c", 3),
    ]);
    __resetForTests();
    // Rehydrate from cloud: all three keys must have survived.
    expect(await getPref("a", 0)).toBe(1);
    expect(await getPref("b", 0)).toBe(2);
    expect(await getPref("c", 0)).toBe(3);
  });

  it("propagates a setItem failure as a rejected setPref promise", async () => {
    const cs = makeFakeCloudStorage({ failNextSet: true });
    installTelegram(cs);
    await expect(setPref("x", "y")).rejects.toThrow("injected failure");
  });

  it("keeps the write queue alive after a failed write", async () => {
    const cs = makeFakeCloudStorage({ failNextSet: true });
    installTelegram(cs);
    // First write fails; second must still succeed.
    await expect(setPref("x", 1)).rejects.toThrow();
    await expect(setPref("x", 2)).resolves.toBeUndefined();
    expect(await getPref("x", 0)).toBe(2);
  });

  it("rejects writes whose serialized blob would exceed 4096 chars", async () => {
    const cs = makeFakeCloudStorage();
    installTelegram(cs);
    const huge = "x".repeat(5000);
    await expect(setPref("big", huge)).rejects.toThrow(/4096/);
  });

  it("returns defaults when cloud getItem reports an error", async () => {
    const cs = makeFakeCloudStorage();
    // Override getItem to error.
    cs.getItem.mockImplementation((_key, cb: Cb<string>) =>
      queueMicrotask(() => cb("not supported")),
    );
    installTelegram(cs);
    expect(await getPref("anything", "dflt")).toBe("dflt");
  });
});

describe("cache semantics", () => {
  it("does not re-read cloud storage on subsequent getPref calls", async () => {
    const cs = makeFakeCloudStorage({
      initial: { cpc_dashboard_prefs: JSON.stringify({ a: 1, b: 2 }) },
    });
    installTelegram(cs);
    await getPref("a", 0);
    await getPref("b", 0);
    await getPref("c", 99);
    expect(cs.getItem).toHaveBeenCalledTimes(1);
  });

  it("setPref updates the in-memory snapshot without requiring a re-read", async () => {
    const cs = makeFakeCloudStorage();
    installTelegram(cs);
    await setPref("a", 1);
    // getItem is called once inside the write path to prime the snapshot.
    const priorGetCalls = cs.getItem.mock.calls.length;
    expect(await getPref("a", 0)).toBe(1);
    expect(cs.getItem.mock.calls.length).toBe(priorGetCalls);
  });
});
