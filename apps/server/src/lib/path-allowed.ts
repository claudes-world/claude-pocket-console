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
      realRoot = realpathSync(resolve(root));
    } catch {
      // Allowed root is missing on disk — skip, don't let it match anything.
      continue;
    }
    if (realCandidate === realRoot || realCandidate.startsWith(realRoot + sep)) {
      return true;
    }
  }
  return false;
}
