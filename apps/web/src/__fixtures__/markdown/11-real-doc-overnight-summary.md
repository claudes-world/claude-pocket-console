# Overnight Final Report — April 6-7, 2026

**Session start:** ~7:30pm ET April 6
**Session end:** ~9:30pm ET April 6 (this report)
**Format:** Single document for morning review

---

## TL;DR

**8 PRs open and ready for your review.** None merged. Foundational tools shipped (Scrum button, send-md fix). Three big-picture synthesis docs are ready for morning decisions (reading list, portability, theme). One known issue: the dev tunnel is currently 502 because of agent worktree coordination — fixes itself when you merge PR #21.

---

## What's ready for you to merge (in order)

### Toolbox
1. **toolbox PR #1** — `tune: reduce heading pauses, speed up body voice`
   - 6 line edits, body voice 0.95 → 1.05, heading pauses cut ~30%
   - Verdict: LGTM SHIP IT
   - Branch: `tune/md-speak-pacing` → `main`

2. **toolbox PR #2** — `feat(hooks): Scrum button + share-doc backtick fix`
   - Scrum button on launcher keyboard + handler
   - share-doc dual-mode (file path or inline content) — fixes the backtick truncation bug
   - Both actively in use this session
   - Branch: `feat/scrum-button-and-share-doc-fix` → `main`

### CPC (in recommended merge order)
1. **PR #21** — `fix: allow cpc.claude.do host in Vite dev server`
   - **MERGE FIRST** — unblocks the dev tunnel which is currently 502
   - Adds `host: "127.0.0.1"` and `allowedHosts: ["cpc.claude.do"]` to vite.config.ts
   - Verdict: APPROVE WITH NITS (Gemini suggested also updating proxy + HMR config — see follow-up items)

2. **PR #19** — `feat(links): Companion + T3 app icon links`
   - Trivial (+12/-0), no risk
   - Verdict: SHIP IT

