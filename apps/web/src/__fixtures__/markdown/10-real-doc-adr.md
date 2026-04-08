# ADR 0001: Package CPC as the Shareable Hub with Toolbox as a Git Submodule

**Status:** Proposed
**Date:** 2026-04-06
**Deciders:** Liam (Chaintail), Claude
**Context:** Hackathon friends asked for GitHub links to "what we built." This forced the question of what artifact best represents Claude's World as a sharable, runnable system.

---

## Context

Claude's World is currently spread across multiple repositories and directories with no single artifact a new user could clone to "get the system":

- **CPC** (`~/code/claude-pocket-console`) — the Telegram mini app, the most polished and visually impressive piece
- **Toolbox** (`~/code/toolbox`) — reusable scripts (md-speak, share-doc, transcribe, hooks). About 20 of the 40 entries in `~/bin` are now symlinks into this repo. Migration is in progress.
- **Skills** (`~/.claude/skills/` and `~/claudes-world/.claude/skills/`) — Claude Code skills, scattered across two locations
- **Host config** (`~/do-box`) — VPS-specific systemd, Caddy, cloudflared (brittle whitelist-driven snapshot)
- **Live state** (`~/claudes-world/`) — working directory, knowledge base, memory, ephemeral files

When the user's hackathon friends asked for GitHub links, there was no clean answer. Pointing them to CPC alone misses the supporting infrastructure. Pointing them to multiple repos requires explaining the relationships. A monolithic "everything in one repo" approach was considered but rejected (see Alternatives).

The user proposed: **what if CPC stays as the primary shareable artifact and toolbox is included as a dependency inside it?** This ADR captures that decision.

---

## Decision

**CPC will be the primary shareable artifact for Claude's World. Toolbox will be embedded as a git submodule.**

The structure will be:

```
claude-pocket-console/             ← what new users clone
├── README.md                      ← "This is Claude's World"
├── apps/web/                      ← React/Vite mini app
├── apps/server/                   ← Hono API
├── tools/                         ← git submodule → toolbox repo
│   ├── md-speak/
│   ├── share-doc/
│   ├── transcribe/
│   └── hooks/
├── skills/                        ← Claude Code skills (migrated from ~/.claude/skills)
└── docs/                          ← progressive disclosure (per OmniPass pattern)
    ├── reference/
    ├── guides/
    └── conventions/
```

A new user would:
1. `git clone --recursive github.com/{user}/claude-pocket-console`
2. Read `README.md` and `AGENTS.md` (the index)
3. Browse `docs/` for progressive disclosure on whatever interests them
4. Run `pnpm install && pnpm run dev` to bring up CPC
5. Optionally install the toolbox scripts to their own `~/bin` for full Claude Code integration

Toolbox keeps its own repository, its own commit history, and its own lifecycle. CPC pins to a specific toolbox commit via the submodule reference, and bumps that pin intentionally when toolbox ships changes.

---

## Consequences

### Positive

- **One link to share.** "Check out github.com/{user}/claude-pocket-console" gives someone the whole system. The first impression is the polished mini app, not a wall of bash scripts.
- **Toolbox stays portable.** Someone who wants only the scripts can clone toolbox alone without pulling CPC. The two repos serve different audiences (CPC for "show me the system," toolbox for "give me the tools").
- **Independent lifecycles.** Toolbox can ship breaking changes, ship rapid iterations, or be totally rewritten without forcing a CPC release. CPC pins to a known-good commit and bumps deliberately.
- **Smaller blast radius.** A bug in toolbox doesn't break CPC unless CPC explicitly bumps the submodule. Reverting is one commit away.
- **Existing structure preserved.** The toolbox repo doesn't need restructuring. It just becomes a sub-tree inside CPC at `tools/`.
- **Matches how people discover the project.** "Claude Pocket Console" is the recognizable name. Toolbox is invisible infrastructure. The submodule pattern reflects this asymmetry honestly.

### Negative

- **Submodule UX is clunky.** New contributors will forget `--recursive` on clone. They'll see an empty `tools/` directory and be confused. Mitigation: README has a "first steps" section that explicitly addresses this, and `pnpm install` could check for the submodule and warn if missing.
- **Submodule pin updates require explicit commits.** When toolbox ships a fix, CPC needs a commit to pull it in. Not bad in practice (usually you want this control) but adds a step.
- **Two-repo cognitive load.** Anyone contributing to both CPC and toolbox has to manage two repos, two commit histories, two PR workflows. Mitigation: most contributors will only touch one or the other.
- **The "host" pieces still don't have a home.** This ADR doesn't address where systemd/Caddy/cloudflared configs live. They're VPS-specific and don't belong in CPC. A separate decision is needed for the do-box replacement.
- **Skills location split.** Skills currently live in `~/.claude/skills/` AND `~/claudes-world/.claude/skills/`. Deciding which is canonical and migrating to `claude-pocket-console/skills/` is a follow-up task.

