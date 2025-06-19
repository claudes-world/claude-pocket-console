# Claude Pocket Console – Architecture Guide

>Author: ChatGPT o3

*Last updated: 2025‑06‑19*

---

## 1  Guiding Principles

| Goal                      | Decision                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Fast local dev**        | **pnpm + Turborepo** with remote cache enabled from day 1                                                          |
| **Lean Python toolchain** | **uv** only (no Poetry), lockfile committed                                                                        |
| **Clear boundaries**      | **apps/** = deployables, **packages/** = shared libs/config, **infrastructure/** = IaC & hardened Docker templates |
| **Mobile path**           | Ship as **PWA + Capacitor** first; add Expo Dev Client only if deeper RN APIs are required                         |
| **Security first**        | Each terminal session runs in a root‑less Docker sandbox (`--network none`, read‑only FS, CPU/RAM/PID caps)        |
| **Type alignment**        | `@cpc/shared-types` emits TypeScript **and** JSON Schemas so FastAPI & Convex share a single source of truth       |

---

## 2  Monorepo Layout (high‑level)

```text
claude-pocket-console/
├─ apps/                # deployable services
│  ├─ web/              # Next 15.3 PWA + Capacitor shell
│  └─ terminal-server/  # FastAPI WebSocket backend
├─ packages/            # ui, shared‑types, config
├─ infrastructure/      # convex, terraform, docker (hardened base images)
└─ docs/                # architecture.md, contributing.md, design ADRs
```

> **Naming rule** — if it ships independently, it lives in **apps/**. Everything else goes to **packages/** or **infrastructure/**.

---

## 3  Tech‑Stack Pin‑list

| Concern             | Version / Choice                       | Notes                                          |
| ------------------- | -------------------------------------- | ---------------------------------------------- |
| Node.js             | **20 LTS**                             | via `.nvmrc`                                   |
| Python              | **3.12**                               | slim rootless base images                      |
| Frontend            | **Next.js 15.3** (App Router)          | Canary allowed                                 |
| Styling             | **Tailwind v4** + **shadcn/ui**        | Mobile‑first                                   |
| Backend             | **FastAPI ≥0.111** + **uvicorn ≥0.30** | Async, typed                                   |
| Data/Auth           | **Convex** (GitHub OAuth)              | Real‑time queries                              |
| Build orchestration | **Turborepo**                          | Remote cache → Vercel                          |
| Containers          | Docker (rootless)                      | Hardened templates in `infrastructure/docker/` |
| IaC                 | **Terraform 1.8+**                     | GCP: Artifact Registry & Cloud Run             |
| CI/CD               | **GitHub Actions**                     | OIDC → GCP deploy, Trivy image scans           |

---

## 4  Service Specifications

### 4.1  `apps/web`

* **Auth** – Convex GitHub OAuth ➔ Http‑only cookie session
* **Terminal UI** – `xterm.js` wrapped in shadcn `Card`; adaptive theme toggle.
* **WebSocket client** – custom hook with exponential back‑off (1 s → 30 s) and offline indicator.
* **State** – Convex live query for session list; document subscription streams stdout/stderr.
* **Mobile shell** – Capacitor project lives in `apps/web/capacitor/`; same codepath as PWA.
* **Testing** – Vitest + React Testing Library; Playwright E2E in CI preview job.

### 4.2  `apps/terminal-server`

* **Endpoints**  |

  | Path            | Method     | Purpose                                                |
  | --------------- | ---------- | ------------------------------------------------------ |
  | `/session`      | **POST**   | Launch new sandbox, return `session_id`                |
  | `/session/{id}` | **DELETE** | Graceful shutdown + removal                            |
  | `/healthz`      | **GET**    | Cloud Run liveness                                     |
  | `/session/{id}` | **WS**     | Binary frames — client → stdin, server → stdout/stderr |

* **Sandbox flags (default)**

```bash
docker run \
  --network none \
  --pids-limit 512 \
  --read-only --tmpfs /tmp:size=64m \
  --memory 256m --cpus 0.5 \
  --user $(id -u):$(id -g) \
  --name term-${SESSION_ID} \
  cpc/sandbox:latest
```

* **Timeouts** – idle = 5 min (ENV override), max‑lifetime = 60 min.

### 4.3  `infrastructure/`

* **convex/** – schema, auth functions, prod key.
* **terraform/** – reusable modules: `cloudrun_service`, `artifact_registry`, `iam_workload_identity`.
* **docker/** – slim, non‑privileged base images; automated Trivy scan in CI.

---

## 5  Turborepo Pipeline (excerpt)

```jsonc
{
  "globalDependencies": ["turbo.json", "pnpm-lock.yaml", "uv.toml"],
  "pipeline": {
    "dev": { "cache": false, "outputs": [] },
    "lint": { "outputs": [] },
    "type-check": { "outputs": [] },
    "test": {
      "dependsOn": ["lint", "type-check"],
      "outputs": []
    },
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "build/**"]
    }
  },
  "remoteCache": {
    "url": "https://cache.turbocache.dev/workspace/<YOUR-ID>",
    "enabled": true
  }
}
```

---

## 6  Environments & Deployment Flow

| Stage          | Source Branch  | URL pattern           | Notes                                                        |
| -------------- | -------------- | --------------------- | ------------------------------------------------------------ |
| **Local**      | n/a            | `localhost`           | `docker compose -f infrastructure/docker/compose.dev.yml up` |
| **Staging**    | `dev`          | `<hash>-dev.run.app`  | Auto‑deploy on push; tier‑2 CPU/mem                          |
| **Production** | `main` (+ tag) | `console.example.com` | Manual GitHub Release triggers workflow                      |

**Release steps**

1. Merge PR → `dev` ➔ staging preview.
2. QA approves ➔ squash into `main`.
3. Create tag `web-v*` or `terminal-v*` ➔ GitHub Actions builds AMD64 image & flips Cloud Run traffic 100 %.

---

## 7  Phase‑1 Roadmap (4 weeks)

| Week | Deliverable                                                | Owner      |
| ---- | ---------------------------------------------------------- | ---------- |
|  1   | Repo scaffold, CI green (lint, test, build)                | Core       |
|  1   | Convex schema (`users`, `sessions`) + GitHub OAuth         | Backend    |
|  2   | Terminal‑server MVP (`echo`, `ls`) + hardened Docker flags | Backend    |
|  2   | Front‑end terminal UI with reconnect & theme toggle        | Frontend   |
|  3   | PWA service‑worker, Capacitor iOS/Android shells           | Mobile     |
|  3   | Cloud Run staging via Terraform + OIDC                     | DevOps     |
|  4   | Logging to Convex vector store; basic usage dashboard      | Full‑stack |
|  4   | Security review + Trivy gate in CI                         | DevSecOps  |

---

## 8  Appendix – Shared Packages

| Package                     | What it exports                                             |
| --------------------------- | ----------------------------------------------------------- |
| `@cpc/ui`                   | `TerminalPane`, `ReconnectIndicator`, `ThemeToggle`, `Card` |
| `@cpc/shared-types`         | Zod schemas ⇢ `.d.ts` & `.json` for FastAPI validation      |
| `@cpc/config/eslint-config` | Extends Airbnb/Next, hooks rules, Tailwind plugin           |
| `@cpc/config/tsconfig`      | Strict TS, `@/*` path alias                                 |
| `@cpc/config/ruff`          | Black‑compatible formatting rules                           |

---

*Questions or change requests?* Open an **Architecture Discussion** on GitHub or ping `@architects` in Discord.
