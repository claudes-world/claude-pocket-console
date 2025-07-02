# Multi-Agent Development Setup

This guide explains how to set up and use the multi-agent development environment for the Claude Pocket Console project. The multi-agent system allows multiple AI agents to work simultaneously on different features while maintaining complete isolation of resources, dependencies, and development environments.

## What is Multi-Agent Development?

Multi-agent development enables multiple AI agents to collaborate on a single codebase by creating isolated workspace environments. Each agent gets its own:

- **Git worktree** - Independent working directory with its own branch
- **Port allocation** - Dedicated range of ports (100 ports per agent)
- **Docker environment** - Isolated container namespace with unique prefixes
- **Configuration** - Agent-specific environment variables and settings
- **Process isolation** - No conflicts between development servers

This approach eliminates the typical coordination problems of multi-developer teams while enabling parallel development at scale.

## Benefits of Multi-Agent Development

### 🚀 **Parallel Development**
- Work on multiple features simultaneously without conflicts
- Independent testing and validation of changes
- Reduced development cycle time through parallelization

### 🔒 **Complete Isolation**
- No port conflicts between agent development servers
- Isolated Docker environments prevent container name collisions
- Separate git branches eliminate merge conflicts during development

### 📊 **Resource Management**
- Predictable resource allocation per agent
- Built-in health monitoring and cleanup tools
- Automatic resource cleanup when agents complete work

### 🎯 **Simplified Coordination**
- Each agent focuses on a single feature or issue
- Clear ownership and responsibility boundaries
- Structured workflow integration with GitHub issues

## Prerequisites

### System Requirements

- **Node.js** >= 20.0.0
- **pnpm** >= 8.0.0  
- **Docker** with daemon running
- **Git** with worktree support
- **jq** for JSON processing
- **GitHub CLI** (optional, for issue management)

### Recommended Resources

- **Minimum**: 8GB RAM, 4 CPU cores
- **Recommended**: 16GB RAM, 8 CPU cores
- **Disk Space**: 5GB free space (2GB per active agent workspace)

### Verification

```bash
# Check system dependencies
node --version     # Should be >= 20.0.0
pnpm --version     # Should be >= 8.0.0
docker --version   # Should be running
git --version      # Any recent version
jq --version       # For JSON processing

# Verify Docker is running
docker info

# Verify project setup
cd /path/to/pocket-console
pnpm install       # Install dependencies
```

## Quick Start Guide

### 1. Create Your First Agent Workspace

```bash
# Navigate to project root
cd /path/to/pocket-console

# Create agent workspace for a new feature
./scripts/agents/setup-workspace.sh agent-alpha feat/123-websocket-feature 123

# This creates:
# - Git worktree at agent-workspaces/agent-alpha/
# - Port allocation: 3100-3199
# - Docker prefix: alpha
# - Environment configuration
```

### 2. Start Development

```bash
# Navigate to agent workspace
cd agent-workspaces/agent-alpha

# Start development servers
pnpm dev

# Open in your editor
code .
```

Your agent now has:
- **Web server**: http://localhost:3100
- **API server**: http://localhost:3101  
- **WebSocket**: http://localhost:3102
- **Isolated environment**: All dependencies and configurations

### 3. Monitor Agent Status

```bash
# List all agent workspaces
./scripts/agents/list-workspaces.sh

# Check system health
./scripts/agents/health-check.sh

# Monitor specific agent
./scripts/agents/health-check.sh --agent agent-alpha
```

### 4. Cleanup When Done

```bash
# Clean up agent workspace
./scripts/agents/cleanup-workspace.sh agent-alpha

# Or preserve the git branch
./scripts/agents/cleanup-workspace.sh agent-alpha --preserve-branch
```

## Detailed Setup Instructions

### Agent Naming Convention

Agents follow the naming pattern `agent-{name}` where name should be descriptive:

```bash
agent-alpha      # General purpose agent
agent-beta       # Secondary development agent  
agent-frontend   # UI/frontend focused agent
agent-backend    # Server/API focused agent
agent-research   # Investigation and analysis
```

**Available agent slots**: alpha, beta, gamma, delta, epsilon, zeta, eta, theta, iota, kappa

### Port Allocation Strategy

Each agent receives a dedicated port range to prevent conflicts:

