# The `/pm_dobot` command palette — what it can do, and the choice in front of you

*Plain-language explainer for the PR #306 decision. Written for a phone read / audio listen. ~2 pages.*

## 1. What the palette actually is

When you open a bot route like `/pm_dobot` in the mini-app, you land on the **Terminal tab attached to that bot's tmux session** — a live view of, say, pm-dobot's screen. Because it isn't *your own* writable session, the app treats it as a **"restricted" session** and swaps the normal command sheet for a smaller one.

Tap `/commands` on a restricted session and you get:

- **`Esc`** — dismiss a dialog
- **`1` `2` `3`** — answer a numbered prompt (e.g. a permission dialog: "1) yes 2) no")
- **`⇧Tab`** and **`^B`** — cycle focus / tmux prefix key
- **`/compact`** — compress that session's context, optionally with **your own typed guidance** (a two-tap confirm, then a text box)
- **`/reload-plugins`** — reload skills/agents

It **hides** the destructive verbs (`/new`, `/resume`, `/branch`, `/rename`) on restricted sessions — those only work on your own default session.

Every one of these calls is **authenticated** (Telegram initData / signed token — only you and allowlisted users can reach it), the target session name is **validated and exact-matched**, and commands are sent with **no shell involved** (so classic `$(...)`/backtick injection can't happen).

## 2. Option A — keep it exactly as shipped

**What you can do day-to-day:** inspect any lane from your phone *and* act on it — dismiss a stuck dialog with `Esc`, answer a permission prompt with a digit, reload plugins, and — via `/compact` — type a free-text instruction into the lane ("wrap up and save your work to memory", etc.). In practice this is **single-command remote control of any fleet lane from your phone.**

**The exact free-text pathway that exists:** the `/compact` button → a confirm screen → a text box (Compact Focus or Continuity Notes). Whatever you type is sent as literal keystrokes **plus Enter** into the viewed session. There's also a lower-level keystroke endpoint that can do the same.

**The guardrails on it:**
- Auth-gated to you/allowlisted users; nothing is public.
- **R3 fix (this PR):** a restricted session rejects **multi-line** input, so one request can't smuggle a *second* command line (`/compact\nrm -rf /` is blocked). It's one submitted line per action.
- No shell metacharacter injection (execFile, not a shell).

**Why reviewers called it safe-enough:** the blast radius is one authenticated user submitting one line at a time to a machine they own. Two of the six models (codex-5.5, cursor) judged it *intended, narrow, and safe by design* — this is literally the "palette works on any fleet session" capability you asked for (voice msg 1188).

**The honest residual:** it is **not** truly "view-only." If a lane happens to be sitting at a shell prompt (not a Claude REPL), a typed line is a real shell command. And a lower-level keystroke path can compose an arbitrary command out of allowlisted keys. So the "read-only phase 1" label on the PR was inaccurate — corrected now.

## 3. Option B — true view-only phase 1

**What gets stripped from restricted sessions:** the free-text `/compact` box, and any arbitrary keystroke submission. You'd keep pure *navigation* that can't by itself run a command.

**What you lose day-to-day:** this is the real cost, so let's be concrete. Pure view-only would mean you can still *watch* a lane and dismiss a dialog with `Esc` — but you could **not** type a steer, and depending on how strict we go, possibly **not answer a numbered permission prompt** either. The "my phone buzzes, a lane is stuck on a permission dialog, I unblock it from the couch" moment — which is one of the original reasons for this route — gets weaker or disappears.

**What phase-2 restores, properly:** issue #241's phase-2 is exactly "steering, behind a confirmation gate" — a deliberate *Send keystroke to this lane?* confirm before anything is submitted, plus a "save this as a memory" button and a restart shortcut. That's the intended home for real remote control; Option B says "don't ship the ungated version early, wait for the gated one."

## 4. The risk asymmetry (both directions)

**Choosing A, the residual surface:** one authenticated person can push one arbitrary command at a time to any lane. The realistic threats are **fat-finger** (you meant to nudge lane X, you're viewing lane Y) and **account/session compromise** (someone with your Telegram session could steer the whole fleet). Not internet-facing RCE, but more than "read-only" implies. It grows if the allowlist ever widens beyond you.

**Choosing B, the operational loss:** you trade that away for a weaker phone tool until phase-2 lands. The most-used real affordance — unblocking a stuck lane on the go — is the thing you'd sacrifice or degrade. If lanes stall on permission dialogs often, that's a daily papercut.

The asymmetry in one line: **A risks a rare high-cost mistake; B guarantees a frequent small inconvenience.**

## 5. Recommendation

**My recommendation is a *refined* B — call it B-minimal.** Keep the genuinely bounded "unblock" affordances that have a fixed, non-free-form effect — **`Esc`, the digit answers, `⇧Tab`, `^B`, `/reload-plugins`** — because those directly serve the stuck-lane use case and can't express an arbitrary command. **Strip only the free-text pathway** (`/compact` with typed guidance, and the arbitrary-keystroke endpoint) for restricted sessions, and bring real steering back in #241 phase-2 behind its confirmation gate.

This resolves the actual tension: it honors msg-1188 (the palette still works on any session for the fixed verbs) **and** #241 phase-1 ("read-only by default, steering gated") — you keep the couch-unblock, you lose only the ungated free-text-command surface that nobody deliberately relies on yet. It's a **small, well-scoped change** (the UI already only sends those fixed keys to restricted sessions), so it's low-cost to build and cheap to re-review.

If you'd rather not lose *anything* and accept the residual, **A is legitimate** — you'd just want the "read-only" language dropped everywhere and to stay mindful that widening the allowlist widens the trust.

**Straight A (keep-all) is the weakest option** only in that it ships an ungated free-text command channel under a "phase 1" that promised the opposite; B-minimal gets you 95% of the daily usefulness without that.

**Reviewer split (for the record):** genuinely divided. codex-5.4 and sonnet-5 flagged it as a real HIGH scope/security issue; codex-5.5 and cursor judged it intentional and safe; opus-4.8 rated it a MEDIUM worth constraining; opus-4.6/4.7 read it as matching the (now-corrected) stated design. Roughly half saw a problem, half saw a feature — which is why it's your call, not the reviewers'.
