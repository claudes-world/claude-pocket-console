# Claude Pocket Console

> Author: ChatGPT o3

A terminal-centric remote development console built with Next.js 15 and FastAPI.

## Quick Start (Local)

```bash
# 1 — install workspace deps
corepack enable pnpm
pnpm install
uv sync          # python

# 2 — bring up dev stack
./scripts/dev.sh
````

Visit **[http://localhost:3000](http://localhost:3000)** — sign in with GitHub and open **Terminal**.

> **Need the bigger picture?**
> See [`docs/architecture.md`](docs/architecture.md).
> For contribution rules, see [`docs/contributing.md`](docs/contributing.md).

````

---

### `docs/architecture.md`

```md
# Architecture Guide
_Last updated: <!-- yyyy-mm-dd -->_

## 1  Guiding Principles
| Goal | Decision |
|------|----------|
| Fast local dev | **pnpm + Turborepo** (remote cache on) |
| Lean Python | **uv** (no Poetry) |
| Clear boundaries | **apps/** deployables, **packages/** shared libs, **infrastructure/** IaC |
| Mobile path | **PWA + Capacitor first** |
| Security first | Docker sandbox: `--network none`, read-only FS, caps |
| Type safety | `@cpc/shared-types` emits TS _and_ JSON schemas |

## 2  Repo Layout
````

claude-pocket-console/
├─ apps/               # web, terminal-server
├─ packages/           # ui, shared-types, config
├─ infrastructure/     # convex, terraform, docker
└─ docs/               # this file + contributing.md

````

## 3  Tech Stack Matrix
| Concern | Version |
|---------|---------|
| Node | 20 LTS |
| Python | 3.12 |
| Next.js | 15.3 |
| Tailwind | v4 |
| FastAPI / Uvicorn | ≥0.111 / ≥0.30 |
| Infra | Terraform + GCP (CR, Cloud Run) |

## 4  Service Specs
### 4.1  apps/web
- **Auth:** Convex GitHub OAuth → cookie session  
- **Terminal UI:** `xterm.js` in shadcn Card  
- **State:** Convex live queries  

### 4.2  apps/terminal-server
- **WS /session/{id}:** raw binary frames  
- **Sandbox flags:** see `infrastructure/docker/`  

## 5  Turborepo Pipeline (excerpt)
```jsonc
{
  "dev": { "cache": false },
  "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] }
}
````

## 6  Environments & Deploy

| Env     | URL         | Notes                  |
| ------- | ----------- | ---------------------- |
| Local   | `localhost` | Docker Compose         |
| Staging | `*.run.app` | auto-deploy from `dev` |
| Prod    | `*.run.app` | manual tag → prod      |

## 7  Roadmap (Phase 1)

| Week | Deliverable            | Owner     |
| ---- | ---------------------- | --------- |
| 1    | Scaffold + CI green    | Core      |
| 2    | Terminal-server MVP    | Backend   |
| 3    | PWA + Capacitor shells | Mobile    |
| 4    | Security audit         | DevSecOps |

> *Appendices:* Docker flags, Convex schema diagram, sequence diagrams…

````

---

### `docs/contributing.md`

```md
# Contributing Guide
_Welcome! Please skim this before opening a PR._

## 1  Branch Strategy
- **main** → production
- **dev**  → staging
- feature branches: `feature/<brief-slug>`
- fixes: `fix/<brief-slug>`

## 2  Commit Style
Follow **Conventional Commits**  
Examples:
````

feat(web): add reconnect indicator
fix(terminal): ensure container cleanup on WS close

````

## 3  Pull Requests
1. Keep ≤ 400 changed lines (excluding lockfiles & generated code)  
2. Ensure `pnpm turbo lint type-check test` passes locally  
3. At least **one reviewer** approval required

## 4  Testing
- Frontend: **Vitest + RTL**  
- Backend: **pytest**  
- Target: **80 %** line coverage  
- Critical paths covered by **Playwright** E2E

## 5  CI Pipelines (GitHub Actions)
| Job | Trigger | Notes |
|-----|---------|-------|
| **ci.yml** | PR / push | lint → type-check → test |
| **deploy-web.yml** | tag `web-v*` | Build & push to Cloud Run |
| **deploy-terminal.yml** | tag `terminal-v*` | Build AMD64 image |
| **infrastructure.yml** | PR / push | Terraform plan; apply on label |

## 6  Dependency Updates
Dependabot enabled for:
- npm (`pnpm-lock.yaml`)
- GitHub Actions
- Terraform modules

## 7  Local Dev Scripts
```bash
./scripts/setup.sh   # one-time hooks & Husky
./scripts/dev.sh     # start web + terminal + convex
./scripts/clean.sh   # nuke caches and containers
````

## 8  Code Style

* **ESLint**: `@cpc/config/eslint-config`
* **Prettier**: 100-column wrap
* **Ruff**: mirrors Black formatting

> Questions? Ping @maintainers in Discord or open a discussion.

