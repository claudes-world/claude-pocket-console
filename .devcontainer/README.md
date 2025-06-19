# Pocket Console Development Container

This dev container provides a comprehensive development environment for the Pocket Console monorepo with all necessary tools pre-installed.

## Features

### Base Environment
- **OS**: Ubuntu 24.04 LTS
- **Shell**: Zsh with Oh My Zsh (includes auto-suggestions and syntax highlighting)
- **User**: Non-root `developer` user with sudo access

### Development Tools

#### Core Tools
- Git with GitHub CLI (`gh`)
- Ripgrep (`rg`) for fast searching
- curl, wget, jq for API interactions
- Network tools: netcat, ping, traceroute, nmap, etc.
- Process monitoring: htop, strace, ltrace
- Terminal multiplexers: tmux, screen, byobu

#### Languages & Runtimes
- **Python 3.12** with pip, poetry, pipenv
- **Node.js LTS** (v20) via NVM
- **pnpm 8.15.1** (matching project version)
- **TypeScript** and related tools

#### Development Utilities
- Docker and Docker Compose (Docker-in-Docker enabled)
- Turbo for monorepo builds
- Black, Ruff, MyPy for Python
- ESLint, Prettier for JavaScript/TypeScript
- Jupyter notebook support
- Live reload tools

#### Enhanced Terminal Experience
- bat (better cat with syntax highlighting)
- lazygit (terminal UI for git)
- fzf (fuzzy finder)
- zsh with plugins

#### AI Development Tools
- Claude Code CLI (`claude`)
- CC Usage tracker (`ccusage`)
- Task Master AI (`task-master-ai`)
- Claude Squad (multi-agent system)

### Services

The dev container includes:
- **PostgreSQL 16** - Database server on port 5432
- **Redis 7** - Cache server on port 6379
- **Adminer** - Database management UI on port 8080

## Usage

### Starting the Dev Container

1. Open the project in VS Code
2. When prompted, click "Reopen in Container" or use the command palette: `Dev Containers: Reopen in Container`
3. Wait for the container to build (first time may take 10-15 minutes)
4. The post-create command will automatically:
   - Run `pnpm install && pnpm build`
   - Set up SSH keys for GitHub (if not already configured)

### SSH Key Setup

The dev container automatically runs `.devcontainer/setup-ssh.sh` on creation, which:
- Generates an ED25519 SSH key if one doesn't exist
- Attempts to add the key to your GitHub account using `gh` CLI
- Configures git to use SSH for GitHub operations

**First-time setup:**
1. If `gh` CLI is not authenticated, run: `gh auth login`
2. Then run: `.devcontainer/setup-ssh.sh` to complete SSH setup
3. Your SSH key will be automatically added to your GitHub account

### Accessing Services

- **PostgreSQL**: `localhost:5432` (user: postgres, password: postgres, db: pocket_console)
- **Redis**: `localhost:6379`
- **Adminer**: `http://localhost:8080`

### Running Applications

```bash
# Install dependencies (if not already done)
pnpm install

# Run the web app
pnpm --filter web dev

# Run the terminal server
pnpm --filter terminal-server dev

# Run all apps in development mode
pnpm dev

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Docker-in-Docker

The container has Docker installed and the Docker socket is mounted, allowing you to:
- Build Docker images
- Run docker-compose files
- Use Docker for testing

### Python Development

For the FastAPI terminal server:
```bash
cd apps/terminal-server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

### VS Code Extensions

The dev container automatically installs numerous extensions including:
- ESLint, Prettier
- Python, Pylance, Black formatter
- GitLens, GitHub Pull Requests
- Docker, Remote Containers
- Database tools
- And many more...

## Customization

### User Settings

The container creates a user named `developer`. To use your own username:
1. Edit `.devcontainer/docker-compose.yml`
2. Change the `USERNAME` build arg
3. Rebuild the container

### Adding Tools

To add more tools:
1. Edit `.devcontainer/Dockerfile`
2. Add installation commands in the appropriate section
3. Rebuild the container

### Persistent Data

The following are persisted across container rebuilds:
- PostgreSQL data
- Redis data
- VS Code extensions
- Shell history
- pnpm store

### Claude Configuration

Your `.claude` folder from the host is automatically available in the dev container since the entire workspace is mounted. This includes:
- Your personal CLAUDE.md instructions
- Any API keys or environment variables
- Custom configurations

The folder is accessible at the same relative path within the container.

## Troubleshooting

### Container Build Issues
- Ensure Docker Desktop is running
- Check available disk space
- Try clearing Docker cache: `docker system prune -a`

### Permission Issues
- The `developer` user has sudo access
- Use `sudo` for system-level operations
- Docker commands work without sudo

### Port Conflicts
- Check if ports 3000, 8000, 5432, 6379, 8080 are free
- Modify `.devcontainer/devcontainer.json` to use different ports if needed

### Performance
- On macOS/Windows, file system operations may be slower
- The workspace is mounted with `:cached` for better performance
- Consider using WSL2 on Windows for best performance