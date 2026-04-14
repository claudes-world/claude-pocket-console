/**
 * Unified preferences storage backed by Telegram Bot API 8.0+ CloudStorage
 * with a localStorage fallback for older clients / non-Telegram contexts
 * (e.g. the browser dev view at cpc.claude.do/dev/).
 *
 * Design decisions (see also ~/code/claude-pocket-console ADR TBD):
 *
 * 1. ONE aggregate key holds a JSON blob for all dashboard prefs.
 *    Telegram's CloudStorage enforces a 1024-key-per-user-per-bot quota, and
 *    one feature request churn can easily burn through dozens of keys if we
 *    naïvely shard by preference name. Instead we keep everything under a
 *    single `cpc_dashboard_prefs` key and JSON-stringify a flat record.
 *
 * 2. Same shape for both backends. When CloudStorage is unavailable we store
 *    the identical JSON blob under the same key in localStorage, which means
 *    a user who starts in a legacy client and later upgrades sees their
 *    settings migrate organically the first time setPref() runs on the new
 *    client (the write path reads-modifies-writes and upgrades the backing
 *    store as a side effect).
 *
 * 3. All writes go through a single in-flight promise (`writeQueue`). The
 *    Telegram CloudStorage API is async and two concurrent setPref() calls
 *    against the same aggregate key would race: both read the old blob,
 *    each writes its own mutation, the second write clobbers the first.
 *    Serializing writes is correct-by-construction and much simpler than
 *    CRDTs for a key-value preferences store.
 *
 * 4. In-memory snapshot cache. After the first load we keep the parsed blob
 *    in memory so subsequent getPref() calls are synchronous-ish (still
 *    returned via a resolved Promise to keep the API uniform). The snapshot
 *    is invalidated on every successful write.
 *
 * 5. Missing keys in CloudStorage return `''` (empty string), NOT null or
 *    undefined. We treat empty-string-or-missing identically: if JSON.parse
 *    throws or yields a non-object, we start from {}.
 */

const AGGREGATE_KEY = "cpc_dashboard_prefs";

interface TelegramCloudStorage {
  isSupported?: () => boolean;
  getItem: (
    key: string,
    callback: (err: Error | null | string, value?: string) => void,
  ) => void;
  setItem: (
    key: string,
    value: string,
    callback?: (err: Error | null | string, success?: boolean) => void,
  ) => void;
  // Not used today but declared for completeness.
  removeItem?: (key: string, callback?: (err: Error | null) => void) => void;
  getKeys?: (
    callback: (err: Error | null | string, keys?: string[]) => void,
  ) => void;
}

interface TelegramWebAppWithCloudStorage {
  CloudStorage?: TelegramCloudStorage;
}

type PrefBlob = Record<string, unknown>;

// Module-level state. Both caches hold the SAME shape: the parsed aggregate
// blob. `snapshot` is authoritative once loaded; `loadPromise` de-duplicates
// concurrent first-load calls; `writeQueue` serializes writes.
let snapshot: PrefBlob | null = null;
let loadPromise: Promise<PrefBlob> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Returns the CloudStorage handle if the current Telegram client advertises
 * Bot API 8.0+ support, otherwise null. Safe to call on any platform — the
 * chain of optional accesses returns undefined when there's no Telegram
 * global at all (plain browser dev view).
 */
function getCloudStorage(): TelegramCloudStorage | null {
  const webapp = (window.Telegram?.WebApp ?? null) as
    | TelegramWebAppWithCloudStorage
    | null;
  const cs = webapp?.CloudStorage;
  if (!cs) return null;
  // isSupported is a Telegram-level capability probe; when absent we assume
  // "not supported" rather than "assume yes" so old polyfills don't false-
  // positive. We require the function to be present AND return true — if it's
  // missing the client hasn't declared Bot API 8.0 support so we reject.
  try {
    if (typeof cs.isSupported !== "function" || !cs.isSupported()) return null;
  } catch {
    return null;
  }
  return cs;
}

export function isAvailable(): boolean {
  return getCloudStorage() !== null;
}

function safeParse(raw: string | undefined | null): PrefBlob {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as PrefBlob;
    }
  } catch {
    /* fall through to empty */
  }
  return {};
}

function readFromLocalStorage(): PrefBlob {
  try {
    return safeParse(localStorage.getItem(AGGREGATE_KEY));
  } catch {
    return {};
  }
}

