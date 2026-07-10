import { realpath, open, constants, type FileHandle } from "node:fs/promises";
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

/**
 * Roots CPC may WRITE into (file upload, paste, audio-generation sidecars).
 * Deliberately narrower than the read list below: the viewer expansion for
 * agent workspaces + /tmp (Liam voice 1238) is read-only — /tmp especially
 * is world-writable shared space that CPC must never write into, and legacy
 * lane workspaces are other agents' working state. This list is exactly the
 * pre-expansion allowlist, so the write surface is unchanged.
 */
export const ALLOWED_WRITE_ROOTS = [
  "/home/claude/claudes-world",
  "/home/claude/code",
  "/home/claude/bin",
  "/home/claude/.claude",
  "/home/claude/claudes-world/.claude",
  "/home/claude/.world",
] as const;

/**
 * Roots the file viewer may READ (list/read/search/download/send-to-chat).
 * Superset of the write roots plus view-only additions:
 *  - /home/claude/.worldos/lanes — legacy lane workspaces (current-gen lane
 *    workspaces live under ~/.world, already covered above)
 *  - /tmp — agents share artifacts there (tmpfs; whatever the server user
 *    can read). Symlink escapes are neutralized by isPathAllowed's realpath
 *    resolution: a /tmp symlink pointing outside the allowlist resolves to
 *    its real target and is denied.
 * Keep every entry an explicit absolute path — no globs, no env-derived
 * wildcards; that property is what makes the traversal guard auditable.
 */
export const ALLOWED_FILE_ROOTS = [
  ...ALLOWED_WRITE_ROOTS,
  "/home/claude/.worldos/lanes",
  "/tmp",
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

export type OpenAllowedResult =
  | { ok: true; handle: FileHandle; realPath: string }
  | { ok: false; reason: "not-found" | "denied" | "error" };

/**
 * Race-safe replacement for "isPathAllowed(p) then read p by name".
 *
 * The by-name pattern is a check-then-use TOCTOU: a path that passes the
 * allowlist check can be swapped for a symlink before the subsequent
 * open()/readFile()/readdir(), redirecting the read to a disallowed file.
 * Benign while every allowed root was owned by the CPC account; a real
 * allowlist bypass once a WORLD-WRITABLE root (/tmp) is in the read list —
 * any local process can plant a file, let it pass the check, then swap in a
 * symlink to e.g. ~/.ssh/id_rsa (PR #292 codex HIGH).
 *
 * Fix: open first (following symlinks — the "allow a symlink whose target
 * is inside a root" semantics are preserved), then validate the OPENED
 * inode's real path via `/proc/self/fd/<fd>`. The fd is pinned to one
 * concrete inode, so whatever the attacker swapped, we validate the file we
 * will actually read — never the name. Callers MUST read from the returned
 * handle (or its `/proc/self/fd` path for readdir), never reopen by name.
 *
 * Linux-only by design (this is a Linux host); `/proc/self/fd` is the
 * pinned-fd identity. On a platform without it the realpath resolves to a
 * non-allowed path and the call fails closed.
 *
 * Opened O_NONBLOCK (round-2 review, PR #299): `/tmp` is a world-writable
 * read root, so a client-controlled path can name a FIFO. Opening a FIFO
 * for read with the plain "r" flag blocks the libuv threadpool until a
 * writer shows up — a cheap DoS. O_NONBLOCK makes a FIFO open return
 * immediately (per POSIX open(2)) instead of blocking, and is a no-op for
 * regular files/directories, so every existing caller's behavior for real
 * files is unchanged. The fstat check right after open then rejects
 * anything that isn't a regular file or a directory (FIFO, socket, device
 * node) before any caller can read from it — callers that open directories
 * (list/download/search-scope) keep working; callers of special files do
 * not.
 */
export async function openAllowedForRead(
  absPath: string,
  allowedRoots: readonly string[],
): Promise<OpenAllowedResult> {
  let handle: FileHandle;
  try {
    // O_NONBLOCK + O_RDONLY still follows symlinks including the final
    // component (preserving the legacy allow-symlink-into-root behavior);
    // the post-open checks below are what make that safe.
    handle = await open(resolve(absPath), constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (err: any) {
    return { ok: false, reason: err?.code === "ENOENT" ? "not-found" : "error" };
  }
  try {
    const st = await handle.stat();
    if (!st.isFile() && !st.isDirectory()) {
      // FIFO / socket / char / block device — reject before any caller can
      // read from it. Opened non-blocking above specifically so this check
      // can run instead of the open() call itself hanging.
      await handle.close();
      return { ok: false, reason: "denied" };
    }
    // realpath('/proc/self/fd/N') resolves the kernel's magic symlink to the
    // canonical path of the inode this fd holds — the authoritative identity.
    const realPath = await realpath(`/proc/self/fd/${handle.fd}`);
    for (const root of allowedRoots) {
      let realRoot: string;
      try {
        realRoot = await getRealRoot(root);
      } catch {
        continue;
      }
      const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
      if (realPath === realRoot || realPath.startsWith(rootWithSep)) {
        return { ok: true, handle, realPath };
      }
    }
    await handle.close();
    return { ok: false, reason: "denied" };
  } catch {
    await handle.close();
    return { ok: false, reason: "error" };
  }
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