| Agent | Port Range | Web | API | WebSocket |
|-------|------------|-----|-----|-----------|
| agent-alpha | 3100-3199 | 3100 | 3101 | 3102 |
| agent-beta | 3200-3299 | 3200 | 3201 | 3202 |
| agent-gamma | 3300-3399 | 3300 | 3301 | 3302 |
| ... | ... | ... | ... | ... |

This allocation ensures no conflicts when multiple agents run development servers simultaneously.

### Docker Environment Isolation

Each agent gets a unique Docker environment:

```bash
# Agent Alpha containers
alpha-terminal-session-1
alpha-sandbox-container
alpha-db-test-instance

# Agent Beta containers  
beta-terminal-session-1
beta-sandbox-container
beta-db-test-instance
```

This prevents container name collisions and enables parallel testing.

### Branch Management Integration

The multi-agent setup integrates with our git workflow:

```bash
# Create workspace for specific issue
./scripts/agents/setup-workspace.sh agent-alpha feat/456-auth-system 456

# This automatically:
# 1. Creates or checks out the feature branch
# 2. Sets up git worktree
# 3. Comments on GitHub issue #456
# 4. Configures environment for the feature
```

## Common Workflows and Examples

### Scenario 1: Parallel Feature Development

Two agents working on different features simultaneously:

```bash
# Agent Alpha: WebSocket improvements
./scripts/agents/setup-workspace.sh agent-alpha feat/123-websocket-reconnect 123
cd agent-workspaces/agent-alpha
pnpm dev  # Runs on ports 3100-3102

# Agent Beta: Authentication system  
./scripts/agents/setup-workspace.sh agent-beta feat/124-github-oauth 124
cd agent-workspaces/agent-beta
pnpm dev  # Runs on ports 3200-3202
```

Both agents can develop and test independently without any resource conflicts.

### Scenario 2: Research and Implementation

One agent researches while another implements:

```bash
# Research agent investigates performance optimization
./scripts/agents/setup-workspace.sh agent-research research/125-performance-analysis 125

# Implementation agent works on current feature
./scripts/agents/setup-workspace.sh agent-alpha feat/126-user-sessions 126
```

### Scenario 3: Bug Fix and Feature Development

Handle urgent bug fixes without disrupting feature work:

```bash
# Main agent continues feature development
cd agent-workspaces/agent-alpha  # feat/123-websocket-feature
pnpm dev

# Bug fix agent handles urgent issue
./scripts/agents/setup-workspace.sh agent-beta fix/127-container-leak 127
cd agent-workspaces/agent-beta
# Fix bug, test, and deploy without affecting main feature work
```

### Scenario 4: Frontend/Backend Split

Specialized agents for different technology stacks:

```bash
# Frontend agent: React/Next.js work
./scripts/agents/setup-workspace.sh agent-frontend feat/128-ui-redesign 128

# Backend agent: FastAPI/Python work
./scripts/agents/setup-workspace.sh agent-backend feat/129-api-optimization 129
```

## Advanced Configuration

### Custom Port Ranges

Modify port allocations in `scripts/agents/setup-workspace.sh`:

```bash
# Edit port ranges if needed
declare -A PORT_RANGES=(
    ["agent-alpha"]="3100-3199"
    ["agent-custom"]="4000-4099"  # Custom agent
)
```

### Environment Customization

Each agent workspace gets a `.env.local` file for customization:

```bash
# agent-workspaces/agent-alpha/.env.local
NEXT_PUBLIC_PORT=3100
API_PORT=3101
WEBSOCKET_PORT=3102
DOCKER_CONTAINER_PREFIX=alpha
AGENT_NAME=agent-alpha

# Custom environment variables
FEATURE_FLAG_WEBSOCKET_V2=true
DEBUG_LEVEL=verbose
```

### Docker Network Isolation

Agents can have isolated Docker networks:

```bash
# Create agent-specific networks
docker network create alpha_network
docker network create beta_network

# Use in docker-compose.yml
version: "3.8"
services:
  terminal-server:
    networks:
      - ${DOCKER_NETWORK_NAME:-default}
```

## Health Monitoring and Maintenance

### Health Check Dashboard

```bash
# Comprehensive health check
./scripts/agents/health-check.sh

# Output shows:
# ✓ Git status across all workspaces
# ✓ Port conflict detection
# ✓ Docker container health
# ✓ Configuration file integrity
# ✓ Resource usage monitoring
```

