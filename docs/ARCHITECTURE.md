# Architecture Guide

> A technical reference for understanding the Claude Pocket Console system architecture, service interactions, and implementation details.

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Service Architecture](#2-service-architecture)
3. [API Reference](#3-api-reference)
4. [Data Flow](#4-data-flow)
5. [Type System](#5-type-system)
6. [Security Model](#6-security-model)
7. [Implementation Examples](#7-implementation-examples)

---

## 1. System Overview

Claude Pocket Console is built as a distributed system with three primary services:

```mermaid
graph TB
    Client[Web Browser] -->|HTTPS| Web[Web Console<br/>Next.js 15.3]
    Web -->|WebSocket| Terminal[Terminal Server<br/>FastAPI]
    Web -->|GraphQL| Convex[Convex Backend<br/>Real-time DB]
    Terminal -->|Docker API| Docker[Docker Daemon]
    Convex -->|OAuth| GitHub[GitHub Auth]
```

### Core Components

| Component | Technology | Purpose |
| --- | --- | --- |
| **Web Console** | Next.js 15.3 | User interface, terminal emulation |
| **Terminal Server** | FastAPI/Python | Container orchestration, I/O streaming |
| **Backend** | Convex | Authentication, state management, persistence |
| **Container Runtime** | Docker | Isolated execution environments |

---

## 2. Service Architecture

### 2.1 Web Console (`apps/web`)

**Responsibilities:**
- User authentication via Convex/GitHub OAuth
- Terminal UI rendering with xterm.js
- WebSocket connection management
- Real-time state synchronization

**Key Technologies:**
- Next.js 15.3 with App Router
- TypeScript for type safety
- Tailwind CSS v4 + shadcn/ui
- xterm.js for terminal emulation

**Directory Structure:**
```
apps/web/
   src/
      app/              # App Router pages
      components/       # React components
         terminal/     # Terminal-specific UI
         ui/           # Shared UI components
      hooks/            # Custom React hooks
      lib/              # Utilities and helpers
   public/               # Static assets
```

### 2.2 Terminal Server (`apps/terminal-server`)

**Responsibilities:**
- Docker container lifecycle management
- WebSocket connection handling
- Bidirectional I/O streaming
- Resource limit enforcement

**Key Technologies:**
- FastAPI for async HTTP/WebSocket
- Docker SDK for Python
- Uvicorn ASGI server
- Pydantic for validation

**Directory Structure:**
```
apps/terminal-server/
   src/
      main.py           # FastAPI app & routes
      websocket.py      # WS connection handler
      docker_manager.py # Container orchestration
      models.py         # Pydantic models
      security.py       # Security utilities
   tests/                # Pytest test suite
```

### 2.3 Backend Services (`infrastructure/convex`)

**Responsibilities:**
- User authentication (GitHub OAuth)
- Session state persistence
- Command history logging
- Real-time data synchronization

**Schema Overview:**
```typescript
// Simplified - see full schema in infrastructure/convex/schema.ts
interface User {
  githubId: string;
  username: string;
  email: string;
}

interface Session {
  userId: Id<"users">;
  sessionId: string;
  status: "active" | "terminated";
  containerInfo?: string;
}

interface CommandLog {
  sessionId: Id<"sessions">;
  command: string;
  output: string;
  executedAt: number;
}
```

---

## 3. API Reference

### 3.1 Terminal Server Endpoints

| Method | Path | Purpose | Request | Response |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/sessions` | Create new terminal session | `{userId: string}` | `{sessionId: string, containerId: string}` |
| DELETE | `/api/v1/sessions/{id}` | Terminate session | Path param | `{status: "terminated"}` |
| GET | `/api/v1/health` | Health check | - | `{status: "healthy", version: string}` |
| WS | `/ws/terminal/{id}` | Terminal I/O stream | Binary frames | Binary frames |

### 3.2 WebSocket Protocol

**Message Format:**
```typescript
// Client � Server
interface ClientMessage {
  type: "stdin" | "resize" | "ping";
  data: string | ResizeData;
}

// Server � Client
interface ServerMessage {
  type: "stdout" | "stderr" | "exit" | "pong";
  data: string | number;
}
```

**Binary Frame Structure:**
- Byte 0: Message type (0x01=stdin, 0x02=stdout, 0x03=stderr)
- Bytes 1-n: UTF-8 encoded data

### 3.3 Convex Functions

| Function | Type | Purpose | Parameters |
| --- | --- | --- | --- |
| `auth.githubCallback` | Mutation | Handle OAuth callback | `code: string` |
| `sessions.create` | Mutation | Record new session | `sessionId: string` |
| `sessions.list` | Query | Get user's sessions | `userId: Id<"users">` |
| `commands.log` | Mutation | Store command history | `sessionId, command, output` |

---

## 4. Data Flow

### 4.1 Authentication Flow

```mermaid
sequenceDiagram
    participant User
    participant Web
    participant Convex
    participant GitHub
    
    User->>Web: Click "Sign in"
    Web->>GitHub: Redirect to OAuth
    GitHub->>User: Authorize prompt
    User->>GitHub: Approve
    GitHub->>Web: Callback with code
    Web->>Convex: Exchange code
    Convex->>GitHub: Verify token
    GitHub->>Convex: User data
    Convex->>Web: Session token
    Web->>User: Authenticated
```

### 4.2 Terminal Session Flow

```mermaid
sequenceDiagram
    participant User
    participant Web
    participant Terminal
    participant Docker
    
    User->>Web: Request terminal
    Web->>Terminal: POST /sessions
    Terminal->>Docker: Create container
    Docker->>Terminal: Container ID
    Terminal->>Web: Session ID
    Web->>Terminal: WS connect
    Terminal->>Web: Ready
    User->>Web: Type command
    Web->>Terminal: Send stdin
    Terminal->>Docker: Exec in container
    Docker->>Terminal: Output
    Terminal->>Web: Send stdout
    Web->>User: Display output
```

---

## 5. Type System

### 5.1 Shared Types Strategy

We use **Zod** schemas as the single source of truth, generating both TypeScript types and JSON schemas:

```typescript
// packages/shared-types/src/schemas/session.ts
import { z } from 'zod';

export const SessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  status: z.enum(['active', 'terminated']),
  createdAt: z.date(),
  endedAt: z.date().optional(),
});

export type Session = z.infer<typeof SessionSchema>;
```

**Build Process:**
```bash
# In packages/shared-types
pnpm build
# Generates:
# - dist/types/*.d.ts (TypeScript)
# - dist/schemas/*.json (JSON Schema)
```

### 5.2 Cross-Service Validation

- **Frontend**: Import TypeScript types for compile-time safety
- **Backend**: Use JSON schemas for runtime validation
- **Convex**: Import Zod schemas directly

---

## 6. Security Model

### 6.1 Container Isolation

Every terminal session runs in a strictly isolated container:

```python
# apps/terminal-server/src/docker_manager.py
def create_secure_container(session_id: str) -> Container:
    return docker_client.containers.run(
        "cpc/sandbox:latest",
        detach=True,
        # Network isolation
        network_mode="none",
        # Filesystem protection  
        read_only=True,
        tmpfs={"/tmp": "size=64m"},
        # Resource limits
        mem_limit="256m",
        memswap_limit="256m",  # Disable swap
        cpu_shares=512,        # 0.5 CPU
        pids_limit=100,
        # Security options
        security_opt=["no-new-privileges"],
        user="nobody:nogroup",
        # Capabilities
        cap_drop=["ALL"],
        cap_add=["CHOWN", "SETUID", "SETGID"],
    )
```

### 6.2 Authentication & Authorization

- **GitHub OAuth**: Primary authentication method
- **JWT Sessions**: Signed tokens with 24h expiry
- **RBAC**: Role-based access planned for v2
- **Rate Limiting**: 10 sessions per user per hour

### 6.3 Security Headers

```typescript
// apps/web/src/middleware.ts
export const securityHeaders = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval'",
};
```

---

## 7. Implementation Examples

### 7.1 WebSocket Reconnection Hook

```typescript
// apps/web/src/hooks/useReconnectingWebSocket.ts
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
        console.log('WebSocket connected');
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        
        if (!event.wasClean) {
          // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttemptsRef.current),
            30000
          );
          reconnectAttemptsRef.current++;
          
          console.log(`Reconnecting in ${delay}ms...`);
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      setSocket(ws);
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
    }
  }, [url]);

  useEffect(() => {
    connect();
    
    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      socket?.close(1000, 'Component unmounting');
    };
  }, [connect]);

  return { socket, isConnected, reconnect: connect };
}
```

### 7.2 Container Lifecycle Management

```python
# apps/terminal-server/src/docker_manager.py
class ContainerManager:
    def __init__(self):
        self.docker_client = docker.from_env()
        self.containers: Dict[str, Container] = {}
        
    async def create_session(self, session_id: str) -> Dict[str, str]:
        """Create a new isolated container for a terminal session."""
        container = await self._create_container(session_id)
        self.containers[session_id] = container
        
        # Start idle timeout
        asyncio.create_task(self._idle_timeout(session_id))
        
        return {
            "session_id": session_id,
            "container_id": container.id[:12],
            "status": "active"
        }
    
    async def _idle_timeout(self, session_id: str, timeout: int = 300):
        """Terminate container after idle timeout (default 5 min)."""
        await asyncio.sleep(timeout)
        
        if session_id in self.containers:
            await self.terminate_session(session_id)
            logger.info(f"Session {session_id} terminated due to idle timeout")
```

### 7.3 Convex Real-time Query

```typescript
// apps/web/src/app/terminal/page.tsx
export default function TerminalPage() {
  const sessions = useQuery(api.sessions.listActive);
  const createSession = useMutation(api.sessions.create);
  
  const handleNewTerminal = async () => {
    const response = await fetch('/api/terminal/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    });
    
    const { sessionId } = await response.json();
    
    // Record in Convex for real-time sync
    await createSession({ sessionId });
  };
  
  return (
    <div>
      {sessions?.map(session => (
        <Terminal key={session._id} session={session} />
      ))}
    </div>
  );
}
```

---

## Related Documentation

- [Development Guide](./DEVELOPMENT.md) - Local setup and debugging
- [Deployment Guide](./DEPLOYMENT.md) - Infrastructure and CI/CD
- [Contributing Guidelines](../.github/CONTRIBUTING.md) - Code standards and workflow

For service-specific implementation details, refer to the README files in each service directory.