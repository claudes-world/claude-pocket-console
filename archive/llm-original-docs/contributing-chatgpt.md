# Contributing to Claude Pocket Console

> Author: ChatGPT o3

Welcome, and thanks for taking the time to contribute! These guidelines keep our workflow smooth and the codebase healthy. If anything here is unclear, open a discussion or ping **@maintainers** in Discord.

---

## 1 Branch Strategy

| Branch      | Purpose                                               |
| ----------- | ----------------------------------------------------- |
| **main**    | Production‑ready code. Deploys to prod on tag.        |
| **dev**     | Integration branch for staging. Auto‑deploys on push. |
| `feature/…` | New features or experiments.                          |
| `fix/…`     | Bug fixes or hot‑patches.                             |
| `chore/…`   | Build, docs, or infra tasks.                          |

> **Tip:** keep feature branches short‑lived (< 5 days) to ease rebases.

---

## 2 Commit Convention

We use **Conventional Commits**.

```
<type>(<scope>): <summary>

<body optional>

<footer optional>
```

| Type         | When to use                     | Example                                        |
| ------------ | ------------------------------- | ---------------------------------------------- |
| **feat**     | New user‑facing feature         | `feat(web): add reconnect indicator`           |
| **fix**      | Bug fix                         | `fix(terminal): cleanup container on WS close` |
| **docs**     | Docs only                       | `docs: expand architecture guide`              |
| **chore**    | Infra / tooling                 | `chore: bump Tailwind v4.1`                    |
| **refactor** | Code change w/o behavior change | `refactor(api): extract docker manager`        |

---

## 3 Pull Request Checklist

1. **≤ 400** net changed lines (excluding lockfiles & generated code).
2. All checks green: `pnpm turbo lint type-check test`.
3. Add screenshots / test evidence for UI changes.
4. Request at least **one reviewer** (or `@maintainers` for emergencies).
5. Link related issue (e.g. `Closes #123`).

---

## 4 Testing & Coverage

| Layer     | Tooling                        | Minimum coverage |
| --------- | ------------------------------ | ---------------- |
| Front‑end | Vitest + React Testing Library | 80 % lines       |
| Back‑end  | pytest                         | 80 % lines       |
| E2E       | Playwright (critical flows)    | pass/fail        |

Coverage gates run in CI—keep us honest!

---

## 5 CI / CD Overview (GitHub Actions)

| Workflow                | Trigger           | Key steps                                                        |
| ----------------------- | ----------------- | ---------------------------------------------------------------- |
| **ci.yml**              | PR / push         | `pnpm install –frozen-lockfile` → lint → type‑check → unit tests |
| **python-checks.yml**   | PR / push         | `uv pip sync` → ruff → mypy → pytest                             |
| **deploy-web.yml**      | Tag `web-v*`      | Build Next app → Buildpack → Cloud Run                           |
| **deploy-terminal.yml** | Tag `terminal-v*` | Build AMD64 image → Cloud Run                                    |
| **infrastructure.yml**  | PR / push         | Terraform plan; apply when label `apply:"yes"` & branch = main   |

Container images are scanned with **Trivy** before push.

---

## 6 Dependency Management

* **Dependabot** monitors:

  * npm (`pnpm-lock.yaml`)
  * GitHub Actions
  * Terraform modules
* Merge bot PRs promptly; prefer patch > minor bumps during sprint.

---

## 7 Local Dev Scripts

| Script               | What it does                                                    |
| -------------------- | --------------------------------------------------------------- |
| `./scripts/setup.sh` | One‑time: install Husky hooks, pre‑commit, git config overrides |
| `./scripts/dev.sh`   | Start Convex, terminal‑server, and web with hot reload          |
| `./scripts/clean.sh` | Stop containers, clear caches, prune docker volumes             |

---

## 8 Code Style

* **ESLint** config from `@cpc/config/eslint-config`
* **Prettier**: 100‑column wrap; run `pnpm format` before commit.
* **Ruff** mirrors Black; run `uv run ruff check .` in `/apps/terminal-server`.

> **Automated:** pre‑commit hooks block commits that fail lint or format.

---

## 9 Security Best Practices

* Never commit secrets—use 1Password or GitHub Secrets.
* Dockerfiles must run as non‑root and include `USER` directive.
* Hard dependencies ≥ severity High are blocked by Trivy.

---

Happy hacking! 🎉
