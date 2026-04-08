import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

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
 *      outside it would otherwise defeat the check. We call `fs.realpathSync`
 *      on both the candidate and the root so the comparison happens on the
 *      real on-disk location. Non-existent paths cause `realpathSync` to
 *      throw, which we treat as a rejection.
 *
 * The function is intentionally synchronous: each callsite already does an
 * `await stat(...)` or `await readdir(...)` immediately after the check, so
 * using sync realpath here keeps the call pattern simple without changing the
 * route signatures.
 */

// Memoize realpath(root) results. Allowed roots are static config, so resolving
// them on every request is needless sync I/O on the hot path. We cache only on
// success — throws propagate uncached so a temporarily missing root retries on
// the next call.
const realRootCache = new Map<string, string>();

function getRealRoot(root: string): string {
  const key = resolve(root);
  const cached = realRootCache.get(key);
  if (cached !== undefined) return cached;
  const real = realpathSync(key);
  realRootCache.set(key, real);
  return real;
}

/** @internal Test-only hook to reset the memoization cache between cases. */
export function __resetRealRootCacheForTests(): void {
  realRootCache.clear();
}

export function isPathAllowed(absPath: string, allowedRoots: string[]): boolean {
  let realCandidate: string;
  try {
    realCandidate = realpathSync(resolve(absPath));
  } catch {
    // Non-existent path, broken symlink, or permission denied — reject.
    return false;
  }

  for (const root of allowedRoots) {
    let realRoot: string;
    try {
      realRoot = getRealRoot(root);
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
      return true;
    }
  }
  return false;
}
