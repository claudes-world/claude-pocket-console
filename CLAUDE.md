# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Claude Code Features Reference

**IMPORTANT**: See [CLAUDE_CODE_REFERENCE.md](./CLAUDE_CODE_REFERENCE.md) for comprehensive Claude Code features, hooks, MCP, and capabilities.

## Architecture Overview

This is a **monorepo** built with **pnpm + Turborepo** containing a secure web terminal application:

- **Frontend**: Next.js 15.3 (App Router) with TypeScript and Tailwind CSS
- **Backend**: FastAPI + Python with WebSocket support for real-time terminal I/O
- **Database/Auth**: Convex with GitHub OAuth integration
- **Infrastructure**: Docker containers for isolated terminal sessions
- **Package Management**: pnpm workspaces with shared packages

### Repository Structure

```
apps/
  ├── web/                    # Next.js frontend (@cpc/web)
  └── terminal-server/        # FastAPI backend (Python)
packages/
  ├── shared-types/           # Zod schemas → TypeScript + JSON (@cpc/shared-types)
  ├── ui/                     # React components (@cpc/ui)
  └── config/                 # Shared configs (@cpc/config)
infrastructure/
  ├── convex/                 # Real-time backend (@cpc/convex)
  ├── terraform/              # GCP infrastructure
  └── docker/                 # Container definitions
```

## Development Commands

```bash
# Primary commands (always use these after code changes)
pnpm lint                   # Run ESLint + Ruff across all packages
pnpm type-check            # TypeScript checking across all packages

# Development workflow
pnpm dev                   # Start all services with hot reload
pnpm build                 # Build all packages for production
pnpm test                  # Run all test suites
pnpm test:watch           # Run tests in watch mode
pnpm clean                # Remove build artifacts

# Package-specific development
pnpm --filter @cpc/web dev              # Next.js only
pnpm --filter @cpc/shared-types build   # Build types package
pnpm --filter convex deploy             # Deploy Convex backend

# Docker operations
pnpm docker:build          # Build sandbox container
docker compose up          # Start services in containers

# Python-specific (in apps/terminal-server/)
cd apps/terminal-server
uv sync                    # Install Python dependencies
pytest                     # Run Python tests
ruff check                 # Python linting
black .                    # Python formatting
```

## Type System Strategy

**Zod schemas as single source of truth** in `packages/shared-types/`:

- TypeScript types generated for frontend
- JSON schemas generated for runtime validation
- Direct Zod imports for Convex backend

When adding new data models:

1. Define Zod schema in `packages/shared-types/src/schemas/`
2. Export from `packages/shared-types/src/index.ts`
3. Run `pnpm --filter @cpc/shared-types build`
4. Import types in frontend, JSON schemas in Python backend

## Security Architecture

**Every terminal session runs in isolated Docker containers:**

- Strictly sandboxed with no network access
- Resource-limited (256MB RAM, 0.5 CPU)
- Read-only filesystem with tmpfs for /tmp
- Rootless execution (nobody:nogroup)

**Key security principles:**

- Never expose Docker socket directly
- All user input validated before container execution
- WebSocket connections authenticated via Convex
- Container auto-termination after idle timeout

## Testing Strategy

```bash
# Frontend tests
pnpm --filter @cpc/web test              # Jest + Testing Library

# Python tests
cd apps/terminal-server && pytest        # FastAPI + Docker integration tests

# Type checking
pnpm type-check                          # All packages
```

## WebSocket Implementation

**Connection flow:**

1. Frontend establishes authenticated WebSocket to `/ws/terminal/{sessionId}`
2. Terminal server creates isolated Docker container
3. Bidirectional I/O streaming via binary WebSocket frames
4. Real-time session state sync via Convex

**Message format:**

- Byte 0: Message type (0x01=stdin, 0x02=stdout, 0x03=stderr)
- Bytes 1-n: UTF-8 encoded data

## Project-Specific Claude Code Guidelines

### 1. Parallel Execution

- Always use parallel tool calls when multiple independent tasks can be done simultaneously
- Launch multiple Task agents for complex searches or implementations
- Example: When setting up WebSocket connections, parallelize client/server implementations

### 2. Task Management

- Use TodoWrite immediately when starting any multi-step task
- Mark tasks as in_progress before starting work
- Update task status immediately upon completion
- Never batch task status updates

### 3. WebSocket Development Focus

When implementing terminal features:

1. Think about security implications (use extended thinking)
2. Consider Docker sandbox isolation
3. Plan real-time event handling
4. Design for mobile-first responsive UI

### 4. Security First

- Never expose Docker socket directly
- All terminal sessions must run in rootless containers
- Validate all user input before container execution
- Use hooks to enforce security checks

## Collaboration and Communication

