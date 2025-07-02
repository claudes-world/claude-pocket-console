# Claude Code Reference for Pocket Console

This document provides a comprehensive reference for Claude Code features and capabilities relevant to our Pocket Console project.

## Core Features

### Tools Available

1. **File Operations**
   - `Read`: Read files with line numbers
   - `Write`: Create new files
   - `Edit`: Exact string replacements
   - `MultiEdit`: Multiple edits in one operation
   - `Glob`: Fast file pattern matching
   - `Grep`: Content search with regex
   - `LS`: List directory contents

2. **Development Tools**
   - `Bash`: Execute shell commands with timeout control
   - `Task`: Launch parallel agents for complex searches
   - `WebFetch`: Fetch and analyze web content
   - `WebSearch`: Search the web for current information

3. **Project Management**
   - `TodoRead`/`TodoWrite`: Track tasks during development
   - Git integration: commits, PRs, merge conflict resolution
   - MCP servers: External tool integration

### Key Capabilities

- **Context Awareness**: Understands entire project structure
- **Parallel Execution**: Can run multiple tool calls simultaneously
- **Security**: Direct API connection, no additional servers
- **Resume Sessions**: `--continue` or `--resume` flags

## Hooks System (NEW!)

Hooks allow custom commands to run at specific points in Claude Code's lifecycle.

### Hook Events
- `PreToolUse`: Before tool execution
- `PostToolUse`: After tool completion  
- `Notification`: On notifications
- `Stop`: When Claude finishes responding

### Configuration Example
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo \"Command executed: $CLAUDE_CODE_HOOK_PAYLOAD\" >> .claude-code-log"
          }
        ]
      }
    ]
  }
}
```

### Use Cases for Our Project
1. **Auto-formatting**: Run prettier/eslint after file edits
2. **Security checks**: Validate Docker commands before execution
3. **Logging**: Track all terminal operations for audit
4. **Notifications**: Alert on specific actions

## MCP (Model Context Protocol)

MCP enables Claude to connect to external services and tools.

### Configuration
```bash
# Add local server
claude mcp add terminal-server "node ./mcp-servers/terminal-server.js"

# Add with specific transport
claude mcp add --transport sse analytics-server http://localhost:3001
```

### Potential Uses for Pocket Console
- Connect to Docker daemon for container management
- Interface with terminal session managers
- Access cloud provider APIs
- Custom authentication servers

## Extended Thinking

For complex architectural decisions or debugging:
- Trigger with: "think about", "think harder", "think more"
- Shows reasoning process in gray italic text
- Useful for planning WebSocket architecture, security models

## Image Analysis

Claude can analyze:
- UI mockups and wireframes
- Architecture diagrams
- Terminal output screenshots
- Error messages in images

Methods:
1. Drag & drop into Claude Code
2. Paste with Ctrl+V
3. Provide image path

## Best Practices for Our Project

### 1. Parallel Agent Execution
```bash
# Launch multiple agents for different aspects
- Architecture analysis
- Security review
- Performance optimization
- Code implementation
```

### 2. Hook Ideas for Terminal Security
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "./scripts/validate-docker-command.sh"
          }
        ]
      }
    ]
  }
}
```

### 3. MCP Server for Terminal Sessions
Create custom MCP server to:
- Manage Docker containers
- Track active sessions
- Monitor resource usage
- Implement rate limiting

### 4. Task Management Pattern
```
1. Use TodoWrite for planning complex features
2. Mark tasks as in_progress when starting
3. Update immediately upon completion
4. Break down WebSocket implementation into subtasks
```

## Command Reference

### Essential Commands
```bash
# Start Claude Code
claude

# Start with initial prompt
claude "your query here"

# Query via SDK and exit
claude -p "your query"

# Resume last conversation
claude --continue

# Interactive resume
claude --resume

# Update Claude Code
claude update

# MCP management
claude mcp add <name> <command>
claude mcp list
claude mcp remove <name>

# Hooks management
claude hooks add <event> <matcher> <command>
claude hooks list
claude hooks remove <id>
```

### Advanced Flags
- `--add-dir`: Add working directories
- `--verbose`: Enable detailed logging
- `--max-turns`: Limit agentic turns (useful for controlling autonomous behavior)
- `--model`: Set specific model
- `--permission-mode`: Configure permission settings
- `--output-format`: Specify response format (text, json, stream-json)
- `--print`: Non-interactive output

## Settings Hierarchy

Claude Code uses a hierarchical settings system:
1. **Enterprise policies** (highest priority)
2. **Command line arguments**
3. **Local project settings** (`.claude/settings.local.json`)
4. **Shared project settings** (`.claude/settings.json`)
5. **User settings** (`~/.claude/settings.json`) (lowest priority)

### Key Settings
- `apiKeyHelper`: Custom script for authentication
- `cleanupPeriodDays`: Chat transcript retention
- `env`: Environment variables for sessions
- `permissions`: Tool usage control with allow/deny rules
- `hooks`: Pre/post tool execution commands

## Security Considerations

1. **Hooks run with full user permissions** - validate all commands
2. **MCP servers should be trusted** - use official or self-built servers
3. **File operations are immediate** - no sandboxing by default
4. **Git operations affect real repository** - be cautious with commits
5. **Settings hierarchy** - enterprise policies can override local settings

## Integration with Pocket Console

### Priority Features to Leverage
1. **Hooks**: Auto-format code, validate Docker commands, log operations
2. **MCP**: Create custom server for terminal session management
3. **Parallel Agents**: Speed up development with concurrent tasks
4. **Extended Thinking**: Architecture and security planning
5. **Image Analysis**: UI/UX development from mockups

### Hook Strategy for Pocket Console

Our hooks are configured in `.claude/settings.json` and scripts are in `.claude/hooks/`:

1. **Code Quality Hook** (PostToolUse)
   - Runs `pnpm lint:fix` after file edits
   - Ensures consistent code style across the monorepo
   - Non-blocking (uses `|| true` to prevent interruption)

2. **Security Hook** (PreToolUse)
   - Validates bash commands before execution
   - Prevents dangerous operations (rm -rf /, privileged Docker, etc.)
   - Logs all commands for audit trail
   - Located at `.claude/hooks/validate-command.sh`

3. **Future Hook Ideas**
   - WebSocket message validation
   - Docker container lifecycle hooks
   - Test runner integration
   - Browser refresh for UI development
   - Performance monitoring

### Development Workflow
1. Use `--continue` to maintain context across sessions
2. Leverage TodoWrite for tracking WebSocket implementation
3. Hooks automatically enforce quality and security
4. Create MCP server for Docker integration
5. Use parallel agents for testing different terminal scenarios

## References
- [Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code)
- [MCP Protocol](https://modelcontextprotocol.io)
- [Hooks Documentation](https://docs.anthropic.com/en/docs/claude-code/hooks)