### Workspace Status Overview

```bash
# List all workspaces with status
./scripts/agents/list-workspaces.sh

# Example output:
# AGENT           STATUS   BRANCH                    GIT        PORTS           CTR PRC DISK
# agent-alpha     ●        feat/123-websocket       clean      3100-3199       2   3   1.2G
# agent-beta      ○        feat/124-auth-system     behind     3200-3299       0   0   800M
# agent-gamma     ●        fix/125-container-bug    dirty      3300-3399       1   2   950M
```

### Automated Cleanup

```bash
# Clean up idle workspaces
./scripts/agents/list-workspaces.sh --idle | while read workspace; do
  echo "Cleaning up idle workspace: $workspace"
  ./scripts/agents/cleanup-workspace.sh "$workspace" --force
done

# Health check with auto-fix
./scripts/agents/health-check.sh --fix
```

## Troubleshooting

### Common Issues

#### Port Conflicts

**Symptom**: Development server won't start, port already in use

```bash
# Check port usage
./scripts/agents/health-check.sh --ports

# Kill processes on agent ports
lsof -ti:3100 | xargs kill -9

# Or use the automated health check
./scripts/agents/health-check.sh --fix
```

#### Git Worktree Issues

**Symptom**: Cannot create workspace, worktree errors

```bash
# Clean up broken worktrees
git worktree prune

# Force remove problematic worktree
git worktree remove agent-workspaces/agent-alpha --force

# Recreate workspace
./scripts/agents/setup-workspace.sh agent-alpha feat/123-new-branch
```

#### Docker Container Conflicts

**Symptom**: Container name already exists

```bash
# List agent containers
docker ps -a --filter "name=alpha-"

# Clean up containers for specific agent
docker stop $(docker ps -q --filter "name=alpha-")
docker rm $(docker ps -aq --filter "name=alpha-")

# Or use cleanup script
./scripts/agents/cleanup-workspace.sh agent-alpha --force
```

#### Dependency Issues

**Symptom**: npm/pnpm install fails in workspace

```bash
# Clean and reinstall dependencies
cd agent-workspaces/agent-alpha
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Or recreate entire workspace
cd ../../
./scripts/agents/cleanup-workspace.sh agent-alpha --preserve-branch
./scripts/agents/setup-workspace.sh agent-alpha feat/existing-branch
```

### Disk Space Management

```bash
# Check workspace disk usage
./scripts/agents/list-workspaces.sh --summary

# Clean up large workspaces
find agent-workspaces -name "node_modules" -type d -exec rm -rf {} +
find agent-workspaces -name ".next" -type d -exec rm -rf {} +

# Rebuild dependencies
cd agent-workspaces/agent-alpha && pnpm install
```

### Resource Monitoring

```bash
# Monitor system resources
./scripts/agents/health-check.sh --verbose

# Check Docker resource usage
docker system df
docker system prune  # Clean up unused resources

# Monitor active processes
ps aux | grep -E "(node|pnpm|next|docker)"
```

## Best Practices and Tips

### 1. Workspace Hygiene

- **Clean up regularly**: Don't let idle workspaces accumulate
- **Monitor disk usage**: Node.js projects can grow large quickly
- **Commit frequently**: Keep work safe with regular commits
- **Use descriptive branch names**: Follow the `type/issue-description` pattern

### 2. Resource Management

- **Limit concurrent agents**: Recommended maximum 3-4 active agents
- **Monitor port usage**: Use health checks to detect conflicts
- **Docker cleanup**: Regularly prune unused containers and images
- **Memory awareness**: Each agent uses ~2GB RAM when active

### 3. Coordination Strategies

- **Issue assignment**: Assign GitHub issues to specific agents
- **Branch naming**: Use consistent branch naming for tracking
- **Status updates**: Regular micro-blog updates in GitHub issues
- **Health monitoring**: Run health checks before starting work

### 4. Development Workflow

```bash
# Recommended workflow
./scripts/agents/setup-workspace.sh agent-alpha feat/123-description 123
cd agent-workspaces/agent-alpha
pnpm lint && pnpm type-check  # Verify clean state
pnpm dev                      # Start development
# ... do work ...
pnpm test                     # Verify changes
git commit -m "feat: implement feature"
gh pr create                  # Create pull request
cd ../../
./scripts/agents/cleanup-workspace.sh agent-alpha --preserve-branch
```