- GitHub issues should be used for tracking all work
- Post "micro-blog" style short updates and cool things they do to the current GitHub issue. The intent is to capture the thought process (before and during) and the final result.
- Subagents should also post micro-blog updates to the GitHub issue.
- Subagents should sign off with a unique identifier (e.g., " -- Task Subagent Phase 2C")
- Keep GitHub comments short (1-4 sentences) with personality

## Key File Locations

- Package configs: `packages/config/` (ESLint, TypeScript, Prettier)
- Shared types: `packages/shared-types/src/schemas/`
- Docker sandbox: `infrastructure/docker/Dockerfile.sandbox`
- Turborepo config: `turbo.json`
- Convex functions: `infrastructure/convex/`
- Terminal WebSocket handler: `apps/terminal-server/src/websocket.py`
- Next.js API routes: `apps/web/src/app/api/`

## Environment Variables

Critical environment variables (defined in `turbo.json`):

- `CONVEX_DEPLOY_KEY` - Convex backend deployment
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` - OAuth integration
- `NODE_ENV` - Environment detection
- `NEXT_PUBLIC_*` - Frontend environment variables

## Git Workflow & Issue Management

We follow an **Enhanced GitHub Flow** optimized for autonomous AI agents and historical documentation.

### Workflow Overview

```mermaid
graph LR
    A[Create Issue] --> B[Create Feature Branch]
    B --> C[Work + Micro-blog]
    C --> D[Commit with Issue Links]
    D --> E[Test & Validate]
    E --> F[Create PR]
    F --> G[Review & Merge]
    G --> H[Close Issue]
    H --> I[Delete Branch]
```

### Issue-Driven Development

**Every piece of work starts with a GitHub issue.**

```bash
# Create new issue with template
gh issue create --title "Add WebSocket reconnection logic" \
  --body "## Problem
Current WebSocket connections don't automatically reconnect on failure.

## Solution
Implement exponential backoff reconnection strategy.

## Acceptance Criteria
- [ ] Auto-reconnect on connection loss
- [ ] Exponential backoff (1s, 2s, 4s, 8s, max 30s)
- [ ] UI indicator for connection status
- [ ] Unit tests for reconnection logic" \
  --label "feature,high-priority" \
  --assignee "@me"

# List issues
gh issue list --state open --assignee "@me"

# View specific issue
gh issue view 123
```

**Issue Templates:**

We have structured issue templates in `.github/ISSUE_TEMPLATE/`:

- 🚀 **Feature Request** (`feature_request.md`) - New functionality with detailed acceptance criteria
- 🐛 **Bug Report** (`bug_report.md`) - Bug reports with environment details and reproduction steps  
- 🔬 **Research Task** (`research_task.md`) - Investigation and analysis work with clear deliverables
- 🏗️ **Infrastructure** (`infrastructure.md`) - DevOps, deployment, and tooling improvements
- 📚 **Documentation** (`documentation.md`) - Documentation updates and content creation

Each template includes:
- Structured sections for consistency
- Checkboxes for acceptance criteria
- Labels that auto-apply
- Claude's World context sections
- Micro-blogging reminders for AI agents

### Branch Management

**Branch Naming Convention:**

```bash
# Format: type/issue-number-short-description
feat/123-websocket-reconnection
fix/456-container-timeout-bug
research/789-performance-optimization
infra/101-docker-security-hardening
```

**Branch Operations:**

```bash
# Create and switch to feature branch
git checkout -b feat/123-websocket-reconnection

# Link branch to issue in first commit
git commit -m "feat: start WebSocket reconnection implementation

refs #123"

# Push branch and set upstream
git push -u origin feat/123-websocket-reconnection
```

### Micro-blogging Strategy

**Regular progress updates in GitHub issues create historical documentation.**

```bash
# Post micro-blog update
gh issue comment 123 --body "🔧 **Progress Update**

Implemented basic reconnection logic with exponential backoff. The connection now attempts to reconnect automatically when it detects a closure.

**Key decisions:**
- Using setTimeout for delays rather than intervals
- Max reconnection delay capped at 30 seconds
- Reset attempt counter on successful connection

**Next:** Adding UI connection status indicator

-- Claude Agent Alpha"

# Add discovery or insight
gh issue comment 123 --body "💡 **Discovery**

Found that WebSocket.readyState is unreliable during rapid connection changes. Switching to tracking connection state internally.

This explains the race condition we were seeing in tests."

# Add completion summary
gh issue comment 123 --body "✅ **Feature Complete**

WebSocket reconnection is now fully implemented and tested:
- ✅ Exponential backoff working (1s → 30s max)
- ✅ Connection status UI implemented
- ✅ Unit tests cover edge cases
- ✅ Manual testing confirms reliability

