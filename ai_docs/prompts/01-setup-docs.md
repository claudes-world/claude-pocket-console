# claude-pocket-console
Experimental UI for Claude Code

---

Monorepo for the Claude Pocket Console app.

Project is designed to be multiple services (projects/packages) involving different node and python built features.

The Objective of this project is to create a way to remotely use a Claude Code Agent - building out a suite of UIs, prompt templates, workflows,  and custom tools over time.

---

To start we need to setup a good foundation for a flexible monorepo. We should define structure and conventions for the project. 

We should use uv for python management. and pnpm for node management (or do you recommend something else?)

We should use shadcn for the UI framework.

We should use tailwind (v4) for the CSS framework.

We should use nextjs 15.3 with app router and typescript.

We might use Expo for the mobile app. Or capacitor for the mobile app.

We should use convex for the database, auth, vector database, and storage.
We will authenticate with github oauth.

We will use docker compose to manage the docker containers.

We will use terraform to manage the infrastructure in google cloud.

We will use github actions to manage the CI/CD pipeline.

We will use github to manage the codebase.

We will use github to manage the issues and project boards.

---

We will start with this:

1) a server that can run terminal commands inside a docker container and return the output. this is a basic pass through bridge to create a terminal session in a (semi) isolated and disposable environment. 

2) a frontend react app for our dev UI. we will create buttons and inputs and screens to test the server.

3) convex database infrastructure as code project


can we design this as 3 services in a monorepo or will we need to split it into 3 separate projects?

help me plan out the project and the services.




---




can you please compare these two plans for setting up a monorepo?



<PLAN-ONE>

Below is the **single-source “master plan”** that folds every converged decision into one place. You can drop it straight into README.md (or print it for the team) and start scaffolding with zero ambiguity.



---



## 0 . Guiding Principles



| Goal                   | Decision                                                                                                    |

| ---------------------- | ----------------------------------------------------------------------------------------------------------- |

| **Fast local dev**     | pnpm + Turborepo (remote cache **enabled** day-1)                                                         |

| **Lean Python**        | uv only; no Poetry                                                                                        |

