# Development Guide

> Complete guide for setting up and developing Claude Pocket Console locally.

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Initial Setup](#2-initial-setup)
3. [Development Workflow](#3-development-workflow)
4. [Available Scripts](#4-available-scripts)
5. [Service-Specific Setup](#5-service-specific-setup)
6. [Testing Strategy](#6-testing-strategy)
7. [Debugging Guide](#7-debugging-guide)
8. [Common Issues](#8-common-issues)

---

## 1. Prerequisites

Ensure you have the following tools installed:

| Tool | Version | Installation |
| --- | --- | --- |
| **Node.js** | 20 LTS | `nvm install 20` or download from [nodejs.org](https://nodejs.org) |
| **pnpm** | Latest | `corepack enable && corepack prepare pnpm@latest --activate` |
| **Python** | 3.12+ | `pyenv install 3.12` or system package manager |
| **uv** | Latest | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| **Docker** | 20.10+ | [Docker Desktop](https://www.docker.com/products/docker-desktop) |
| **Git** | 2.30+ | System package manager |

### Verify Installation

```bash
# Check all prerequisites
node --version        # Should show v20.x.x
pnpm --version        # Should show 8.x.x or higher
python3 --version     # Should show Python 3.12.x
uv --version          # Should show 0.x.x
docker --version      # Should show Docker version 20.10.x or higher
git --version         # Should show git version 2.30.x or higher
```

---

## 2. Initial Setup

### 2.1 Clone and Install

```bash
# Clone the repository
git clone git@github.com:your-org/claude-pocket-console.git
cd claude-pocket-console

# Install all dependencies (Node and Python)
pnpm install

# This automatically:
# - Installs Node dependencies for all packages
# - Sets up git hooks via Husky
# - Runs initial build for shared packages
# - Syncs Python dependencies via uv
```

### 2.2 Environment Configuration

```bash
# Copy environment template
cp .env.example .env.local

# Required environment variables:
# CONVEX_DEPLOY_KEY=         # From https://dashboard.convex.dev
# GITHUB_CLIENT_ID=          # From GitHub OAuth App
# GITHUB_CLIENT_SECRET=      # From GitHub OAuth App
# NEXT_PUBLIC_CONVEX_URL=    # Usually https://your-app.convex.cloud
```

### 2.3 Convex Setup

```bash
# Deploy Convex functions and schema
pnpm convex:push

# This will:
# - Create/update database schema
# - Deploy serverless functions
# - Set up indexes
# - Configure auth providers
```

### 2.4 Docker Setup

```bash
# Build the sandbox container image
cd infrastructure/docker
docker build -t cpc/sandbox:latest -f Dockerfile.sandbox .

# Verify Docker daemon is running
docker ps

# Optional: Configure Docker resource limits
# Docker Desktop > Settings > Resources
# Recommended: 4GB RAM, 2 CPUs minimum
```

---

## 3. Development Workflow

### 3.1 Start Development Environment

```bash
# Start all services (from root directory)
pnpm dev

# This runs:
# - Next.js dev server (port 3000)
# - FastAPI server with hot reload (port 8000)
# - Convex dev deployment (real-time sync)
# - Docker daemon must be running
```

### 3.2 Service URLs

| Service | URL | Purpose |
| --- | --- | --- |
| Web App | http://localhost:3000 | Main application |
| Terminal API | http://localhost:8000 | FastAPI backend |
| API Docs | http://localhost:8000/docs | Swagger UI |
| Convex Dashboard | https://dashboard.convex.dev | Database admin |

### 3.3 Development Tips

**Watch Mode:**
```bash
# Run specific service in watch mode
pnpm --filter web dev
pnpm --filter terminal-server dev

# Run tests in watch mode
pnpm test:watch
```

**Type Checking:**
```bash
# Check types across all packages
pnpm type-check

# Watch for type errors
pnpm --filter web type-check --watch
```

---

## 4. Available Scripts

### 4.1 Root Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start all services in development mode |
| `pnpm build` | Build all packages for production |
| `pnpm lint` | Run ESLint and Ruff across all packages |
| `pnpm test` | Run all test suites |
| `pnpm type-check` | TypeScript type checking |
| `pnpm clean` | Remove all build artifacts and caches |
| `pnpm format` | Auto-format code with Prettier |

### 4.2 Service-Specific Scripts

**Web App (`apps/web`):**
```bash
pnpm --filter web dev          # Start Next.js dev server
pnpm --filter web build        # Production build
pnpm --filter web test         # Run tests
pnpm --filter web lint         # Lint TypeScript/React
```

**Terminal Server (`apps/terminal-server`):**
```bash
pnpm --filter terminal-server dev     # Start FastAPI with reload
pnpm --filter terminal-server test    # Run pytest suite
pnpm --filter terminal-server lint    # Run Ruff linter
pnpm --filter terminal-server format  # Format with Black
```

---

## 5. Service-Specific Setup

### 5.1 Frontend Development (Next.js)

**Component Development:**
```bash
# Use Storybook for component development
pnpm --filter ui storybook

# Create new component
pnpm --filter ui generate:component MyComponent
```

**Tailwind CSS:**
- Config: `apps/web/tailwind.config.ts`
- Global styles: `apps/web/src/app/globals.css`
- Component styles: Use Tailwind classes directly

### 5.2 Backend Development (FastAPI)

**Python Environment:**
```bash
cd apps/terminal-server

# Create virtual environment (handled by uv)
uv venv

# Activate virtual environment
source .venv/bin/activate  # Unix/macOS
# or
.venv\Scripts\activate     # Windows

# Install dependencies
uv pip sync requirements.txt

# Add new dependency
uv pip install package-name
uv pip freeze > requirements.txt
```

**Database Migrations:**
```bash
# Currently using Convex (no traditional migrations)
# Schema changes in infrastructure/convex/schema.ts
pnpm convex:push
```

### 5.3 Shared Packages

**Adding to Shared Types:**
```typescript
// packages/shared-types/src/schemas/newType.ts
import { z } from 'zod';

export const NewTypeSchema = z.object({
  id: z.string(),
  // ... fields
});

// Re-export in index.ts
export * from './schemas/newType';
```

**Building Packages:**
```bash
# Build all packages
pnpm build:packages

# Build specific package
pnpm --filter shared-types build
```

---

## 6. Testing Strategy

### 6.1 Unit Tests

**Frontend (Vitest + React Testing Library):**
```typescript
// apps/web/src/components/Terminal.test.tsx
import { render, screen } from '@testing-library/react';
import { Terminal } from './Terminal';

describe('Terminal', () => {
  it('renders terminal interface', () => {
    render(<Terminal sessionId="123" />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
```

**Backend (Pytest):**
```python
# apps/terminal-server/tests/test_api.py
import pytest
from fastapi.testclient import TestClient

def test_create_session(client: TestClient):
    response = client.post("/api/v1/sessions", json={"userId": "123"})
    assert response.status_code == 200
    assert "sessionId" in response.json()
```

### 6.2 Integration Tests

```bash
# Run integration tests
pnpm test:integration

# Test WebSocket connections
pnpm --filter terminal-server test tests/test_websocket.py
```

### 6.3 E2E Tests (Playwright)

```typescript
// e2e/terminal.spec.ts
test('create and use terminal', async ({ page }) => {
  await page.goto('/');
  await page.click('text=Sign in with GitHub');
  // ... auth flow
  await page.click('text=New Terminal');
  await page.waitForSelector('.xterm');
  await page.type('.xterm', 'echo "Hello World"\n');
  await expect(page.locator('.xterm')).toContainText('Hello World');
});
```

---

## 7. Debugging Guide

### 7.1 Frontend Debugging

**Next.js Debug Mode:**
```bash
# Start with Node.js inspector
NODE_OPTIONS='--inspect' pnpm --filter web dev

# Attach VS Code debugger (launch.json provided)
```

**React DevTools:**
- Install browser extension
- Use Profiler for performance issues
- Check component props and state

### 7.2 Backend Debugging

**FastAPI Debug Mode:**
```python
# apps/terminal-server/.vscode/launch.json
{
  "name": "FastAPI",
  "type": "python",
  "request": "launch",
  "module": "uvicorn",
  "args": ["src.main:app", "--reload", "--port", "8000"],
  "jinja": true
}
```

**Docker Container Debugging:**
```bash
# List running containers
docker ps

# View container logs
docker logs <container-id>

# Execute commands in container
docker exec -it <container-id> /bin/bash

# Inspect container
docker inspect <container-id>
```

### 7.3 WebSocket Debugging

**Browser DevTools:**
- Network tab > WS filter
- Click connection to see frames
- Monitor message payloads

**wscat Testing:**
```bash
# Install wscat
npm install -g wscat

# Connect to WebSocket
wscat -c ws://localhost:8000/ws/terminal/test-session

# Send test messages
> {"type": "stdin", "data": "ls\n"}
```

---

## 8. Common Issues

### 8.1 Installation Issues

**Problem:** `pnpm install` fails
```bash
# Solution: Clear caches and reinstall
pnpm store prune
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

**Problem:** Python dependencies fail
```bash
# Solution: Ensure Python 3.12 is active
python3 --version
uv pip sync requirements.txt --python python3.12
```

### 8.2 Runtime Issues

**Problem:** "Cannot connect to Docker daemon"
```bash
# Solution: Ensure Docker is running
docker ps
# If not, start Docker Desktop or:
sudo systemctl start docker  # Linux
```

**Problem:** WebSocket connection fails
```bash
# Check if backend is running
curl http://localhost:8000/api/v1/health

# Check CORS settings in .env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**Problem:** Convex functions not updating
```bash
# Force redeploy
pnpm convex:push --force

# Check dashboard for errors
# https://dashboard.convex.dev
```

### 8.3 Performance Issues

**Slow Hot Reload:**
```bash
# Exclude large directories from watch
# Add to .env.local:
WATCHPACK_POLLING=false

# Or use Turborepo filter:
pnpm --filter web dev --parallel
```

**High Memory Usage:**
```bash
# Limit Node.js memory
NODE_OPTIONS="--max-old-space-size=2048" pnpm dev

# Configure Docker limits
# See Docker Desktop > Settings > Resources
```

---

## Related Documentation

- [Architecture Guide](./ARCHITECTURE.md) - System design and components
- [Deployment Guide](./DEPLOYMENT.md) - Production deployment
- [Contributing Guidelines](../.github/CONTRIBUTING.md) - Code standards

For framework-specific guidance:
- [Next.js Documentation](https://nextjs.org/docs)
- [FastAPI Documentation](https://fastapi.tiangolo.com)
- [Convex Documentation](https://docs.convex.dev)