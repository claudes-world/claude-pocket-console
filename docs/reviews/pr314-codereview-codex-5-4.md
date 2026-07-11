# Super-Swarm Review — PR #314 (head f208ccf)

## SUMMARY
NEEDS_FIXES. The integrated head still has one wrong-file side effect in the audio flow, and I do not think the new share path's hardening is complete: it both reuses an over-broad read allowlist for public publication and drops its pinned-file guarantee before `publish-shared` consumes the staged file. Merge recommendation: hold until the audio operation is bound to file identity and the share route's permission/race model is tightened.

## HIGH severity findings
- `apps/web/src/components/action-bar/ActionBar.tsx:64-76,357-460,752-760`: audio generation/send state is global to the ActionBar, not bound to the currently viewed file. `audioCheckSeqRef` only versions cache checks; a long-running `handleGenerateAudio()` keeps mutating shared `audioStatus` even if the user closes the sheet and opens another markdown file. After that file switch, the modal title comes from the new `viewingFile`, but `onSend()` still posts `audioStatus.path` from the old file. Repro: start generating on `A.md`, close the sheet, open `B.md`, then reopen Audio after `A` finishes; the sheet is now for `B`, but "Send to Telegram" resends `A`'s audio. Suggested fix: version audio ops by file path/sequence exactly like share/reading-list do, and drop both auto-send completions and manual sends when the owning file is no longer current.

## MEDIUM severity findings
- `apps/server/src/routes/share.ts:39` plus `apps/server/src/lib/path-allowed.ts:67-71`: `/api/share/publish` inherits the full file-viewer read allowlist, which now includes view-only and sensitive roots such as `/tmp`, legacy lane workspaces, `~/.claude`, and `~/.world`. That was acceptable for local viewing, but this route creates externally reachable public/private URLs, so the permission boundary just widened from "the user can inspect it in CPC" to "the user can publish it on shared.claude.do" with no extra policy gate. Suggested fix: introduce a narrower `ALLOWED_SHARE_ROOTS` (or explicit per-root opt-in) instead of reusing `ALLOWED_FILE_ROOTS`.
- `apps/server/src/routes/share.ts:61-77`: the source inode is pinned only until the route copies it into `stagedPath`; after that, the route closes the handle and hands `publish-shared` a pathname. The helper then reopens that staged path by name, so the final publish step is back to check/use on a mutable file rather than on the inode that was originally validated. The `mkdtemp()` directory is `0700`, which blocks other UIDs, but CPC's other same-user workloads can still race this path. Suggested fix: keep the staged file open and hand the helper `/proc/self/fd/<n>`, or move the publish copy into the route so the helper never reopens a mutable temp pathname.

## LOW severity findings
CLEAN — no findings

## Cross-cutting observations
Exact-head targeted tests were mostly healthy: the touched web suites passed (`313/313`), and direct exact-head server route runs for `audio.test.ts`, `prs-routes.test.ts`, and `share.test.ts` passed (`43/43`). I did not see merge-conflict duplicate logic in the integrated files, but the missing coverage here is specifically cross-file ownership while audio generation is still in flight, and share-path policy/race tests stop at the route boundary rather than the helper's final reopen.