function writeToLocalStorage(blob: PrefBlob): void {
  try {
    localStorage.setItem(AGGREGATE_KEY, JSON.stringify(blob));
  } catch {
    /* quota exceeded / private-mode Safari — best-effort */
  }
}

function readFromCloud(cs: TelegramCloudStorage): Promise<PrefBlob> {
  return new Promise((resolve) => {
    cs.getItem(AGGREGATE_KEY, (err, value) => {
      // Telegram's callback contract uses err-as-string for "not supported"
      // shaped failures and Error for other clients. Either way we degrade
      // to an empty blob rather than reject — callers have no good recovery
      // path for a storage-read failure other than "use defaults".
      if (err) {
        resolve({});
        return;
      }
      resolve(safeParse(value));
    });
  });
}

function writeToCloud(cs: TelegramCloudStorage, blob: PrefBlob): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(blob);
    // Telegram enforces a 4096-char limit per value. If we blow past that the
    // API would fail silently — surface it as a rejection so getPref callers
    // aren't stuck returning stale snapshots. Extremely unlikely to hit in
    // practice since our prefs are flat booleans/short strings/small arrays.
    if (payload.length > 4096) {
      reject(
        new Error(
          `cloud-storage: aggregate prefs blob exceeds 4096 chars (got ${payload.length})`,
        ),
      );
      return;
    }
    cs.setItem(AGGREGATE_KEY, payload, (err) => {
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      resolve();
    });
  });
}

/**
 * Load the aggregate blob, populating the module-level snapshot. Concurrent
 * callers share a single in-flight promise so a dashboard that mounts ten
 * components at once fires exactly one getItem() call.
 */
function loadSnapshot(): Promise<PrefBlob> {
  if (snapshot !== null) return Promise.resolve(snapshot);
  if (loadPromise) return loadPromise;
  const cs = getCloudStorage();
  loadPromise = (async () => {
    const blob = cs ? await readFromCloud(cs) : readFromLocalStorage();
    snapshot = blob;
    return blob;
  })();
  // Clear the in-flight ref once settled so a subsequent resetForTests() or
  // explicit invalidation can re-fetch.
  void loadPromise.finally(() => {
    loadPromise = null;
  });
  return loadPromise;
}

/**
 * Read a preference by key. Returns the stored value or the supplied default
 * if the key is missing or the stored value is of the wrong shape.
 *
 * Type parameter T is a hint for the caller — we do NOT runtime-validate the
 * stored value against T because that would require a schema library. For
 * booleans/strings/numbers the caller should pass a default of the right
 * type and optionally narrow with a typeof check downstream.
 */
export async function getPref<T>(key: string, defaultValue: T): Promise<T> {
  const blob = await loadSnapshot();
  const val = blob[key];
  if (val === undefined) return defaultValue;
  return val as T;
}

/**
 * Write a preference by key. Serializes against other writes so the read-
 * modify-write sequence can't be interleaved by a concurrent caller.
 *
 * On write failure (e.g., quota exceeded, network error), the rejection
 * propagates to the caller but the in-memory snapshot remains at the
 * pre-failure state — the failed key's new value is NOT reflected. A
 * subsequent successful write will NOT include the failed key's value unless
 * the caller retries. Callers must retry failed writes explicitly if
 * persistence is critical.
 */
export function setPref<T>(key: string, value: T): Promise<void> {
  const next = writeQueue.then(async () => {
    // Ensure we have the current blob before mutating. We deliberately call
    // loadSnapshot() inside the queue so even the FIRST write after page
    // load sees a consistent base.
    const blob = await loadSnapshot();
    const updated: PrefBlob = { ...blob, [key]: value };
    const cs = getCloudStorage();
    if (cs) {
      await writeToCloud(cs, updated);
    } else {
      writeToLocalStorage(updated);
    }
    snapshot = updated;
  });
  // Chain the next write regardless of this one's success — a single failed
  // write shouldn't permanently deadlock the queue. We swallow the error on
  // the queue's internal chain but re-expose it on the returned promise.
  writeQueue = next.catch(() => {
    /* keep the queue alive */
  });
  return next;
}

/**
 * Test-only hook. Exported so unit tests can reset module state between
 * cases without needing vi.resetModules() (which is expensive). NOT intended
 * for production callers.
 */
export function __resetForTests(): void {
  snapshot = null;
  loadPromise = null;
  writeQueue = Promise.resolve();
}
