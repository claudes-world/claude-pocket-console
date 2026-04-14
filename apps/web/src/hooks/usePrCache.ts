import { useState, useCallback } from "react";

// Cache PR data in localStorage for instant render on app open (stale-while-revalidate).
// Uses localStorage (not the CloudStorage aggregate prefs blob from #231) because
// PR data can exceed the 4096-char CloudStorage value limit.

const CACHE_KEY = "cpc_pr_cache";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Types mirror PrTicker's internal types (copied here to avoid coupling)
interface PrRow {
  key: string;
  repo: string;
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  headRefName: string;
  author: string;
  reviewDecision: "APPROVED" | "REVIEW_REQUIRED" | "CHANGES_REQUESTED" | null;
  ciStatus: "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | null;
  url: string;
  updatedAt: string;
  firstSeen: number;
  lastChanged: number;
}

interface RepoSummary {
  name: string;
  dirName: string;
  org: string;
  fullName: string;
  branch: string;
  prCount: number;
}

export interface PrCacheEntry {
  prs: PrRow[];
  repos: RepoSummary[];
  cachedAt: number; // epoch ms
}

export interface UsePrCacheResult {
  cache: PrCacheEntry | null; // null = no cache yet
  isStale: boolean; // true if cache older than TTL
  saveCache: (prs: PrRow[], repos: RepoSummary[]) => void;
  clearCache: () => void;
}

export function readCache(): PrCacheEntry | null {
  // Exported for tests; not part of the public hook API
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as any).prs) ||
      !Array.isArray((parsed as any).repos) ||
      typeof (parsed as any).cachedAt !== "number"
    )
      return null;
    return parsed as PrCacheEntry;
  } catch {
    return null;
  }
}

export function usePrCache(): UsePrCacheResult {
  const [cache, setCache] = useState<PrCacheEntry | null>(() => readCache());

  const saveCache = useCallback((prs: PrRow[], repos: RepoSummary[]) => {
    const entry: PrCacheEntry = { prs, repos, cachedAt: Date.now() };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
    } catch {
      // quota exceeded — best-effort
    }
    setCache(entry);
  }, []);

  const clearCache = useCallback(() => {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      /* ignore */
    }
    setCache(null);
  }, []);

  const isStale = cache !== null && Date.now() - cache.cachedAt > CACHE_TTL_MS;

  return { cache, isStale, saveCache, clearCache };
}
