import { beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePrCache, readCache } from "../usePrCache";

// ---- localStorage mock ----

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
  localStorageMock.clear();
});

// ---- Helpers ----

const CACHE_KEY = "cpc_pr_cache";

function makePr(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    key: "repo/pr/1",
    repo: "org/repo",
    number: 1,
    title: "Test PR",
    state: "OPEN" as const,
    isDraft: false,
    headRefName: "feat/test",
    author: "alice",
    reviewDecision: null,
    ciStatus: null,
    url: "https://github.com/org/repo/pull/1",
    updatedAt: new Date().toISOString(),
    firstSeen: Date.now(),
    lastChanged: Date.now(),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: "repo",
    dirName: "repo",
    org: "org",
    fullName: "org/repo",
    branch: "main",
    prCount: 1,
    ...overrides,
  };
}

// ---- Tests ----

describe("readCache", () => {
  it("returns null when localStorage is empty", () => {
    expect(readCache()).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    localStorageMock.setItem(CACHE_KEY, "not-valid-json{{{");
    expect(readCache()).toBeNull();
  });

  it("returns null when prs field is missing", () => {
    localStorageMock.setItem(
      CACHE_KEY,
      JSON.stringify({ repos: [], cachedAt: Date.now() }),
    );
    expect(readCache()).toBeNull();
  });

  it("returns null when repos field is missing", () => {
    localStorageMock.setItem(
      CACHE_KEY,
      JSON.stringify({ prs: [], cachedAt: Date.now() }),
    );
    expect(readCache()).toBeNull();
  });

  it("returns null when cachedAt is not a number", () => {
    localStorageMock.setItem(
      CACHE_KEY,
      JSON.stringify({ prs: [], repos: [], cachedAt: "2025-01-01" }),
    );
    expect(readCache()).toBeNull();
  });

  it("returns the parsed entry for a valid cache", () => {
    const entry = { prs: [makePr()], repos: [makeRepo()], cachedAt: Date.now() };
    localStorageMock.setItem(CACHE_KEY, JSON.stringify(entry));
    const result = readCache();
    expect(result).not.toBeNull();
    expect(result!.prs).toHaveLength(1);
    expect(result!.repos).toHaveLength(1);
  });
});

describe("usePrCache", () => {
  it("returns null cache when localStorage is empty", () => {
    const { result } = renderHook(() => usePrCache());
    expect(result.current.cache).toBeNull();
  });

  it("initialises from existing localStorage on mount", () => {
    const entry = { prs: [makePr()], repos: [makeRepo()], cachedAt: Date.now() };
    localStorageMock.setItem(CACHE_KEY, JSON.stringify(entry));
    const { result } = renderHook(() => usePrCache());
    expect(result.current.cache).not.toBeNull();
    expect(result.current.cache!.prs).toHaveLength(1);
  });

  it("saveCache persists to localStorage and updates state", () => {
    const { result } = renderHook(() => usePrCache());
    expect(result.current.cache).toBeNull();

    const prs = [makePr()];
    const repos = [makeRepo()];
    act(() => {
      result.current.saveCache(prs, repos);
    });

    expect(result.current.cache).not.toBeNull();
    expect(result.current.cache!.prs).toHaveLength(1);
    expect(result.current.cache!.repos).toHaveLength(1);

    // Verify it was written to localStorage
    const stored = localStorageMock.getItem(CACHE_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.prs).toHaveLength(1);
  });

  it("clearCache removes from localStorage and sets cache to null", () => {
    const entry = { prs: [makePr()], repos: [makeRepo()], cachedAt: Date.now() };
    localStorageMock.setItem(CACHE_KEY, JSON.stringify(entry));

    const { result } = renderHook(() => usePrCache());
    expect(result.current.cache).not.toBeNull();

    act(() => {
      result.current.clearCache();
    });

    expect(result.current.cache).toBeNull();
    expect(localStorageMock.getItem(CACHE_KEY)).toBeNull();
  });

  it("isStale is false for a fresh entry (cachedAt = now)", () => {
    const { result } = renderHook(() => usePrCache());
    act(() => {
      result.current.saveCache([makePr()], [makeRepo()]);
    });
    expect(result.current.isStale).toBe(false);
  });

  it("isStale is true for an entry older than 1 hour", () => {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const old = Date.now() - ONE_HOUR_MS - 1000; // 1h + 1s ago
    const entry = { prs: [makePr()], repos: [makeRepo()], cachedAt: old };
    localStorageMock.setItem(CACHE_KEY, JSON.stringify(entry));

    const { result } = renderHook(() => usePrCache());
    expect(result.current.isStale).toBe(true);
  });

  it("isStale is false when cache is null", () => {
    const { result } = renderHook(() => usePrCache());
    expect(result.current.cache).toBeNull();
    expect(result.current.isStale).toBe(false);
  });
});