Ready for code review. PR: #125"
```

**Micro-blogging Guidelines:**

- Update at least every hour during active work
- Include both progress and insights/decisions
- Use emojis for visual scanning (🔧 progress,💡 insight, ✅ complete, ❌ blocked)
- Sign with agent identifier for multi-agent work
- Capture the "why" behind decisions

### Commit Message Strategy

**Use Conventional Commits format for consistency:**

```bash
# Format: type(scope): description
#
# Longer explanation if needed
#
# refs #issue-number

# Examples:
git commit -m "feat(websocket): implement exponential backoff reconnection

Adds automatic reconnection with exponential backoff strategy.
Connection attempts: 1s, 2s, 4s, 8s, 16s, 30s (max).
Resets counter on successful connection.

refs #123"

git commit -m "fix(container): resolve timeout race condition

Container cleanup was racing with new session creation.
Added proper cleanup sequencing and container state tracking.

closes #456"

git commit -m "docs: update WebSocket API documentation

refs #123"

git commit -m "test: add WebSocket reconnection test suite

refs #123"
```

**Commit Types:**

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation
- `test:` - Tests
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `ci:` - CI/CD changes
- `chore:` - Maintenance tasks

**Issue Linking:**

- `refs #123` - References issue (keeps it open)
- `closes #123` - Closes issue when merged
- `fixes #123` - Same as closes

### Pull Request Process

```bash
# Create PR after work is complete
gh pr create --title "feat: WebSocket reconnection with exponential backoff" \
  --body "## Summary
Implements automatic WebSocket reconnection as specified in #123.

## Changes
- Added reconnection logic with exponential backoff
- Implemented connection status UI indicator
- Added comprehensive test suite
- Updated documentation

## Testing
- [x] Unit tests pass
- [x] Manual testing completed
- [x] Integration tests pass
- [x] Lint and type-check clean

## Related Issues
- Closes #123
- Refs #100 (WebSocket improvements epic)

## Screenshots
[Include UI screenshots if relevant]" \
  --assignee "@me" \
  --label "feature"

# Request review (if working with team)
gh pr review --approve 125
gh pr merge 125 --squash
```

### Quality Gates

**Before creating PR:**

```bash
# Run full quality check
pnpm lint          # ESLint + Ruff
pnpm type-check    # TypeScript
pnpm test          # All tests
pnpm build         # Verify builds

# Manual testing checklist:
# - [ ] Feature works as specified
# - [ ] No regressions in existing functionality
# - [ ] Error cases handled gracefully
# - [ ] UI/UX meets requirements
```

**Before merging:**

- All CI checks pass
- Code review completed (if applicable)
- Manual testing verified
- Issue acceptance criteria met

### Issue Closure & Cleanup

```bash
# After successful merge and validation
gh issue comment 123 --body "🎉 **Implementation Complete**

Feature has been successfully implemented, tested, and deployed.

**Final Summary:**
- WebSocket reconnection now works reliably
- Exponential backoff prevents server overload
- Connection status visible to users
- Zero regression in existing functionality

**Key Learnings:**
- WebSocket.readyState has timing issues during reconnection
- Internal state tracking is more reliable
- Exponential backoff significantly improves server performance

**Links:**
- PR: #125
- Commits: abc123f, def456g, hij789k
- Tests: `websocket.reconnection.test.ts`

This completes the WebSocket reliability improvements planned for v1.2.

-- Claude Agent Alpha ✨"

gh issue close 123

# Clean up feature branch
git branch -d feat/123-websocket-reconnection
git push origin --delete feat/123-websocket-reconnection
```

### Command Reference

```bash
# Issue Management
gh issue create --title "..." --body "..." --label "..." --assignee "@me"
gh issue list --state open --assignee "@me"
gh issue view 123
gh issue comment 123 --body "..."
gh issue close 123

# Branch Management
git checkout -b feat/123-description
git push -u origin feat/123-description
git branch -d feat/123-description
git push origin --delete feat/123-description

# PR Management
gh pr create --title "..." --body "..." --assignee "@me"
gh pr list --state open --author "@me"
gh pr view 125
gh pr merge 125 --squash

# Repository Navigation
gh repo view --web                    # Open repo in browser
gh issue view 123 --web              # Open issue in browser
gh pr view 125 --web                 # Open PR in browser
```

### Integration with Development Commands

Our git workflow integrates seamlessly with the development commands:

```bash
# Standard development cycle
gh issue create --title "Add user authentication"
git checkout -b feat/201-user-auth
# ... do work, commit frequently ...
pnpm lint && pnpm type-check && pnpm test  # Quality gate
gh pr create --title "feat: user authentication system"
gh pr merge --squash
gh issue close 201
```

This workflow ensures every change is traceable, well-documented, and contributes to the historical record of the Claude's World project.

## MCP Server Plans

Future MCP servers to implement:

1. `terminal-session-manager` - Manage Docker containers
2. `auth-server` - Handle GitHub OAuth with Convex
3. `metrics-server` - Track usage and rate limiting