| **Clear boundaries**   | **apps/** = deployables, **packages/** = shared libs/config, **infrastructure/** = IaC                      |

| **Mobile path**        | Ship as **PWA + Capacitor wrapper** first; revisit Expo Dev Client only if we need deeper RN APIs           |

| **Security first**     | Hardened Docker sandbox for every terminal session (--network none, read-only FS, rootless, CPU/RAM caps) |

| **Keep Types in sync** | packages/shared-types generates and exports both TS & JSON schemas                                        |



---



## 1 . Repo Layout



claude-pocket-console/

├─ .github/

│  └─ workflows/

│      ├─ ci.yml               # lint, test, type-check, build (cached)

│      ├─ deploy-web.yml       # Web → Cloud Run

│      ├─ deploy-terminal.yml  # Terminal Server → Cloud Run

│      └─ tf-plan-apply.yml    # Terraform plan & gated apply

├─ .gitignore

├─ docker-compose.yml          # local dev stack (see §6)

├─ turbo.json                  # task graph + remote cache config

├─ package.json                # root scripts, husky hooks

├─ pnpm-workspace.yaml

├─ uv.toml                     # root Python settings

├─ apps/

│  ├─ web/                     # Next 15.3 App Router + shadcn + Tailwind v4

│  └─ terminal-server/         # FastAPI + raw WebSockets

├─ packages/

│  ├─ ui/                      # shared React components (shadcn-based)

│  ├─ shared-types/            # Zod schemas → TS & JSON

│  └─ config/                  # eslint / prettier / tsconfig / ruff configs

└─ infrastructure/

   ├─ convex/                  # Convex schema + prod key

   ├─ terraform/               # GCP resources & Cloud Run modules

   └─ docker/                  # Hardened container templates




---



## 2 . Tech Stack Pin-list



| Concern                | Version                                                                         |

| ---------------------- | ------------------------------------------------------------------------------- |

| **Node**               | 20 LTS                                                                          |

| **Python**             | 3.12                                                                            |

| **Next.js**            | 15.3 (canary OK)                                                                |

| **Tailwind**           | v4 (oxide)                                                                      |

| **Turborepo**          | latest (remote cache → Vercel)                                                  |

| **FastAPI / Uvicorn**  | fastapi >=0.111, uvicorn >=0.30                                             |

| **Docker base images** | python:3.12-slim (rootless, non-priv)                                         |

| **GCP Targets**        | Artifact Registry → Cloud Run (regional), Cloud SQL (if Convex self-host later) |



---



## 3 . Service Specs



### 3.1 apps/web (Next 15.3)



| Feature          | Detail                                                                                                                           |

| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |

| **Auth**         | Convex GitHub OAuth → cookie session                                                                                             |

| **Terminal UI**  | xterm.js wrapped in a shadcn Card; Connection hook adds auto-reconnect/back-off logic (close → retry after 1 s, 2 s, … 30 s) |

| **State**        | Convex queries for session list, live session doc subscription for stdout/err aggregation                                        |

| **Mobile shell** | Same code runs inside Capacitor (capacitor-cli in **apps/web/capacitor/**)                                                     |

| **Testing**      | Vitest + React Testing Library; Playwright e2e on CI “preview” step                                                              |



### 3.2 apps/terminal-server (Python / FastAPI)



| Endpoint               | Purpose                                                                     |

| ---------------------- | --------------------------------------------------------------------------- |

| POST /session        | Spin up a new container → returns session_id                              |

| DELETE /session/{id} | Graceful stop + removal                                                     |

| GET /healthz         | Liveness for Cloud Run                                                      |

| WS /session/{id}     | Raw binary frames: {stdin} client→server, {stdout,stderr} server→client |



**Container launch flags**



bash

docker run --pull=never \

  --network none \

  --pids-limit 512 \

  --read-only --tmpfs /tmp:size=64m \

  --memory 256m --cpus 0.5 \

  --user $(id -u):$(id -g) \

  --name term-${SESSION_ID} \

  cpc/sandbox:latest




Idle timeout = 5 min (configurable via ENV).



### 3.3 infrastructure



| Module         | Contents                                                                                                                 |

| -------------- | ------------------------------------------------------------------------------------------------------------------------ |

| **convex/**    | schema.ts, convex.json, GitHub OAuth app id/secret                                                                   |

| **terraform/** | main.tf (project + region), modules/cloudrun_service, modules/artifact_registry, Workload Identity for GitHub OIDC |

| **docker/**    | Hardened Dockerfile templates + Trivy scan GH Action                                                                     |



---



## 4 . Shared Tooling Packages



| Package                     | Exports                                                                                                                       |

| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |

| @cpc/config/eslint-config | extends Airbnb/Next, Tailwind plugin, React hooks rules                                                                       |

| @cpc/config/tsconfig      | strict, path-aliases for @/                                                                                               |

| @cpc/config/ruff          | ruff.toml with Black-compatible formatting                                                                                  |

| @cpc/ui                   | TerminalPane, ReconnectIndicator, ThemeToggle, Card                                                                   |

| @cpc/shared-types         | Zod schemas for Session, User, CommandLog; build script emits dist/*.d.ts + schemas/*.json (for FastAPI validation) |



---



## 5 . Turborepo (turbo.json)



json

{

  "$schema": "https://turbo.build/schema.json",

  "globalDependencies": ["turbo.json", "pnpm-lock.yaml", "uv.toml"],

  "pipeline": {

    "dev": { "cache": false, "dependsOn": ["^dev"], "outputs": [] },

    "lint": { "outputs": [] },

    "type-check": { "outputs": [] },

    "test": { "dependsOn": ["lint", "type-check"], "outputs": [] },

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




---



## 6 . Local Dev (docker-compose.yml)



yaml

version: "3.9"

services:

  convex:

    image: ghcr.io/get-convex/convex-dev:latest

    ports: ["18888:18888"]

    volumes: ["./infrastructure/convex:/convex"]



  terminal-server:

    build:

      context: ./apps/terminal-server

      dockerfile: Dockerfile.dev        # mounts src for hot-reload

    environment:

      - PYTHONUNBUFFERED=1

      - UVICORN_RELOAD=true

    volumes:

      - /var/run/docker.sock:/var/run/docker.sock



  web:

    build:

      context: ./apps/web

      dockerfile: Dockerfile.dev

    command: pnpm turbo dev --filter=web

    env_file: ./apps/web/.env.local

    ports: ["3000:3000"]

    depends_on: [convex, terminal-server]




---



## 7 . GitHub Actions Highlights



| File                    | Jobs                                                                                                                                 |

| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |

| **ci.yml** (push/PR)    | setup-pnpm → pnpm i → Turbo lint, type-check, test (runs in matrix: ubuntu-latest/Node 20 & macos-latest/Node 20)          |

| **deploy-web.yml**      | On tag web-v* ➜ build Next static + API → Buildpack → Cloud Run                                                                    |

| **deploy-terminal.yml** | On tag terminal-v* ➜ docker build --platform=linux/amd64 → push → Cloud Run revision traffic 100 %                               |

| **tf-plan-apply.yml**   | on: pull_request, push → terraform plan -no-color → comment; if branch = main + apply: "yes" label present → terraform apply |



---



## 8 . Bootstrap Commands



bash

# prerequisites: corepack enable; pnpm & uv on PATH; docker daemon running

git clone git@github.com:<you>/claude-pocket-console.git

cd claude-pocket-console



# install Node deps & link workspaces

pnpm install



# sync python deps once (uv uses lockfile snapshots)

uv sync



# dev-up everything

docker-compose up -d convex

pnpm turbo dev          # starts web + terminal-server with live reload




Visit **[http://localhost:3000](http://localhost:3000)**, sign in with GitHub, open the *Terminal* page, and you should see a live shell inside an isolated container.



---



## 9 . Phase-1 Roadmap (4 weeks)



| Week | Deliverable                                                         | Owner      |

| ---- | ------------------------------------------------------------------- | ---------- |

| 1    | Repo scaffold + CI green on “hello world” builds                    | Core       |

| 1    | Convex schema (users, sessions) + GitHub OAuth flow             | Backend    |

| 2    | Terminal-server MVP (echo & ls allowed) + hardened Docker flags | Backend    |

| 2    | Front-end terminal UI with reconnect & theme toggle                 | Frontend   |

| 3    | PWA service-worker, Capacitor iOS/Android shells buildable          | Mobile     |

| 3    | Cloud Run staging environment via Terraform                         | DevOps     |

| 4    | Logging to Convex vector store; basic usage dashboard               | Full-stack |

| 4    | Security review + Trivy scan gating images in CI                    | DevSecOps  |



---



### Done 🎉



This hybrid blueprint merges structural clarity, operational rigor, and a pragmatic mobile path.  You can start committing folders and let Turborepo’s remote cache do its magic while each service evolves in parallel.

</PLAN-ONE>



<PLAN-TWO>

# Claude Pocket Console - Final Monorepo Architecture Plan



## Project Overview



A monorepo containing three core services:

1. **Web Console** - Next.js 15.3 frontend with terminal UI

2. **Terminal Server** - Python FastAPI service for isolated command execution

3. **Infrastructure** - Convex backend + Terraform IaC for GCP



## Directory Structure



claude-pocket-console/

├── .github/

│   ├── workflows/

│   │   ├── ci.yml                 # Lint, test, build on PR/push

│   │   ├── deploy-web.yml         # Deploy web to Cloud Run

│   │   ├── deploy-terminal.yml   # Deploy terminal server

│   │   └── infrastructure.yml    # Terraform plan/apply

│   └── dependabot.yml

├── apps/

│   ├── web/                      # Next.js 15.3 frontend

│   │   ├── src/

│   │   │   ├── app/             # App router pages

│   │   │   ├── components/      # Local components

│   │   │   ├── hooks/           # Custom hooks (useWebSocket, etc.)

│   │   │   └── lib/             # Utils and clients

│   │   ├── public/

│   │   ├── next.config.mjs

│   │   ├── package.json

│   │   ├── tailwind.config.ts

│   │   └── tsconfig.json

│   └── terminal-server/          # Python FastAPI service

│       ├── src/

│       │   ├── main.py

│       │   ├── websocket.py

│       │   ├── docker_manager.py

│       │   └── security.py

│       ├── tests/

│       ├── Dockerfile

│       ├── pyproject.toml

│       └── README.md

├── packages/

│   ├── ui/                       # Shared React components (shadcn)

│   │   ├── src/

│   │   │   └── components/

│   │   ├── package.json

│   │   └── tsconfig.json

│   ├── shared-types/             # TypeScript interfaces

│   │   ├── src/

│   │   │   ├── terminal.ts

│   │   │   ├── session.ts

│   │   │   └── index.ts

│   │   ├── package.json

│   │   └── tsconfig.json

│   └── config/                   # Shared configs

│       ├── eslint/

│       │   └── index.js

│       ├── prettier/

│       │   └── index.js

│       ├── tsconfig/

│       │   ├── base.json

│       │   ├── nextjs.json

│       │   └── react-library.json

│       └── package.json

├── infrastructure/

│   ├── convex/                   # Convex backend

│   │   ├── _generated/

│   │   ├── convex/

│   │   │   ├── schema.ts

│   │   │   ├── auth.ts

│   │   │   ├── users.ts

│   │   │   ├── sessions.ts

│   │   │   └── commands.ts

│   │   ├── package.json

│   │   └── convex.json

│   ├── terraform/                # GCP infrastructure

│   │   ├── environments/

│   │   │   ├── dev/

│   │   │   │   ├── terraform.tfvars

│   │   │   │   └── backend.tf

│   │   │   └── prod/

│   │   │       ├── terraform.tfvars

│   │   │       └── backend.tf

│   │   ├── modules/

│   │   │   ├── cloud-run/

│   │   │   ├── networking/

│   │   │   └── iam/

│   │   ├── main.tf

│   │   ├── variables.tf

│   │   └── outputs.tf

│   └── docker/

│       ├── compose.yml           # Production-like local stack

│       └── compose.dev.yml       # Development overrides

├── scripts/

│   ├── setup.sh                  # One-time setup

│   ├── dev.sh                    # Start dev environment

│   └── clean.sh                  # Clean all artifacts

├── .dockerignore

├── .gitignore

├── .nvmrc                        # Node 20 LTS

├── package.json                  # Root workspace

├── pnpm-workspace.yaml

├── turbo.json                    # Turborepo config

├── uv.toml                       # Python workspace config

└── README.md




## Technology Stack



| Category | Choice | Rationale |

|----------|--------|-----------|

| **Package Managers** | pnpm 9.x (Node), uv 1.x (Python) | Fast, deterministic, great monorepo support |

| **Build Orchestration** | Turborepo with remote cache | Parallel builds, smart caching, CI speed |

| **Frontend** | Next.js 15.3 (App Router) + TypeScript | Modern React, great DX, built-in optimizations |

| **Styling** | Tailwind CSS v4 + shadcn/ui | Utility-first, component library |

| **Backend** | FastAPI + uvicorn | Async Python, WebSocket support, fast |

| **Database/Auth** | Convex | Real-time, GitHub OAuth, built-in file storage |

| **Mobile** | PWA first, Capacitor ready | Best web performance, native bridge if needed |

| **Infrastructure** | Terraform + Google Cloud | IaC, Cloud Run for containers |

| **Containers** | Docker + Docker Compose | Local dev parity, production builds |

| **CI/CD** | GitHub Actions | Native integration, good monorepo support |



## Service Specifications



### 1. Terminal Server (Python)



**Core Features:**

- WebSocket-based terminal sessions

- Docker container isolation per session

- Automatic session cleanup on disconnect

- Resource usage limits and timeouts



**Security Hardening:**

python

# Container creation with full isolation

container = docker_client.containers.run(

    "ubuntu:latest",

    command="/bin/bash",

    detach=True,

    tty=True,

    stdin_open=True,

    remove=True,

    # Security configurations

    network_mode="none",              # No network access

    read_only=True,                   # Read-only root filesystem

    tmpfs={"/tmp": "size=100M"},      # Writable /tmp in memory

    mem_limit="512m",                 # Memory limit

    memswap_limit="512m",             # Swap limit (same as mem = no swap)

    cpu_shares=512,                   # CPU limit (half of 1024)

    pids_limit=100,                   # Process limit

    security_opt=["no-new-privileges"],

    user="nobody",                    # Run as nobody user

    userns_mode="host",              # User namespace remapping

    labels={

        "session_id": session_id,

        "created_at": datetime.utcnow().isoformat()

    }

)




**API Endpoints:**

- POST /api/v1/sessions - Create new session

- DELETE /api/v1/sessions/{id} - Terminate session

- GET /api/v1/sessions/{id}/status - Get session status

- WS /ws/terminal/{session_id} - Terminal WebSocket



### 2. Web Console (Next.js)



**Key Components:**

- TerminalEmulator - xterm.js wrapper with reconnecting WebSocket

- SessionManager - Handle multiple terminal sessions

- AuthGuard - Convex-based authentication wrapper

- CommandPalette - Quick actions (reset, clear, upload)



**WebSocket Reconnection Layer:**

typescript

// hooks/useReconnectingWebSocket.ts

export function useReconnectingWebSocket(url: string) {

  const [socket, setSocket] = useState<WebSocket | null>(null);

  const [isConnected, setIsConnected] = useState(false);

  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  const reconnectAttemptsRef = useRef(0);



  const connect = useCallback(() => {

    try {

      const ws = new WebSocket(url);

      

      ws.onopen = () => {

        setIsConnected(true);

        reconnectAttemptsRef.current = 0;

      };



      ws.onclose = () => {

        setIsConnected(false);

        // Exponential backoff: 1s, 2s, 4s, 8s, max 30s

        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);

        reconnectAttemptsRef.current++;

        

        reconnectTimeoutRef.current = setTimeout(connect, delay);

      };



      setSocket(ws);

    } catch (error) {

      console.error('WebSocket connection failed:', error);

    }

  }, [url]);



  // Auto-reconnect on mount and cleanup on unmount

  useEffect(() => {

    connect();

    return () => {

      clearTimeout(reconnectTimeoutRef.current);

      socket?.close();

    };

  }, [connect]);



  return { socket, isConnected, reconnect: connect };

}




### 3. Infrastructure (Convex + Terraform)



**Convex Schema:**

typescript

// convex/schema.ts

import { defineSchema, defineTable } from "convex/server";

import { v } from "convex/values";



export default defineSchema({

  users: defineTable({

    githubId: v.string(),

    username: v.string(),

    email: v.string(),

    avatarUrl: v.optional(v.string()),

    createdAt: v.number(),

  }).index("by_github_id", ["githubId"]),



  sessions: defineTable({

    userId: v.id("users"),

    sessionId: v.string(),

    status: v.union(v.literal("active"), v.literal("terminated")),

    startedAt: v.number(),

    endedAt: v.optional(v.number()),

    metadata: v.optional(v.object({

      containerInfo: v.string(),

      resourceUsage: v.object({

        cpuSeconds: v.number(),

        memoryMB: v.number(),

      }),

    })),

  }).index("by_user", ["userId"])

    .index("by_session", ["sessionId"]),



  commands: defineTable({

    sessionId: v.id("sessions"),

    command: v.string(),

    output: v.string(),

    executedAt: v.number(),

    exitCode: v.optional(v.number()),

  }).index("by_session", ["sessionId"]),

});




## Development Workflow



### Initial Setup

bash

# Prerequisites: Node 20+, Python 3.12+, Docker, pnpm, uv



# 1. Clone and install

git clone <repo>

cd claude-pocket-console

corepack enable pnpm

pnpm install



# 2. Python setup

cd apps/terminal-server

uv venv

uv pip sync requirements.txt

cd ../..



# 3. Environment setup

cp .env.example .env.local

# Add your Convex deploy key, GitHub OAuth secrets



# 4. Start everything

./scripts/dev.sh




### Development Scripts



**turbo.json:**

json

{

  "$schema": "https://turbo.build/schema.json",

  "remoteCache": {

    "enabled": true

  },

  "globalDependencies": ["**/.env.*local"],

  "pipeline": {

    "dev": {

      "cache": false,

      "persistent": true,

      "dependsOn": []

    },

    "build": {

      "dependsOn": ["^build"],

      "outputs": [".next/**", "!.next/cache/**", "dist/**"]

    },

    "lint": {

      "dependsOn": ["^build"],

      "outputs": []

    },

    "type-check": {

      "dependsOn": ["^build"],

      "outputs": []

    },

    "test": {

      "dependsOn": ["build"],

      "outputs": ["coverage/**"]

    }

  }

}




