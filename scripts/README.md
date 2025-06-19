# Scripts Directory

This directory contains helper scripts for developing and maintaining the Claude Pocket Console monorepo.

## Available Scripts

### 🚀 dev.sh
Main development helper script providing shortcuts for common tasks.

```bash
# Start all services
./scripts/dev.sh start

# Start specific service
./scripts/dev.sh web
./scripts/dev.sh terminal
./scripts/dev.sh convex

# Run tests
./scripts/dev.sh test
./scripts/dev.sh test terminal  # Test specific package

# Other commands
./scripts/dev.sh lint    # Run linters
./scripts/dev.sh format  # Format code
./scripts/dev.sh build   # Build all packages
./scripts/dev.sh status  # Check service status
```

### 🧹 clean.sh
Cleanup script for removing build artifacts, caches, and temporary files.

```bash
# Clean everything (prompts for confirmation)
./scripts/clean.sh

# Clean specific artifacts
./scripts/clean.sh node    # Node.js artifacts only
./scripts/clean.sh python  # Python artifacts only
./scripts/clean.sh docker  # Docker containers/images
./scripts/clean.sh build   # Build outputs only
./scripts/clean.sh cache   # Caches only
```

### 🔍 check-deps.sh
Dependency checker that verifies all required tools are installed with correct versions.

```bash
# Check all dependencies
./scripts/check-deps.sh
```

This script checks:
- Required dependencies (Node.js, pnpm, Python, Docker, Git)
- Optional tools (wscat, GitHub CLI, Convex CLI)
- Environment configuration
- Project structure

## Script Features

### Common Features
- **Colored output** - Clear visual feedback with color-coded messages
- **Error handling** - Scripts exit cleanly on errors
- **Help messages** - All scripts support `help` command
- **Safety checks** - Confirmation prompts for destructive operations

### Development Workflow

1. **Initial Setup**
   ```bash
   ./scripts/check-deps.sh  # Verify prerequisites
   ./scripts/dev.sh setup   # Install deps and create .env.local
   ```

2. **Daily Development**
   ```bash
   ./scripts/dev.sh start   # Start all services
   ./scripts/dev.sh status  # Check what's running
   ./scripts/dev.sh logs web  # View specific service logs
   ```

3. **Testing**
   ```bash
   ./scripts/dev.sh test    # Run all tests
   ./scripts/dev.sh lint    # Check code style
   ```

4. **Cleanup**
   ```bash
   ./scripts/clean.sh cache  # Clear caches if having issues
   ./scripts/clean.sh all    # Full cleanup before fresh install
   ```

## Adding New Scripts

When adding new scripts:

1. Create the script file in this directory
2. Add shebang: `#!/usr/bin/env bash`
3. Make it executable: `chmod +x script-name.sh`
4. Include:
   - Usage/help function
   - Colored output for clarity
   - Error handling with `set -e`
   - Comments explaining complex logic
5. Update this README with documentation

## Best Practices

- Use descriptive function names
- Add comments for complex operations
- Include confirmation prompts for destructive actions
- Test scripts on both macOS and Linux
- Keep scripts focused on a single purpose
- Use consistent color scheme across scripts

## Troubleshooting

### Permission Denied
```bash
# Make scripts executable
chmod +x scripts/*.sh
```

### Command Not Found
```bash
# Run from project root
cd /path/to/claude-pocket-console
./scripts/dev.sh
```

### Scripts Not Working on Windows
These scripts are designed for Unix-like systems (macOS/Linux). 
Windows users should use WSL2 or Git Bash.

## Color Reference

Colors used in scripts for consistency:
- 🔵 **Blue**: Headers and informational messages
- 🟢 **Green**: Success messages
- 🟡 **Yellow**: Warnings and prompts
- 🔴 **Red**: Errors and failures
- ⚪ **No Color**: Regular output