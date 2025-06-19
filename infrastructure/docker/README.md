# Docker Infrastructure for Claude Pocket Console

This directory contains Docker configurations for the Claude Pocket Console sandbox environments.

## Overview

The Docker infrastructure provides isolated, secure containers for user command execution. Each user session runs in its own container with resource limits and security restrictions.

## Files

- `Dockerfile.sandbox` - Main Dockerfile for building sandbox containers
- `.dockerignore` - Files to exclude from Docker build context
- `scripts/` - Helper scripts for container management (to be created)

## Sandbox Container Features

### Security
- Non-root user execution
- Read-only root filesystem
- Network isolation with allowlist
- Seccomp profiles for syscall filtering
- Resource limits (CPU, memory, processes)
- No persistent storage between sessions

### Pre-installed Tools
- Basic Unix utilities
- Programming languages (Python, Node.js, etc.)
- Text editors (vim, nano)
- Version control (git)
- Package managers (pip, npm)

### Resource Limits
- Memory: 2GB per container
- CPU: 1 core equivalent
- Disk: 10GB temporary storage
- Processes: 100 concurrent
- Network: Restricted egress

## Building

```bash
# Build sandbox image
docker build -f Dockerfile.sandbox -t claude-pocket-console/sandbox:latest .

# Build with specific version tag
docker build -f Dockerfile.sandbox -t claude-pocket-console/sandbox:v1.0.0 .

# Multi-platform build
docker buildx build --platform linux/amd64,linux/arm64 \
  -f Dockerfile.sandbox \
  -t claude-pocket-console/sandbox:latest .
```

## Running Sandboxes

```bash
# Run interactive sandbox
docker run -it --rm \
  --name cpc-sandbox-${USER_ID} \
  --memory="2g" \
  --cpus="1.0" \
  --pids-limit=100 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=1g \
  --tmpfs /home/sandbox:rw,exec,nosuid,size=1g \
  --security-opt no-new-privileges \
  --cap-drop ALL \
  --cap-add CHOWN \
  --cap-add SETUID \
  --cap-add SETGID \
  claude-pocket-console/sandbox:latest

# Run with custom command
docker run --rm \
  --name cpc-sandbox-${USER_ID} \
  claude-pocket-console/sandbox:latest \
  python3 -c "print('Hello from sandbox')"
```

## Container Management

### Lifecycle
1. Container created on session start
2. User commands executed inside container
3. Output streamed to web interface
4. Container destroyed on session end
5. No data persists between sessions

### Monitoring
- Resource usage tracked via Docker stats
- Logs sent to centralized logging
- Alerts on resource limit violations
- Automatic cleanup of stale containers

### Networking
- No inbound connections allowed
- Outbound connections restricted to:
  - Package repositories (npm, pip, etc.)
  - Documentation sites
  - Approved API endpoints
- DNS resolution controlled

## Development

### Local Testing
```bash
# Build and run locally
./scripts/build-sandbox.sh
./scripts/run-sandbox.sh

# Test with sample workload
./scripts/test-sandbox.sh
```

### Adding Tools
1. Update Dockerfile.sandbox
2. Test security implications
3. Update documentation
4. Build and push new image

## Security Considerations

### Isolation Layers
1. Container namespace isolation
2. Seccomp filtering
3. AppArmor/SELinux policies
4. Resource cgroups
5. Network policies

### Threat Model
- Prevent container escape
- Limit resource exhaustion
- Block network attacks
- Prevent data exfiltration
- Audit all activities

### Updates
- Base image updated monthly
- Security patches applied immediately
- Vulnerability scanning on each build
- Penetration testing quarterly

## Integration

The Docker sandbox integrates with:
- Convex backend for session management
- WebSocket connections for real-time I/O
- Terraform-provisioned container registries
- Kubernetes for orchestration (future)

## Best Practices

1. Never run containers as root
2. Always set resource limits
3. Use read-only filesystems
4. Drop all unnecessary capabilities
5. Implement health checks
6. Log all container activities
7. Automate security scanning
8. Regular security audits