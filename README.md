# Claude Pocket Console

A secure, real-time web terminal powered by isolated Docker containers, built with Next.js 15 and FastAPI.

## Overview

Claude Pocket Console provides developers with instant access to secure, isolated terminal sessions through their web browser. Each session runs in a hardened Docker container with no network access, ensuring safety while maintaining full terminal functionality.

## Guiding Principles

| Goal | Decision |
| --- | --- |
| **Fast local dev** | pnpm + Turborepo with remote caching enabled from day 1 |
| **Lean Python** | uv only for Python dependencies, no Poetry/pipenv |
| **Clear boundaries** | `apps/` for deployables, `packages/` for shared libs, `infrastructure/` for IaC |
| **Security first** | Every terminal session runs in a rootless Docker sandbox with strict isolation |
| **Type safety** | Zod schemas in `packages/shared-types` generate both TypeScript and JSON schemas |
| **Mobile ready** | Progressive Web App with Capacitor wrapper for native app distribution |

## Quick Start

```bash
# Prerequisites: Node 20+, Python 3.12+, Docker, pnpm, uv

# 1. Clone and install dependencies
git clone git@github.com:your-org/claude-pocket-console.git
cd claude-pocket-console
pnpm install

# 2. Configure environment
cp .env.example .env.local
# Add your Convex deploy key and GitHub OAuth credentials

# 3. Start development environment
pnpm dev
```

Visit http://localhost:3000, sign in with GitHub, and open the Terminal page.

## Tech Stack

| Category | Technology | Version/Details |
| --- | --- | --- |
| **Frontend** | Next.js (App Router) | 15.3 with TypeScript |
| **Backend** | FastAPI + Uvicorn | ≥0.111 / ≥0.30 |
| **Database & Auth** | Convex | Real-time sync, GitHub OAuth |
| **Styling** | Tailwind CSS + shadcn/ui | v4 (oxide) |
| **Build** | Turborepo | With remote caching |
| **Infrastructure** | Terraform + GCP | Cloud Run, Artifact Registry |
| **Containers** | Docker | Rootless, isolated sandboxes |

## Repository Structure

```
claude-pocket-console/
├── apps/                    # Deployable applications
│   ├── web/                 # Next.js frontend
│   └── terminal-server/     # FastAPI WebSocket backend
├── packages/                # Shared libraries
│   ├── ui/                  # React components (shadcn-based)
│   ├── shared-types/        # Zod schemas → TS + JSON
│   └── config/              # Shared configs (ESLint, TS)
├── infrastructure/          # Infrastructure as Code
│   ├── convex/              # Backend schema and functions
│   ├── terraform/           # GCP resource definitions
│   └── docker/              # Container configurations
└── docs/                    # Additional documentation
```

## Basic Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Start all services with hot reload |
| `pnpm build` | Build all packages for production |
| `pnpm lint` | Run ESLint and Ruff checks |
| `pnpm test` | Run all test suites |
| `pnpm clean` | Remove build artifacts and caches |

## Where to Go Next

- **[Architecture Guide](docs/ARCHITECTURE.md)** - System design, service specifications, and API reference
- **[Development Guide](docs/DEVELOPMENT.md)** - Detailed setup, debugging, and local development workflows  
- **[Deployment Guide](docs/DEPLOYMENT.md)** - Infrastructure, CI/CD pipelines, and production deployment
- **[Contributing](/.github/CONTRIBUTING.md)** - Guidelines for contributing to the project

For service-specific details, see the README files in `apps/web` and `apps/terminal-server`.

## License

[License details to be added]