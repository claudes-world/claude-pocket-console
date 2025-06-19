# Claude Pocket Console - Master Plan
>Author: Claude Opus 4.0
## 0. Guiding Principles

| Goal                   | Decision                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Fast local dev**     | `pnpm + Turborepo` (remote cache **enabled** day-1)                                                         |
| **Lean Python**        | `uv` only; no Poetry                                                                                        |
| **Clear boundaries**   | **apps/** = deployables, **packages/** = shared libs/config, **infrastructure/** = IaC                      |
| **Mobile path**        | Ship as **PWA + Capacitor wrapper** first; revisit Expo Dev Client only if we need deeper RN APIs           |
| **Security first**     | Hardened Docker sandbox for every terminal session (`--network none`, read-only FS, rootless, CPU/RAM caps) |
| **Keep Types in sync** | `packages/shared-types` generates and exports both TS & JSON schemas                                        |

## 1. Quick Start

```bash
# Prerequisites: Node 20+, Python 3.12+, Docker, pnpm, uv

git clone git@github.com:<you>/claude-pocket-console.git
cd claude-pocket-console

# Install dependencies
pnpm install

# Start everything
pnpm dev
```

Visit **http://localhost:3000**, sign in with GitHub, open the Terminal page.

## 2. Tech Stack Pin-list

| Concern                | Version                                                                         |
| ---------------------- | ------------------------------------------------------------------------------- |
| **Node**               | 20 LTS                                                                          |
| **Python**             | 3.12                                                                            |
| **Next.js**            | 15.3 (canary OK)                                                                |
| **Tailwind**           | v4 (oxide)                                                                      |
| **Turborepo**          | latest (remote cache → Vercel)                                                  |
| **FastAPI / Uvicorn**  | `fastapi >=0.111`, `uvicorn >=0.30`                                             |
| **Docker base images** | `python:3.12-slim` (rootless, non-priv)                                         |
| **GCP Targets**        | Artifact Registry → Cloud Run (regional), Cloud SQL (if Convex self-host later) |

## 3. Repository Structure

```
claude-pocket-console/
├─ .github/workflows/         # CI/CD pipelines
├─ apps/
│  ├─ web/                   # Next.js 15.3 frontend
│  └─ terminal-server/       # FastAPI WebSocket service
├─ packages/
│  ├─ ui/                    # Shared React components
│  ├─ shared-types/          # TypeScript + JSON schemas
│  └─ config/                # Shared configs (ESLint, TS, etc.)
├─ infrastructure/
│  ├─ convex/                # Real-time backend
│  ├─ terraform/             # GCP infrastructure
│  └─ docker/                # Container configs
├─ scripts/                  # Dev automation
├─ docker-compose.yml        # Local development
├─ turbo.json               # Build orchestration
├─ pnpm-workspace.yaml      # Monorepo config
└─ README.md                # You are here
```

## 4. Service Architecture

### 4.1 Web Console (Next.js)

| Feature          | Implementation                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| **Auth**         | Convex GitHub OAuth → cookie session                                                                |
| **Terminal UI**  | `xterm.js` wrapped in shadcn Card                                                                   |
| **WebSocket**    | Auto-reconnecting with exponential backoff (1s → 2s → 4s → 8s → max 30s)                           |
| **State**        | Convex real-time subscriptions for session list and command history                                 |
| **Mobile**       | PWA with service worker + Capacitor wrapper for app stores                                          |

### 4.2 Terminal Server (FastAPI)

| Endpoint               | Purpose                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| `POST /api/v1/sessions`        | Create new container session                                             |
| `DELETE /api/v1/sessions/{id}` | Terminate session                                                        |
| `GET /api/v1/health`           | Health check for Cloud Run                                               |
| `WS /ws/terminal/{id}`         | Binary WebSocket for stdin/stdout/stderr                                 |

**Container Security:**
- Network isolation (`--network none`)
- Read-only root filesystem
- Memory limit: 512MB
- CPU limit: 0.5 cores
- Process limit: 100 PIDs
- Run as `nobody` user
- 5-minute idle timeout

### 4.3 Infrastructure

| Component      | Purpose                                                              |
| -------------- | -------------------------------------------------------------------- |
| **Convex**     | User auth, session tracking, command history, real-time sync         |
| **Terraform**  | GCP project setup, Cloud Run services, IAM, monitoring              |
| **Docker**     | Hardened containers for terminal isolation                           |

## 5. Development Workflow

<details>
<summary>📦 Detailed Local Setup</summary>

### Environment Setup

```bash
# 1. Copy environment template
cp .env.example .env.local

# 2. Add required secrets:
#    - CONVEX_DEPLOY_KEY (from Convex dashboard)
#    - GITHUB_CLIENT_ID (OAuth app)
#    - GITHUB_CLIENT_SECRET

# 3. Python environment (terminal-server)
cd apps/terminal-server
uv venv
uv pip sync requirements.txt
cd ../..

# 4. Start infrastructure
docker-compose up -d convex
pnpm convex:push  # Deploy schema

# 5. Run all services
pnpm dev
```

### Available Scripts

| Command | Action |
|---------|--------|
| `pnpm dev` | Start all services with hot reload |
| `pnpm build` | Build all packages |
| `pnpm lint` | Run ESLint + Ruff |
| `pnpm test` | Run all tests |
| `pnpm clean` | Remove all build artifacts |

</details>

<details>
<summary>🔌 WebSocket Reconnection Implementation</summary>

```typescript
// packages/ui/src/hooks/useReconnectingWebSocket.ts
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

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      socket?.close();
    };
  }, [connect]);

  return { socket, isConnected, reconnect: connect };
}
```

</details>

<details>
<summary>🐳 Container Security Configuration</summary>

```python
# apps/terminal-server/src/docker_manager.py
def create_secure_container(session_id: str) -> Container:
    return docker_client.containers.run(
        "cpc/sandbox:latest",
        command="/bin/bash",
        detach=True,
        tty=True,
        stdin_open=True,
        remove=True,
        # Security hardening
        network_mode="none",              # No network
        read_only=True,                   # Read-only root
        tmpfs={"/tmp": "size=100M"},      # Writable /tmp
        mem_limit="512m",
        memswap_limit="512m",             # No swap
        cpu_shares=512,                   # 0.5 CPU
        pids_limit=100,
        security_opt=["no-new-privileges"],
        user="nobody:nogroup",
        labels={
            "session_id": session_id,
            "created_at": datetime.utcnow().isoformat()
        }
    )
```

</details>

<details>
<summary>📊 Convex Schema</summary>

```typescript
// infrastructure/convex/schema.ts
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
    containerInfo: v.optional(v.string()),
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
```

</details>

## 6. CI/CD Pipeline

| Workflow | Trigger | Actions |
|----------|---------|---------|
| **ci.yml** | PR/push | Lint → Type check → Test → Build |
| **deploy-web.yml** | Tag `web-v*` | Build Next.js → Push to Cloud Run |
| **deploy-terminal.yml** | Tag `terminal-v*` | Build Docker → Push to Cloud Run |
| **infrastructure.yml** | `main` branch | Terraform plan → Manual apply |

## 7. Phase 1 Roadmap (4 Weeks)

| Week | Deliverable | Owner | Status |
|------|-------------|-------|--------|
| 1 | Repo scaffold + CI green on "hello world" | Core | ⬜ |
| 1 | Convex schema + GitHub OAuth flow | Backend | ⬜ |
| 2 | Terminal-server MVP with hardened Docker | Backend | ⬜ |
| 2 | Frontend terminal UI with reconnect | Frontend | ⬜ |
| 3 | PWA service worker + Capacitor shells | Mobile | ⬜ |
| 3 | Cloud Run staging via Terraform | DevOps | ⬜ |
| 4 | Command logging to Convex | Full-stack | ⬜ |
| 4 | Security review + container scanning | Security | ⬜ |

## 8. Turborepo Configuration

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "pipeline": {
    "dev": { 
      "cache": false, 
      "persistent": true 
    },
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "lint": { 
      "outputs": [] 
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    }
  },
  "remoteCache": {
    "enabled": true
  }
}
```

## 9. Production Deployment

<details>
<summary>🚀 Deployment Checklist</summary>

### Pre-deployment
- [ ] All tests passing
- [ ] Security scan clean
- [ ] Environment variables set in Cloud Run
- [ ] Terraform plan reviewed

### Cloud Run Configuration
```yaml
# Both services
- Min instances: 1 (prevent cold starts)
- Max instances: 100
- CPU: Always allocated (WebSockets)
- Memory: 1GB (web), 2GB (terminal)
- Timeout: 60 minutes (WebSocket support)

# Terminal server specific
- Privileged mode for Docker-in-Docker
- Mount Docker socket via secrets
```

### Post-deployment
- [ ] Health checks passing
- [ ] WebSocket connections stable
- [ ] Monitoring alerts configured
- [ ] Backup strategy verified

</details>

## 10. Conventions

| Area | Standard |
|------|----------|
| **Branches** | `main`, `dev`, `feature/*`, `fix/*` |
| **Commits** | Conventional Commits (feat:, fix:, docs:) |
| **PRs** | Max 400 lines, requires 1 review |
| **Testing** | 80% coverage target |
| **Python** | Black + Ruff formatting |
| **TypeScript** | ESLint + Prettier |

---

**Questions?** Check service-specific READMEs in `apps/web` and `apps/terminal-server`.