### Neutral

- The user's `~/code/claude-pocket-console` working directory and the GitHub repo will share a name (already the case). Nothing changes locally.
- The `~/.world/` directory concept (per-project overrides) is orthogonal to this decision and can still be added.

---

## Alternatives Considered

### Alternative 1: Single monorepo containing everything

Move CPC, toolbox, skills, host config, and apps into one new repo at `github.com/{user}/claudes-world`. Each becomes a top-level package.

**Why rejected:**
- Breaks the existing CPC and toolbox repo histories (or requires complex git filter-repo work)
- Forces all packages to share a release cadence
- The "host" pieces (systemd, Caddy) don't belong in a portable repo at all — they're VPS-specific
- A new monorepo means a new repo name that nobody recognizes
- Doesn't match how the user actually thinks about the system (CPC is the recognizable thing, everything else supports it)

The original portability design doc proposed this approach. After discussing it with the user, the CPC-as-hub model is a better fit for the actual goal (a shareable artifact for hackathon friends) without the migration cost.

### Alternative 2: Git subtree instead of submodule

Same end state but using `git subtree` to merge toolbox's history into CPC at `tools/`. Consumers don't need `--recursive`.

**Why rejected:**
- Subtrees are harder to update bidirectionally. Pushing changes from CPC's `tools/` back to the toolbox repo requires `git subtree split` and manual reconciliation.
- Subtree is less commonly understood than submodule. Most developers know `git submodule update --init --recursive`; fewer know `git subtree pull`.
- The "no init step" benefit is real but small — a one-line README note solves it.
- Could revisit if submodule pain proves worse than subtree pain in practice.

### Alternative 3: pnpm workspace / npm package

Publish toolbox to npm and have CPC depend on it via `package.json`. Cleanest from a JS perspective.

**Why rejected:**
- Toolbox contains a mix of bash, Python, and TypeScript scripts. npm only handles the Node.js subset cleanly.
- Bash and Python scripts would need wrapper packages or be excluded, fragmenting the toolbox.
- Versioning becomes a release-management chore — every toolbox change needs a version bump and publish.
- Adds an external dependency (npm registry) for what should be a self-contained system.

### Alternative 4: Symlinks (do nothing)

The current state. `~/bin` symlinks into `~/code/toolbox`, CPC is a separate repo. No packaging.

**Why rejected:**
- This is exactly what the user is trying to fix. The current state has no shareable artifact and the relationships are invisible to anyone outside the user's head.
- Doesn't survive a host migration. Symlinks are filesystem-specific.
- Doesn't help hackathon friends at all.

---

## Follow-Up Actions

These are not part of this ADR but are needed to execute the decision:

1. **Decide on the host config story** — separate ADR. The do-box replacement (manifest-driven, deterministic rebuild) is its own design problem.
2. **Decide on skills canonical location** — consolidate `~/.claude/skills/` and `~/claudes-world/.claude/skills/`, then migrate to `claude-pocket-console/skills/`.
3. **Adopt progressive disclosure docs in CPC** — restructure CPC's existing AGENTS.md and docs into the OmniPass `reference/guides/conventions/` pattern. (See ADR 0002, forthcoming.)
4. **Submodule integration plan** — actually create the submodule, write the README "first steps" section, set up CI to verify the submodule resolves cleanly.
5. **Port convention v2** — separate ADR. The current 38xxx/48xxx/58xxx convention is too coarse and caused hackathon collisions.
6. **Plugin packaging (longer term)** — if CPC grows into a Claude Code plugin, the plugin manifest can reference the same submodule structure. No conflict.

---

## References

- `~/claudes-world/knowledge/claudes-world-portability-design.md` — the broader design doc this ADR resolves
- `~/code/omnipass-world/AGENTS.md` — the progressive disclosure pattern used as the docs model
- `~/code/claude-pocket-console/` — the CPC repo to be restructured
- `~/code/toolbox/` — the toolbox repo to become a submodule
- [Git submodule docs](https://git-scm.com/book/en/v2/Git-Tools-Submodules)
