# GitHub CLI Environment Setup

## Important: Always Source Environment File

Before running any `gh` (GitHub CLI) commands in this project, you MUST first source the environment file:

```bash
source .claude/.env
```

This file contains:
- GitHub authentication tokens
- Repository-specific configurations
- Other environment variables needed for GitHub CLI operations

## Why This Is Required

The `.claude/.env` file sets up the proper GitHub authentication and configuration that allows the CLI to:
- Create issues and pull requests
- Comment on existing issues
- Access private repositories
- Use the correct GitHub account

## Reminder for LLM Agents

**ALWAYS** run this command at the start of any session where you'll be using GitHub CLI:

```bash
source .claude/.env
```

Without this, GitHub CLI commands may fail with authentication errors or use incorrect credentials.