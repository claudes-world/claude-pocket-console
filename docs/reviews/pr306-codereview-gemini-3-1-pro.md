# Phase Super-Swarm Review — PR #306 (head d707da8)

## SUMMARY
NEEDS_FIXES. While the logical integration of the features is solid and the tmux pipe-spoofing protection is robust, there is a critical operational risk introduced by the repository discovery mechanism. Blocking the Node.js event loop with synchronous `execFileSync` calls in a realtime WebSocket-heavy application will cause noticeable latency spikes. The PR also introduces a React render-phase side effect that needs to be moved to a `useEffect` hook.

## HIGH severity findings

**Synchronous `execFileSync` in `discoverRepos` blocks the Node.js event loop**
- **File:** `apps/server/src/routes/prs.ts` (`discoverRepos`)
- **Explanation:** `discoverRepos()` performs filesystem stats and multiple `execFileSync` calls synchronously. While the inline comment notes this is intentional for atomicity, doing so blocks the main Node.js event loop. In a realtime terminal app, blocking the event loop for even a few hundred milliseconds (or up to 5s on a git timeout) across multiple repositories will cause unacceptable keystroke latency and stutter for all active WebSocket connections.
- **Suggested Fix:** Refactor `discoverRepos` to be asynchronous using `execFileAsync` and `Promise.all()` to bound concurrency. To preserve atomicity and prevent duplicate simultaneous scans, assign the inflight `Promise<RepoInfo[]>` to `repoCache` so concurrent requests await the same atomic scan.

## MEDIUM severity findings

**React render-phase side effect in `App` component**
- **File:** `apps/web/src/App.tsx` (`App` component)
- **Explanation:** `window.history.replaceState` is called directly inside the `useState` initializer for `initialRoute`. React requires the render phase to be pure; side effects in the render phase can cause bugs, tearing, or double-execution in Strict Mode / Concurrent Mode. 
- **Suggested Fix:** Move the `window.history.replaceState` call into a `useEffect` hook that triggers when `initialRoute.redirectPath` is present.

**YAML frontmatter heuristic fails on unindented lists**
- **File:** `apps/web/src/components/MarkdownViewer.tsx` (`extractFrontmatter`)
- **Explanation:** The `hasYamlShape` regex (`/^\s|^#|^[A-Za-z0-9_.$-]+\s*:(\s|$)/`) checks if frontmatter lines look like valid YAML. However, YAML permits block sequences at the root level without indentation (e.g., `- item`). Lines starting with `- ` fail this regex, causing `extractFrontmatter` to reject valid list-based frontmatter (like `tags:\n- foo`) and expose the raw YAML to the user.
- **Suggested Fix:** Add `|^- ` to the regex so it accepts unindented list items: `/^\s|^#|^- |^[A-Za-z0-9_.$-]+\s*:(\s|$)/`.

**Silent truncation of namespace directories**
- **File:** `apps/server/src/routes/prs.ts` (`discoverRepos`)
- **Explanation:** `NAMESPACE_SCAN_CAP` limits the namespace directory scan to 50 items. If an organization has a namespace folder with more than 50 cloned repositories, any repositories beyond the 50th will be silently ignored.
- **Suggested Fix:** Consider raising this cap significantly (e.g., 500) once `discoverRepos` is refactored to be non-blocking, or log a warning when truncation occurs so users aren't left wondering why repos are missing.

## LOW severity findings

CLEAN — no findings.

## Cross-cutting observations

- The locale-proof tmux session listing logic (`|` separator) combined with the first-pane-wins dictionary is an elegant and robust defense against pipe-name spoofing. Excellent work on the data flow and boundary validation there.
- The path compaction algorithm (`middleTruncatePath`) correctly preserves filesystem semantics and elegantly avoids splitting UTF-16 surrogate pairs at the truncation boundaries.