3. **PR #18** — `feat: download button in file viewer`
   - New `/api/files/download` endpoint + FiDownload button in FileViewer
   - Verdict: APPROVE WITH NITS
   - **Should-fix items Gemini caught (you decide):**
     - Use `buf.length` instead of `st.size` for Content-Length (TOCTOU)
     - Sanitize 500 error messages (don't leak internal paths)
     - Consider streaming instead of `readFile` for large files (memory pressure)
   - **Pre-existing security issue Gemini flagged:** `isPathAllowed` uses startsWith — vulnerable to prefix-based path traversal. Affects ALL existing routes (`/list`, `/read`, `/search`, `/upload`) AND this new `/download`. Should be its own hardening PR.

4. **PR #20** — `fix: code block horizontal scroll in markdown viewer`
   - Two commits: original fix + follow-up addressing Gemini's "right padding lost on scroll" finding
   - Now includes `width: max-content; min-width: 100%` on `pre code`
   - Verdict: APPROVE

5. **PR #22** — `feat: render Mermaid diagrams in markdown viewer`
   - Lazy-loaded mermaid (main bundle stays at 595KB, mermaid in own 652KB chunk)
   - Two commits: initial component + follow-up wiring (vite.config.ts manualChunks, MarkdownViewer integration, mermaid dependency)
   - Verdict: pending agent re-review (running)

6. **PR #23** — `feat: file viewer sort control with persistence`
   - Inline sort control row in FileViewer header
   - localStorage persistence + SortMode type promotion + sort logic hardening
   - Verdict: pending agent re-review (running)

---

## Big-picture decisions waiting for your input

These are the three synthesis docs from the devil's advocate sessions. Each has my recommended answers — if you agree with my recs, just say "go" and I'll execute. If you disagree, tell me which.

### Reading list feature
- **Doc:** `tmp/20260406-reading-list-synthesis.md`
- **3 reviewers:** Gemini (RETHINK), Codex (NEEDS WORK), Sonnet (NEEDS WORK)
- **6 decisions to make:**
  1. Hard delete instead of soft delete (my rec: yes)
  2. Reject `default` user for reading list endpoints (my rec: yes — security)
  3. Save button in ActionBar instead of FileViewer header (my rec: yes — consistency)
  4. `is_saved` piggyback on file read endpoint instead of separate /check (my rec: yes)
  5. Drop the speculative `note` column (my rec: yes)
  6. Defer migration system to a separate ADR (my rec: yes)

### Claude's World portability / .world directory
- **Doc:** `tmp/20260406-portability-synthesis.md`
- **2 reviewers:** Gemini (RETHINK), Codex (NEEDS WORK)
- **Key takeaway:** ADR 0001 (CPC + toolbox submodule) already addresses most critiques. The original maximalist monorepo doc has one factual contradiction to fix (don't version live state in git). 5 follow-up ADRs identified.
- **My rec:** Keep ADR 0001 as Proposed and continue. Update the original design doc to remove the monorepo-version-memory contradiction.

### Light/dark mode
- **Doc:** `tmp/20260406-theme-synthesis.md`
- **1 reviewer:** Gemini (RETHINK)
- **Critical issue:** No accessibility/contrast analysis for the proposed light palette
- **My rec:** Defer entirely until you have time for a proper week-long migration. The current plan is correct but not a sleep-time job.

---

## Documents shipped to your Telegram tonight

| Doc | Type |
|-----|------|
| ADR 0001 — CPC + toolbox submodule packaging | Decision |
| ADR 0003 — Port allocation v2 / port-for | Decision |
| Reading list 3-way DA synthesis | Synthesis |
| Portability 2-way DA synthesis | Synthesis |
| Theme DA review | Synthesis |
| PR reviews summary (5 PRs) | Status |
| Overnight status hour 1 | Status |
| .world skeleton README | Proposal |
| .world skeleton AGENTS.md | Proposal |
| USDX white paper (downloadable) | Re-shared |

All are saved in `~/claudes-world/tmp/` or `~/claudes-world/knowledge/` and can be re-shared via the deep-link system.

---

## Outside-the-box ideas (ranked by ROI × feasibility)

### For Claude's World infrastructure

1. **Morning brief cron job** — runs at 7am ET, sends a markdown doc with overnight git changes, open PRs needing review, weather, calendar (when OAuth wired), memory-based reminders.
   - ROI: HIGH — zero ongoing effort, captures all the context you'd assemble manually
   - Feasibility: HIGH — ~1-2 hours of work, all pieces exist
   - Recommended next step

2. **A "next thing to work on" agent** — ask via Telegram, scans TODO.md / open PRs / recent memories / calendar, suggests highest-leverage next action.
   - ROI: HIGH — decision fatigue is real
   - Feasibility: HIGH — small focused skill, 1 hour to write

3. **Sleep-aware agent operation** — agents stop dispatching new high-risk work after midnight ET unless explicitly told. Morning checks are still allowed but mutations are paused.
   - ROI: MEDIUM-HIGH — prevents bad-overnight surprises
   - Feasibility: HIGH — trivial guard at agent dispatch

4. **Auto-archive `quarantine/` after 30 days** — cron moves untrusted research artifacts older than 30 days into compressed archive.
   - ROI: LOW-MEDIUM — keeps active workspace clean
   - Feasibility: HIGH — 10-line bash + systemd timer

5. **Meta-skill: lints other skills** — periodic agent that scans `~/.claude/skills/` against the skill-authoring-tips guide. Flags any missing descriptions, vague triggers, etc.
   - ROI: MEDIUM — prevents skill bloat over time
   - Feasibility: MEDIUM — couple hours

### For your IRL life (Liam)

1. **Conference contact card MVP** (the one we discussed) — single highest-leverage thing you could ship next month for IRL networking. Day or two of work, transforms every conference for you.
   - ROI: VERY HIGH — every conference becomes 10x more connectable
   - Feasibility: HIGH — small feature, you already have a Telegram presence

2. **Daily "what did I learn today" capture** — voice memo at end of day → transcription → LLM summary → committed to a personal knowledge base in `claudes-world/journal/`. Compound interest on insights over months.
   - ROI: HIGH if you actually use it
   - Feasibility: HIGH — 2 hours, voice-hook already exists

3. **Dev-tunnel uptime monitor** — ntfy hook pings cpc.claude.do/dev every 5 min, notifies if down for 2+ checks. Stops weird issues from going unnoticed.
   - ROI: MEDIUM — prevents debugging-at-3am
   - Feasibility: HIGH — 30 minutes

4. **Auto-tagging for shared docs** — share-doc generates audio with rich ID3 metadata via topic detection. Turns your shared docs into a personal podcast feed.
   - ROI: MEDIUM-HIGH (turns reading queue into listening queue)
   - Feasibility: HIGH — tag-mp3 binary already supports it

5. **Conference-mode auto-Calendly** — when conference mode is on (the contact card idea), automatically open 15-min "coffee chat" availability.
   - ROI: HIGH during events, low otherwise
   - Feasibility: MEDIUM — needs Calendly API

---

## Issues / things to know

### 1. Dev tunnel 502 (worktree coordination)

**Current state:** `https://cpc.claude.do/dev/` returns 502.

**Why:** Multiple agents share `~/code/claude-pocket-console` worktree and check out different feature branches. The cpc-dev.service serves whatever branch is currently checked out. Currently it's on `feat/file-viewer-sort-control` (PR #23's branch), which doesn't have the IPv4 fix. Vite is bound to `[::1]:58830` (IPv6 only), Caddy can't proxy to `127.0.0.1:58830`.

**Fix:** Merge PR #21 to dev. Once IPv4 fix lands on dev, every feature branch will inherit it.

**Lesson learned:** This proves the worktree-aware port allocation idea (ADR 0003) — agents need their own worktrees. I'll avoid launching parallel CPC agents going forward until we have proper isolation.

### 2. Toolbox dirty state (pre-existing)

The toolbox repo has uncommitted changes from before I arrived:
- `hooks/agent-stop-hook` (small)
- `hooks/voice-hook` (small)
- `md-speak/md-speak` (the "end of document" segment block, ~8 lines)
- `tg-sanitize/` (untracked directory)

I left these alone. They look intentional but are not on any branch. Worth checking what they are and either committing or stashing properly.

### 3. send-md fix branch is currently checked out

Toolbox is currently on `feat/scrum-button-and-share-doc-fix` (toolbox PR #2's branch). This is intentional — that branch has the share-doc Mode 2 fix, which is what's powering the send-md skill right now via the symlink at `~/bin/share-doc`. If you switch toolbox branches, send-md will revert to the old broken behavior until you switch back or merge.

**Recommended:** Merge toolbox PR #2 first thing in the morning to permanently land the share-doc fix.

### 4. Pre-existing isPathAllowed security issue

Gemini flagged this on PR #18 but it's NOT introduced by PR #18 — it's pre-existing in `apps/server/src/routes/files.ts`. The `isPathAllowed` function uses `startsWith` which is vulnerable to prefix-based path traversal. Affects `/list`, `/read`, `/search`, `/upload`, AND the new `/download`.

**My recommendation:** File a separate hardening PR. Should not block PR #18 from merging (the vulnerability exists with or without #18).

---

## Stats

- **PRs opened:** 8 (5 CPC + 3 toolbox*) — *toolbox #1 was opened before this session
- **PRs reviewed by me:** 7 (all CPC + toolbox #1)
- **Background agents launched:** ~13
- **Devil's advocate reviews run:** 6 (3 reading list, 2 portability, 1 theme)
- **ADRs written:** 2 (0001, 0003)
- **Synthesis docs:** 3 (reading list, portability, theme)
- **Skeleton stub files:** 9 in `tmp/world-skeleton/`
- **TODO items closed:** 6 (the in-flight CPC features)
- **TODO items added:** 8 (follow-up items + new ADRs to write)

---

## What I plan for hour 2 (and beyond)

The next hour cron will fire at :13 (in ~25 minutes from this writing). When it does, I'll:

1. Check on the in-flight PR reviews for #22 and #23
2. Address any should-fix items those reviews surface (in same-branch commits)
3. Update TODO.md if anything new shipped
4. Send a brief status check-in (probably shorter than this final report)

Beyond that, my plan is to slow down and be conservative. The big shipping push is done. I'll:
- Watch for incoming Telegram messages from you
- Continue polishing what's open
- NOT start any new big features without your approval
- NOT touch any prod systems
- NOT merge anything

If you wake up and want to fast-merge everything, the recommended order is at the top of this doc. If you want me to wait, just say so.

---

## Sleep well, Liam.

The system is in good shape. Lots of value sitting in the PR queue waiting for your review. The big architectural conversations have concrete recommendations. The synthesis docs are ready to discuss when you're ready.

— Claude
