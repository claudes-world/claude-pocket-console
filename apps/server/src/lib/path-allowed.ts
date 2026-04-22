import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { getTracer } from "./otel.js";
import { SpanStatusCode } from "@opentelemetry/api";

/**
 * Check whether an absolute path is contained within any of the allowed root
 * directories, enforcing a true path-segment boundary and resolving symlinks.
 *
 * Hardened against two classes of bypass:
 *
 *   1. Sibling-prefix bypass: `/home/claude/code-evil/x` must NOT match the
 *      root `/home/claude/code`. A naive `startsWith(root)` check would let it
 *      through. We require an exact match OR a `root + path.sep` prefix so the
 *      boundary lands on a real path separator.
 *
 *   2. Symlink escape: a symlink that lives inside an allowed root but points
 *      outside it would otherwise defeat the check. We call `fs.promises.realpath`
 *      on both the candidate and the root so the comparison happens on the
 *      real on-disk location. Non-existent paths cause `realpath` to
 *      reject, which we treat as a rejection.
 *
 * The function is async so that realpath resolution never blocks the event
 * loop, which matters under concurrent load and avoids a DoS vector.
 */

// Memoize realpath(root) results by caching the Promise itself. Allowed roots
// are static config, so resolving them on every request is needless I/O.
// Caching the Promise (not just the resolved string) ensures concurrent
// requests for the same uncached root share a single in-flight call.
// If the Promise rejects, the entry is removed so the next request retries
// (e.g. if a root was temporarily missing). A guard prevents a delayed
// rejection from evicting a newer entry added after a cache clear.
const realRootCache = new Map<string, Promise<string>>();

const pathTracer = getTracer('cpc-server-security');

export const ALLOWED_FILE_ROOTS = [
  "/home/claude/claudes-world",
  "/home/claude/code",
  "/home/claude/bin",
  "/home/claude/.claude",
  "/home/claude/claudes-world/.claude",
  "/home/claude/.world",
] as const;


function getRealRoot(root: string): Promise<string> {
  const key = resolve(root);
  const cached = realRootCache.get(key);
  if (cached !== undefined) return cached;
  const p = realpath(key);
  p.catch(() => {
    // Only evict if this exact Promise is still the cached entry so that a
    // delayed rejection from a stale call cannot remove a newer entry.
    if (realRootCache.get(key) === p) realRootCache.delete(key);
  });
  realRootCache.set(key, p);
  return p;
}

/**
 * @internal Test-only hook to reset the memoization cache between cases.
 * Gated behind NODE_ENV === "test" so accidental production calls throw
 * instead of silently clearing the cache on a live process.
 */
export function __resetRealRootCacheForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "__resetRealRootCacheForTests may only be called with NODE_ENV=test",
    );
  }
  realRootCache.clear();
}

export async function isPathAllowed(
  absPath: string,
  allowedRoots: readonly string[],
): Promise<boolean> {
  const span = pathTracer.startSpan('security.path_check', {
    attributes: { 'path.root_count': allowedRoots.length },
  });
  try {
    let realCandidate: string;
    try {
      realCandidate = await realpath(resolve(absPath));
    } catch {
      // Non-existent path, broken symlink, or permission denied — reject.
      span.setAttribute('path.allowed', false);
      return false;
    }

    for (const root of allowedRoots) {
      let realRoot: string;
      try {
        realRoot = await getRealRoot(root);
      } catch {
        // Allowed root is missing on disk — skip, don't let it match anything.
        continue;
      }
      // When realRoot is the filesystem root (e.g. `/` on Unix, `C:\` on
      // Windows), `realRoot + sep` yields `//` or `C:\\`, which no valid
      // child path starts with. Only append a separator if the root doesn't
      // already end with one.
      const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
      if (realCandidate === realRoot || realCandidate.startsWith(rootWithSep)) {
        span.setAttribute('path.allowed', true);
        return true;
      }
    }
    span.setAttribute('path.allowed', false);
    return false;
  } catch (err) {
    span.recordException(err instanceof Error ? err : String(err));
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw err;
  } finally {
    span.end();
  }
}