**docker/compose.dev.yml:**

yaml

version: "3.9"



services:

  terminal-server:

    build:

      context: ../apps/terminal-server

      dockerfile: Dockerfile.dev

    volumes:

      - ../apps/terminal-server/src:/app/src

      - /var/run/docker.sock:/var/run/docker.sock

    environment:

      - PYTHONUNBUFFERED=1

      - ENV=development

    ports:

      - "8000:8000"

    command: uvicorn src.main:app --reload --host 0.0.0.0



  web:

    build:

      context: ../apps/web

      dockerfile: Dockerfile.dev

    volumes:

      - ../apps/web:/app

      - /app/node_modules

      - /app/.next

    environment:

      - NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws

      - NEXT_PUBLIC_CONVEX_URL=${CONVEX_URL}

    ports:

      - "3000:3000"

    command: pnpm dev



  # Convex dev server (optional, can use cloud)

  convex:

    image: node:20-alpine

    working_dir: /app

    volumes:

      - ../infrastructure/convex:/app

    ports:

      - "3210:3210"

    command: npx convex dev




## CI/CD Pipeline



### GitHub Actions Workflows



**.github/workflows/ci.yml:**

yaml

name: CI



on:

  pull_request:

  push:

    branches: [main, dev]



jobs:

  lint-and-test:

    runs-on: ubuntu-latest

    steps:

      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v3

      - uses: actions/setup-node@v4

        with:

          node-version: 20

          cache: 'pnpm'

      

      - name: Install dependencies

        run: pnpm install --frozen-lockfile

      

      - name: Run linters

        run: pnpm turbo lint

      

      - name: Type check

        run: pnpm turbo type-check

      

      - name: Run tests

        run: pnpm turbo test



  python-checks:

    runs-on: ubuntu-latest

    steps:

      - uses: actions/checkout@v4

      - uses: astral-sh/setup-uv@v3

      

      - name: Install dependencies

        run: |

          cd apps/terminal-server

          uv venv

          uv pip sync requirements.txt

      

      - name: Run ruff

        run: |

          cd apps/terminal-server

          uv run ruff check .

      

      - name: Run mypy

        run: |

          cd apps/terminal-server

          uv run mypy .

      

      - name: Run tests

        run: |

          cd apps/terminal-server

          uv run pytest




