# Phase Super-Swarm Synthesis — PR #306 (head 25f907d, R3 verification pass — FINAL)

**Round history:** R0 (head d707da8, 6/10 reviewers) → R1 fix 9e1b505 (H1/H2/M1/M3/M4 fixed) + Claude-family rerun surfaced H3-revised → R2 guard 65b7e55 (bypassable `/compact`-prefix regex) → **R3 fix 25f907d (this pass) — verified, including live empirical testing, not just code reading.**

**Phase:** dev-cpc-ui (world-os#218) — 6 member PRs, 17 landed commits + 3 review-fix commits (9e1b505, 65b7e55, 25f907d)

## Summary

**Verdict: security-critical finding is now genuinely CLOSED. One small, non-security client regression found that R3 missed. No R4 needed for security; a tiny optional follow-up recommended for correctness.**

I did not just read the diff this time — I built an isolated scratch tmux session (`tmux -L pr306-verify-test`, throwaway socket, killed after testing, no production session touched) and empirically tested every byte class in question by actually sending them via `tmux send-keys -l` and observing whether premature command submission occurred. Results:

- **`\n` (LF):** confirmed causes premature submission (control test — `"echo BEFORE\necho AFTER"` produces two separate executed lines). This is the original chaining vector. **Covered** by the new guard (`\x0A` ∈ `[\x00-\x1f\x7f]`).
- **`\r` (CR):** confirmed, independently, also causes premature submission (same two-line-execution pattern). **Covered** (`\x0D` ∈ `[\x00-\x1f\x7f]`).
- **DEL (`\x7f`):** explicitly included in the guard; not independently tested for submission behavior (not the chaining vector), included defensively.
- **U+2028 (LINE SEPARATOR) / U+2029 (PARAGRAPH SEPARATOR):** these code points (0x2028/0x2029) fall **outside** the `[\x00-\x1f\x7f]` class — confirmed by inspection this is a real gap in the regex's coverage. **However**, I tested both, twice each, with byte-exact payloads (verified via `od -An -tx1` before sending) in a live bash-5.2-inside-tmux-3.5a-UTF-8-locale session, and **neither caused premature submission** — the payload was received as ordinary literal bytes within the same line and only executed as one unit when the real `Enter` keystroke followed. **This is not a currently-exploitable gap against a standard bash/readline-hosted session.** I can't rule out some other program (e.g. a JS-based REPL with its own Unicode-aware line-splitting) treating these differently in some other target session — so the regex is not airtight in the abstract — but there is no live evidence of exploitability, and the practical risk is low. Per your ask to "say so plainly if it's a real gap": **it is not a real gap in the tested and realistic environment; it is a theoretical blind spot in the regex's completeness.** I would not block merge on it. If you want a fully airtight guard regardless, the fix is cheap (switch to a printable-ASCII allowlist instead of a control-char denylist, or add `  ` to the character class) — optional hardening, not urgent.

**Both endpoints are now covered by the same shared guard**, closing my second R2 finding: `isDisallowedNonDefaultLiteral()` is called from both `/compact` and `/send-keys`'s literal (non-`raw`) branch — confirmed by direct code read, not by trusting the description. The `raw: true` branch of `/send-keys` is untouched and remains safe (`RAW_KEY_TOKEN` allowlist, validated before any `execFileAsync` call, all-or-nothing — no way to smuggle a `-`, `/`, whitespace, or control char through a token that must match `^[A-Za-z][A-Za-z0-9_-]*$`). The default-session path is confirmed genuinely unaffected: `isDisallowedNonDefaultLiteral` short-circuits to `false` whenever `session === TMUX_SESSION`, and I ran the actual touched test file (`slash-commands-session.test.ts`, 17/17 passed) to confirm the new/renamed tests (multi-line rejected for non-default, multi-line still accepted for default, on both endpoints) pass for real, not just as claimed.

**One thing R3 didn't mention, and I found by tracing the client change against its sibling:** the single-lining fix was applied to `continuityNotes` (the "Prompt for Continuity" flow) but **not** to `compactFocus` (the "Compact Focus" flow) — both use a `<textarea>` (confirmed by reading `CompactModals.tsx`), both can contain a user-typed or pasted embedded newline, but only one got `.replace(/\s+/g, " ")` treatment. Net effect: typing or pasting multi-line text into "Compact Focus" while viewing a non-default session (e.g. via `/pm_dobot`) will now silently 400/error, where it previously worked. This fails **safe** (the request is rejected, nothing gets sent) — it's a UX regression, not a security hole — but it's a real, confirmed, unaddressed gap, exactly the same class of bug R3 was specifically written to close on the other textarea. No test in either the server or web suite covers this (confirmed: no test file references `compactFocus`/`CompactFocusModal` at all).

**Worth stating plainly, since it's a genuine (and reasonable) policy shift buried in the diff rather than called out explicitly:** R3 doesn't just patch the newline bypass — it **replaces** R2's "fixed-verb doctrine" (`/^\/compact(\s|$)/` requiring a literal `/compact` prefix) with a pure "single-line, any content" rule. Confirmed via the test diff: the R2-era test `"rejects non-/compact free text for a non-default session"` (asserting `message: "echo pwned"`, no newline, gets 400) was **removed and replaced** with a narrower test that only checks newline-injection is rejected. So as of head 25f907d, a bare single-line message like `"echo pwned"` (no `/compact` prefix, no control chars) **would now be accepted** for a non-default session — free-form single-line text to any session is the accepted, intentional, trust-bounded (Telegram-auth-gated) posture going forward, with the actual security property enforced being "no command chaining," not "fixed verb only." This is coherent and matches what R2-verification already flagged as acceptable at MEDIUM severity given the trust boundary — but it's a real scope narrowing from what R2's own code comment promised, and worth Liam knowing explicitly rather than assuming "fixed-verb" is still the enforced model.

## CONFIRMED FIXED (all rounds)

| # | Finding | Status |
|---|---|---|
| H1 | Unguarded `decodeURIComponent(fileMatch)` | **Fixed** (R1), unaffected by R2/R3. |
| H2 | Namespace scan cap before filtering | **Fixed** (R1), unaffected by R2/R3. |
| M1 | Sync `execFileSync` blocking event loop | **Fixed** (R1), unaffected by R2/R3. |
| M3 | Concurrent `pollOnce()`/scan race | **Fixed** (R1), unaffected by R2/R3. |
| M4 | Render-phase side effect | **Fixed** (R1), unaffected by R2/R3. |
| H3-revised | `/pm_dobot` newline command-chaining into a non-default session, on both `/compact` and `/send-keys` literal | **Fixed and empirically verified** (R3) — live tmux test confirms LF/CR chaining is blocked on both endpoints; default session and raw-mode path confirmed unaffected. |

## NEW — small, unaddressed, non-blocking

| Finding | Severity | Recommendation |
|---|---|---|
| `compactFocus` (Compact Focus modal) lacks the same newline-collapsing fix `continuityNotes` received; a multi-line focus entry now 400s against non-default sessions instead of working | LOW (fails safe, UX-only, no security exposure) | One-line fix: apply the identical `.trim().replace(/\s+/g, " ")` treatment to `compactFocus` before building the `/compact ${...}` message in the `"compact-focus"` case (`ActionBar.tsx`). Trivial, same pattern already proven in the sibling case. Not blocking merge — safe to fix now (cheap) or fast-follow. |
| `[\x00-\x1f\x7f]` doesn't cover U+2028/U+2029 | Informational / theoretical | Not exploitable against the tested bash/tmux/readline stack (empirically verified, 3 independent byte-exact live tests). Optional hardening if you want the guard to be airtight against every conceivable receiving program, not just bash: broaden the character class or switch to a printable-ASCII allowlist. Not blocking. |

## DEFERRED (unchanged, previously verified)

- M2 (frontmatter heuristic, both directions) → issue **#310** (confirmed open, correctly scoped).
- 4 LOW items (alias exact-path, symlink-guard asymmetry, `pollOnce` uncaught rejection, cap-slice non-determinism) → issue **#312** (confirmed open, correctly scoped).

## Decision

**No R4 needed for security.** The chaining vulnerability that motivated R2 and R3 is closed and empirically verified on both endpoints, with the default session and raw-mode path confirmed unaffected. The residual items are optional:

1. (Recommended, cheap, not blocking) Apply the same single-lining treatment to `compactFocus` that `continuityNotes` already got — closes the one confirmed regression this round, ~2 min fix.
2. (Optional, not blocking) Broaden the control-char guard to also explicitly reject U+2028/U+2029 if you want defense-in-depth against a hypothetical non-bash receiving program, even though no live exploitability was found.
3. M2/#310 and the 4 LOWs/#312 remain correctly deferred, unaffected by this round.

**The user decision needed:** none blocking. Whether to take the 2-minute `compactFocus` fix now or fast-follow it is a judgment call, not a decision that needs to come back to Liam first. This PR is functionally ready pending Liam's normal greenlight — no open security question remains.

---

## FINAL (head dece6bc, post-R3 + independent codex critique — 2026-07-10 ~17:30 ET)

The "No R4 needed / raw-mode path confirmed unaffected / no open security question" conclusion above is **superseded**. After codex came back online, an independent adversarial critique (job f90b41) of the R3 guard found the earlier "chaining closed" claim held only for the *literal* path:

- **Raw `/send-keys` composes submitted commands past the guard.** `RAW_KEY_TOKEN` (`/^[A-Za-z][A-Za-z0-9_-]*$/`) accepts `Enter`, `Space`, `C-m`, `C-j`, and single letters as valid tokens; the R3 control-char guard only covers the literal branch. Verified locally: `keys:"p k i l l Space c l a u d e Enter"` (all valid tokens) submits `pkill claude` to a non-default session.
- **Single-line literal still submits.** A single-line `/compact <text>` or `keys` value is typed + `Enter` into a non-default session regardless of the guard.

**Applied since the R1-era body above:**
- `compactFocus` single-lining — commit `dece6bc` (item 1 above, done).
- R2 `/compact`-prefix guard replaced by the R3 control-char guard on both `/compact` and `/send-keys` literal branches — commits `25f907d` / `65b7e55`.

**Accurate final position:** R3 closed **literal-path multi-line command-smuggling** (a real narrowing, empirically verified). It did **not** make the palette view-only for non-default sessions — both the raw-compose and single-line-submit paths remain. This is not a new regression; it is the #291 / voice-msg-1188 "palette works against ANY fleet session" design, in tension with #241 phase-1's "read-only by default, steering confirmation-gated." Severity is bounded by Telegram auth (authed/allowlisted users only) — design-integrity + defense-in-depth, not an open RCE.

**Open decision (escalated to Liam, not a code question):**
- **A) Trust-bounded** — keep the palette drivable against any session; finalize wording only (zero code).
- **B) True view-only phase 1** — restrict non-default sessions to non-submitting navigation keys (all the UI actually sends) and drop free-text `/compact` for them; real steering returns in #241 phase 2 behind its confirmation gate (small codex change + cheap-first re-review).

PM recommendation: **B** (matches #241's own acceptance criteria; near-zero UX cost). Deferred items unchanged: M2 → #310, 4 LOWs → #312. PR remains open, unmerged, pending Liam's A/B + greenlight.
