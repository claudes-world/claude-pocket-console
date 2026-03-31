# Gitflow Conventions

## Branch Model

- **`main`** is production. Never commit directly. Merges come from `dev`
  or feature branches only.
- **`dev`** is the working integration branch. Most development happens here.
- **`feat/<name>`** for feature branches (e.g., `feat/voice-recorder`).
  Branch from `dev`, merge back into `dev`.

## Before Every Change

1. Check the current branch: `git branch --show-current`
2. If on `main`, switch to `dev` first: `git checkout dev`
3. If working on a feature, confirm you are on the right feature branch

## Commit Rules

- Write descriptive commit messages that explain what and why
- Add `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`
  to AI-assisted commits
- Commit at every working checkpoint -- small, atomic commits
- Always WIP-commit before experimental edits

## Safety Rules

- **Never `git checkout`/`restore` uncommitted work** without explicit
  user approval. Always commit first so the work is recoverable.
- **Never `git push --force`** to shared branches.
- **Never `git reset --hard`** without explicit user request.
- Use `git stash` if you need to temporarily set aside changes.

## Deploy Flow

1. Work on `dev` or `feat/*` branch
2. Test via `cpc-dev.claude.do`
3. Merge to `main` when ready
4. Use `/deploy` skill to build and ship