## Security Considerations



1. **Container Isolation**

   - No network access (--network none)

   - Read-only filesystem with tmpfs for /tmp

   - User namespace remapping

   - Resource limits (CPU, memory, PIDs)

   - Run as nobody user



2. **Session Management**

   - Automatic cleanup after 5 minutes idle

   - Maximum session duration of 1 hour

   - Rate limiting per user

   - Command audit logging in Convex



3. **Authentication**

   - GitHub OAuth via Convex

   - Session tokens with expiration

   - CORS properly configured



4. **Data Protection**

   - All WebSocket traffic over TLS in production

   - No persistent storage in containers

   - Encrypted at rest in Convex



## Deployment Strategy



### Environments

- **Development**: Local Docker Compose

- **Staging**: GCP project with -staging suffix

- **Production**: Separate GCP project with stricter IAM



### Release Process

1. PR → dev branch (auto-deploy to staging)

2. dev → main (manual approval required)

3. Tag release → production deployment



### Infrastructure Components

- **Google Cloud Run**: Both web and terminal services

- **Cloud Build**: Build and push Docker images

- **Artifact Registry**: Store Docker images

- **Cloud Load Balancer**: WebSocket-aware routing

- **Cloud Armor**: DDoS protection



## Future Roadmap



### Phase 1 (MVP)

- [x] Basic terminal execution

- [x] WebSocket streaming

- [x] GitHub authentication

- [x] Session management



### Phase 2

- [ ] File upload/download

- [ ] Multiple concurrent sessions

- [ ] Command history search

- [ ] Basic usage analytics



### Phase 3

- [ ] Mobile app (Capacitor)

- [ ] Collaborative sessions

- [ ] Custom Docker images

- [ ] Plugin system



### Phase 4

- [ ] Claude integration

- [ ] Workflow automation

- [ ] Vector search for commands

- [ ] Advanced security policies



## Conventions



| Area | Convention |

|------|------------|

| **Git Branches** | main (prod), dev (staging), feature/*, fix/* |

| **Commit Style** | Conventional Commits (feat:, fix:, docs:, etc.) |

| **PR Size** | Max 400 lines changed (exclude generated files) |

| **Code Review** | Required from 1 team member |

| **Testing** | 80% coverage target, E2E for critical paths |

| **Documentation** | README per service, inline JSDoc/docstrings |

</PLAN-TWO>



can you compare and contrast both approaches. explain pros and cons of each. highlight similarities and differences in design choices. then explain which pieces of each approach you think are the best choices.



just give me this review. we will refine an updated plan after.