### 5. Security Considerations

- **Isolated environments**: Each agent has isolated Docker networking
- **Port restrictions**: Only development ports are exposed
- **Resource limits**: Docker containers have memory and CPU limits
- **Clean shutdown**: Always use cleanup scripts to prevent resource leaks

## Integration with Development Tools

### GitHub Integration

The agent system integrates seamlessly with GitHub workflows:

```bash
# Create workspace from issue
gh issue view 123
./scripts/agents/setup-workspace.sh agent-alpha feat/123-websocket-feature 123

# Agent automatically comments on issue
# Development proceeds with regular micro-blog updates
# PR creation includes issue links
```

### CI/CD Integration

Agents work with existing CI/CD pipelines:

```bash
# Each workspace runs the same quality checks
cd agent-workspaces/agent-alpha
pnpm lint      # ESLint + Ruff
pnpm type-check # TypeScript checking
pnpm test      # Jest + pytest
pnpm build     # Production build verification
```

### Editor Integration

Recommended VS Code setup for agent workspaces:

```json
// .vscode/settings.json (per workspace)
{
  "typescript.preferences.includePackageJsonAutoImports": "auto",
  "eslint.workingDirectories": ["./"],
  "terminal.integrated.defaultProfile.linux": "bash",
  "files.watcherExclude": {
    "**/agent-workspaces/**": true
  }
}
```

## Monitoring and Analytics

### Performance Metrics

Track agent productivity with built-in monitoring:

```bash
# Generate health reports
./scripts/agents/health-check.sh --json > reports/health-$(date +%Y%m%d).json

# Workspace utilization summary
./scripts/agents/list-workspaces.sh --summary --json
```

### Log Management

Each agent maintains separate logs:

```bash
# Agent-specific logs
logs/agent-alpha-dev-$(date +%Y%m%d).log
logs/agent-beta-test-$(date +%Y%m%d).log

# Health check reports
logs/health-$(date +%Y%m%d-%H%M%S).log

# Cleanup operation logs
logs/cleanup-$(date +%Y%m%d-%H%M%S).log
```

## Future Enhancements

### Planned Features

1. **Auto-scaling**: Automatic workspace creation based on issue labels
2. **Load balancing**: Intelligent agent assignment based on system resources
3. **Cross-agent communication**: Shared state for coordinated development
4. **Integration testing**: Automated testing across agent changes
5. **Metrics dashboard**: Web-based monitoring and management interface

### Extensibility

The agent system is designed to be extensible:

```bash
# Add new agent types
scripts/agents/setup-specialized-agent.sh  # Custom agent configurations
scripts/agents/setup-testing-agent.sh     # Specialized testing environments
scripts/agents/setup-research-agent.sh    # Analysis and investigation tools
```

## Conclusion

The multi-agent development setup transforms the Claude Pocket Console development process by enabling true parallel development with complete resource isolation. This approach eliminates traditional coordination bottlenecks while maintaining high code quality and system reliability.

### Key Takeaways

- **Isolation is key**: Complete resource separation eliminates conflicts
- **Automation saves time**: Scripted setup and cleanup reduce manual overhead  
- **Monitoring prevents issues**: Regular health checks catch problems early
- **Structured workflow**: Integration with GitHub issues provides clear organization

### Getting Started

1. Review the [Quick Start Guide](#quick-start-guide)
2. Set up your first agent workspace
3. Explore the monitoring tools
4. Integrate with your preferred development workflow
5. Scale up to multiple agents as needed

For additional help, refer to the troubleshooting section or examine the agent scripts in `scripts/agents/` for implementation details.

---

**Related Documentation**:
- [CLAUDE.md](../CLAUDE.md) - Project development guidelines
- [DEVELOPMENT.md](DEVELOPMENT.md) - General development setup
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture overview

**Script Reference**:
- `scripts/agents/setup-workspace.sh` - Create agent workspaces
- `scripts/agents/list-workspaces.sh` - Monitor workspace status  
- `scripts/agents/health-check.sh` - System health monitoring
- `scripts/agents/cleanup-workspace.sh` - Resource cleanup