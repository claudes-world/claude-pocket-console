# Terminal Server

>Author: Claude Opus 4.0

FastAPI service that manages isolated Docker containers for terminal sessions.

## Local Development

### Setup

```bash
# From repo root
cd apps/terminal-server

# Create virtual environment
uv venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows

# Install dependencies
uv pip sync requirements.txt

# Install dev dependencies
uv pip install -r requirements-dev.txt
```

### Running

```bash
# Development server with hot reload
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

# Or use the npm script from repo root
pnpm --filter terminal-server dev
```

### Environment Variables

```bash
# .env.local
ENV=development
CONVEX_URL=http://localhost:3210
DOCKER_SOCKET=/var/run/docker.sock
SESSION_TIMEOUT_MINUTES=5
MAX_SESSIONS_PER_USER=3
CONTAINER_CPU_LIMIT=0.5
CONTAINER_MEMORY_LIMIT=512m
```

## Project Structure

```
terminal-server/
├── src/
│   ├── main.py              # FastAPI app & routes
│   ├── websocket.py         # WebSocket handler
│   ├── docker_manager.py    # Container lifecycle
│   ├── security.py          # Auth & rate limiting
│   ├── models.py            # Pydantic models
│   └── config.py            # Settings management
├── tests/
│   ├── test_websocket.py
│   ├── test_docker.py
│   └── conftest.py          # Pytest fixtures
├── Dockerfile
├── Dockerfile.dev
├── pyproject.toml
├── requirements.txt         # Prod dependencies (via uv)
└── requirements-dev.txt     # Dev dependencies
```

## API Endpoints

### Create Session
```python
POST /api/v1/sessions
Authorization: Bearer <token>

Response:
{
  "session_id": "sess_abc123",
  "websocket_url": "ws://localhost:8000/ws/terminal/sess_abc123",
  "created_at": "2024-01-01T00:00:00Z"
}
```

### WebSocket Connection
```python
# Connect to WebSocket
ws = websocket.WebSocket()
ws.connect("ws://localhost:8000/ws/terminal/{session_id}")

# Send stdin
ws.send(json.dumps({
  "type": "stdin",
  "data": "ls -la\n"
}))

# Receive stdout/stderr
message = ws.recv()
# {"type": "stdout", "data": "total 64\ndrwxr-xr-x..."}
```

## Docker Integration

The service needs access to Docker daemon:

```bash
# Local development (Docker Desktop)
docker run -v /var/run/docker.sock:/var/run/docker.sock ...

# Production (Cloud Run)
# Configure via Workload Identity & Artifact Registry
```

### Security Hardening

All containers are created with these restrictions:

```python
CONTAINER_CONFIG = {
    "network_mode": "none",          # No network access
    "read_only": True,               # Read-only filesystem
    "tmpfs": {"/tmp": "size=100M"},  # Limited writable space
    "mem_limit": "512m",
    "memswap_limit": "512m",         # Prevent swap usage
    "cpu_shares": 512,               # 0.5 CPU core
    "pids_limit": 100,               # Process limit
    "security_opt": ["no-new-privileges"],
    "user": "nobody:nogroup",
}
```

## Testing

```bash
# Run all tests
pytest

# With coverage
pytest --cov=src --cov-report=html

# Specific test file
pytest tests/test_websocket.py -v

# With live logs
pytest -s

# Type checking
mypy src/

# Linting
ruff check src/
ruff format src/
```

### Key Test Scenarios

1. **WebSocket lifecycle**: Connect → Execute → Disconnect
2. **Container limits**: Memory, CPU, process count
3. **Timeout handling**: Idle and max duration
4. **Concurrent sessions**: Rate limiting per user
5. **Error recovery**: Container crashes, Docker daemon issues

## Debugging

### Common Issues

**1. Docker socket permission denied**
```bash
# Add user to docker group
sudo usermod -aG docker $USER
# Or run with sudo (development only)
```

**2. WebSocket connection drops**
```python
# Check logs for timeout
docker logs term-{session_id}

# Verify container is running
docker ps | grep term-
```

**3. Memory limit exceeded**
```python
# Monitor container stats
docker stats term-{session_id}

# Check OOM killer
docker inspect term-{session_id} | grep OOMKilled
```

### Logging

```python
import structlog

logger = structlog.get_logger()

# Structured logging throughout
logger.info("session.created", session_id=session_id, user_id=user_id)
logger.error("container.failed", error=str(e), session_id=session_id)
```

## Performance Tuning

### Connection Pool
```python
# src/docker_manager.py
docker_client = docker.DockerClient(
    base_url='unix://var/run/docker.sock',
    timeout=30,
    max_pool_size=50  # Tune based on load
)
```

### WebSocket Settings
```python
# src/config.py
class Settings:
    WS_PING_INTERVAL = 30  # Keep-alive ping
    WS_PING_TIMEOUT = 10   # Pong timeout
    WS_MAX_SIZE = 1024 * 1024  # 1MB max message
    WS_MAX_QUEUE = 32      # Backpressure limit
```

## Production Considerations

1. **Health Checks**: Implement proper liveness/readiness probes
2. **Metrics**: Export Prometheus metrics for monitoring
3. **Secrets**: Use Secret Manager for sensitive config
4. **Scaling**: Horizontal scaling with session affinity
5. **Cleanup**: Cron job for orphaned containers

## Dependencies

Core dependencies (see `pyproject.toml` for versions):
- `fastapi`: Web framework
- `uvicorn[standard]`: ASGI server with WebSocket support
- `python-docker`: Docker API client
- `pydantic`: Data validation
- `structlog`: Structured logging
- `httpx`: Async HTTP client for Convex
- `python-jose`: JWT handling

Dev dependencies:
- `pytest`: Testing framework
- `pytest-asyncio`: Async test support
- `pytest-cov`: Coverage reports
- `mypy`: Type checking
- `ruff`: Linting and formatting