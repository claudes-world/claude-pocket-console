# Agent Configuration Templates

This directory contains template files for setting up agent workspaces in the Claude Pocket Console project. These templates provide a standardized way to configure multiple development agents with proper isolation and resource allocation.

## Template Files

### 1. `.env.local.template`

**Purpose**: Environment variable template for agent-specific configuration

This template provides all necessary environment variables for agent workspace setup, including:

- **Agent identification** (ID, name, role)
- **Port allocation** (API, WebSocket, development servers)
- **Docker configuration** (container prefixes, networks, resource limits)
- **Database settings** (Convex URLs, table prefixes)
- **Authentication** (GitHub OAuth, session secrets)
- **Development tools** (linting, testing, monitoring)
- **Feature flags** (experimental features, debugging)

**Usage**:
```bash
# Copy template to agent workspace
cp .env.local.template /path/to/agent/workspace/.env.local

# Replace placeholders with actual values
sed -i 's/{{AGENT_ID}}/agent-terminal-001/g' .env.local
sed -i 's/{{DEV_PORT_BASE}}/3000/g' .env.local
# ... continue for all placeholders
```

### 2. `agent-config.json.template`

**Purpose**: JSON configuration template for agent metadata and resource allocation

This template defines the complete agent configuration structure including:

- **Agent metadata** (info, version, description, tags)
- **Port allocation** (base port, service ports, dynamic ranges)
- **Docker settings** (containers, networks, security)
- **Resource limits** (memory, CPU, disk, concurrent tasks)
- **Monitoring configuration** (health checks, metrics, logging)
- **GitHub integration** (repository, issues, branches)
- **Feature flags** (experimental features, debugging)
- **Backup and recovery** (automated backups, recovery settings)

**Usage**:
```bash
# Copy template to agent workspace
cp agent-config.json.template /path/to/agent/workspace/agent-config.json

# Use setup script to populate values
./scripts/agents/setup-agent.sh --config-template agent-config.json
```

## Template Placeholders

All templates use the `{{PLACEHOLDER}}` syntax for values that need to be replaced. Here are the key placeholders:

### Agent Identification
- `{{AGENT_ID}}` - Unique agent identifier (e.g., "agent-terminal-001")
- `{{AGENT_NAME}}` - Human-readable name (e.g., "Terminal Agent")
- `{{AGENT_ROLE}}` - Agent specialization (terminal, ui, api, testing, etc.)

### Port Allocation
- `{{DEV_PORT_BASE}}` - Base port number (increment by 100 per agent)
- `{{API_PORT}}` - API server port
- `{{WEBSOCKET_PORT}}` - WebSocket connection port
- `{{VITE_DEV_PORT}}` - Vite development server port
- `{{STORYBOOK_PORT}}` - Storybook server port

### Docker Configuration
- `{{DOCKER_CONTAINER_PREFIX}}` - Container name prefix
- `{{DOCKER_NETWORK_NAME}}` - Docker network name
- `{{COMPOSE_PROJECT_NAME}}` - Docker Compose project name
- `{{DOCKER_MEMORY_LIMIT}}` - Memory limit (e.g., "512m", "1g")
- `{{DOCKER_CPU_LIMIT}}` - CPU limit (e.g., "0.5", "1.0")

### Database & Authentication
- `{{CONVEX_URL}}` - Convex deployment URL
- `{{CONVEX_DEPLOY_KEY}}` - Convex deployment key
- `{{GITHUB_CLIENT_ID}}` - GitHub OAuth client ID
- `{{GITHUB_CLIENT_SECRET}}` - GitHub OAuth client secret

### Workspace Paths
- `{{AGENT_WORKSPACE_PATH}}` - Absolute path to agent workspace
- `{{MONOREPO_ROOT}}` - Absolute path to monorepo root
- `{{AGENT_LOGS_DIR}}` - Relative path to logs directory
- `{{AGENT_TEMP_DIR}}` - Relative path to temp directory

## Customization Examples

### Example 1: Terminal Agent Setup
```bash
# Environment variables
AGENT_ID=agent-terminal-001
AGENT_NAME="Terminal Agent"
AGENT_ROLE=terminal
DEV_PORT_BASE=3000
API_PORT=3001
WEBSOCKET_PORT=3002
DOCKER_CONTAINER_PREFIX=terminal-agent
```

### Example 2: UI Development Agent
```bash
# Environment variables
AGENT_ID=agent-ui-main
AGENT_NAME="UI Development Agent"
AGENT_ROLE=ui
DEV_PORT_BASE=3100
VITE_DEV_PORT=3101
STORYBOOK_PORT=3102
DOCKER_CONTAINER_PREFIX=ui-agent
```

### Example 3: API Backend Agent
```bash
# Environment variables
AGENT_ID=agent-api-v2
AGENT_NAME="API Backend Agent"
AGENT_ROLE=api
DEV_PORT_BASE=3200
API_PORT=3201
HEALTH_CHECK_PORT=3202
DOCKER_CONTAINER_PREFIX=api-agent
```

## Integration with Setup Scripts

These templates are designed to work with the agent setup scripts:

### Setup Script Usage
```bash
# Initialize new agent workspace
./scripts/agents/setup-agent.sh \
  --name "terminal-agent" \
  --role "terminal" \
  --port-base 3000 \
  --workspace-path "/home/user/agents/terminal"

# The script will:
# 1. Create workspace directory structure
# 2. Copy and populate templates
# 3. Set up Docker configuration
# 4. Initialize git repository
# 5. Create GitHub issue for tracking
```

### Validation Script
```bash
# Validate agent configuration
./scripts/agents/validate-agent.sh \
  --workspace-path "/home/user/agents/terminal" \
  --config-file "agent-config.json"

# Checks:
# - Port availability
# - Docker configuration
# - Environment variables
# - File permissions
# - Resource limits
```

## Configuration Variables Reference

### Required Variables
These variables must be set for every agent:

| Variable | Description | Example |
|----------|-------------|---------|
| `AGENT_ID` | Unique agent identifier | `agent-terminal-001` |
| `AGENT_NAME` | Human-readable name | `Terminal Agent` |
| `AGENT_ROLE` | Agent specialization | `terminal` |
| `DEV_PORT_BASE` | Base port number | `3000` |
| `AGENT_WORKSPACE_PATH` | Workspace directory | `/home/user/agents/terminal` |
| `MONOREPO_ROOT` | Monorepo root path | `/home/user/code/pocket-console` |

### Optional Variables
These variables have defaults but can be customized:

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENT_LOG_LEVEL` | Logging verbosity | `info` |
| `NODE_ENV` | Environment mode | `development` |
| `DOCKER_MEMORY_LIMIT` | Container memory limit | `512m` |
| `DOCKER_CPU_LIMIT` | Container CPU limit | `0.5` |
| `ENABLE_HOT_RELOAD` | Enable hot reloading | `true` |
| `BACKUP_ENABLED` | Enable automated backups | `false` |

## Troubleshooting

### Common Issues

#### 1. Port Conflicts
**Problem**: Ports already in use when starting agent
**Solution**: 
- Check port allocation in configuration
- Use `netstat -tulpn | grep :PORT` to find conflicts
- Increment port base by 100 for each agent

#### 2. Docker Permission Errors
**Problem**: Permission denied when creating containers
**Solution**:
- Ensure Docker daemon is running
- Add user to docker group: `sudo usermod -aG docker $USER`
- Set correct UID/GID in Docker configuration

#### 3. Missing Environment Variables
**Problem**: Agent fails to start due to missing configuration
**Solution**:
- Validate .env.local file exists and is complete
- Check template placeholders are replaced
- Use validation script to verify configuration

#### 4. Workspace Path Issues
**Problem**: Cannot create or access workspace directory
**Solution**:
- Ensure parent directory exists and is writable
- Check absolute vs relative path usage
- Verify file permissions on workspace directory

### Configuration Validation

Use the validation script to check configuration:

```bash
./scripts/agents/validate-agent.sh --workspace-path /path/to/agent

# Output will show:
# ✓ Configuration file valid
# ✓ Ports available
# ✓ Docker configuration OK
# ✓ Environment variables set
# ✗ Workspace directory not writable
```

### Debug Mode

Enable debug mode for troubleshooting:

```bash
# In .env.local
AGENT_LOG_LEVEL=debug
AGENT_DEV_MODE=true
ENABLE_ADVANCED_DEBUGGING=true

# This enables:
# - Verbose logging
# - Stack traces
# - Performance monitoring
# - Configuration validation
```

## Best Practices

### 1. Port Management
- Use base port increments of 100 per agent
- Reserve port ranges for dynamic allocation
- Document port usage in agent configuration

### 2. Resource Allocation
- Set memory limits based on agent role
- Monitor resource usage during development
- Use Docker resource constraints

### 3. Security
- Never commit .env.local files
- Use different secrets per environment
- Regularly rotate API keys and tokens
- Enable security scanning in CI/CD

### 4. Monitoring
- Enable health checks for all agents
- Set up metrics collection
- Configure log retention policies
- Monitor resource usage trends

### 5. Backup & Recovery
- Enable automated backups for production
- Test recovery procedures regularly
- Document disaster recovery plans
- Store backups in secure, separate locations

## Advanced Configuration

### Multi-Environment Setup

Create environment-specific configurations:

```bash
# Development
cp .env.local.template .env.local.dev
# Production
cp .env.local.template .env.local.prod
# Testing
cp .env.local.template .env.local.test
```

### Dynamic Configuration

Use environment variables for dynamic values:

```bash
# Dynamic port allocation
DEV_PORT_BASE=$((3000 + ${AGENT_INDEX:-0} * 100))
API_PORT=$((${DEV_PORT_BASE} + 1))
WEBSOCKET_PORT=$((${DEV_PORT_BASE} + 2))
```

### Configuration Inheritance

Create base configurations that can be extended:

```json
{
  "extends": "./base-agent-config.json",
  "agentInfo": {
    "role": "terminal",
    "name": "Terminal Agent"
  }
}
```

## Support

For issues with agent configuration:

1. Check the troubleshooting section above
2. Run validation scripts to identify problems
3. Review logs in the agent workspace
4. Create GitHub issue with configuration details
5. Use debug mode for detailed error information

## Contributing

When updating templates:

1. Maintain backward compatibility
2. Update documentation for new variables
3. Add validation for new configuration options
4. Test with multiple agent setups
5. Update examples and troubleshooting guides