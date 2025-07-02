# Claude Code Instructions for Pocket Console

## Claude Code Features Reference

**IMPORTANT**: See [CLAUDE_CODE_REFERENCE.md](./CLAUDE_CODE_REFERENCE.md) for comprehensive Claude Code features, hooks, MCP, and capabilities.

## Project-Specific Claude Code Guidelines

### 1. Parallel Execution

- Always use parallel tool calls when multiple independent tasks can be done simultaneously
- Launch multiple Task agents for complex searches or implementations
- Example: When setting up WebSocket connections, parallelize client/server implementations

### 2. Hooks System

We use Claude Code hooks to enforce code quality and security. The configuration is in `.claude/settings.json`:
- **PostToolUse**: Automatically runs linting after file edits
- **PreToolUse**: Validates bash commands for security before execution

See `.claude/hooks/` directory for custom hook scripts.

### 3. Task Management

- Use TodoWrite immediately when starting any multi-step task
- Mark tasks as in_progress before starting work
- Update task status immediately upon completion
- Never batch task status updates

### 4. WebSocket Development Focus

When implementing terminal features:

1. Think about security implications (use extended thinking)
2. Consider Docker sandbox isolation
3. Plan real-time event handling
4. Design for mobile-first responsive UI

### 5. Security First

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

## Development Commands

```bash
# Always run after code changes
pnpm lint
pnpm type-check

# Development
pnpm dev          # Start all services
pnpm test         # Run tests

# Git workflow
gh issue comment <number> --repo claudes-world/claude-pocket-console --body "message"
```

## MCP Server Plans

Future MCP servers to implement:

1. `terminal-session-manager` - Manage Docker containers
2. `auth-server` - Handle GitHub OAuth with Convex
3. `metrics-server` - Track usage and rate limiting
