# GitHub CLI Environment Setup

## Important: Always Source Environment File

When running any `gh` (GitHub CLI) commands in this project, you MUST source the environment file in the same command:

```bash
source .claude/.env && gh <command>
```

## Examples

```bash
# Creating an issue
source .claude/.env && gh issue create --title "feat: add feature" --body "Description"

# Creating a PR
source .claude/.env && gh pr create --title "feat: implement feature" --body "Description"

# Adding a comment
source .claude/.env && gh issue comment 1 --body "Progress update"
```

## Why This Is Required

The `.claude/.env` file contains:
- GitHub authentication tokens
- Repository-specific configurations
- Other environment variables needed for GitHub CLI operations

These environment variables must be sourced in the same shell execution as the `gh` command for authentication to work properly.

## Important Notes

- Simply running `source .claude/.env` separately won't work - the environment variables don't persist
- Always use the `&&` pattern to ensure the env is sourced before the gh command runs
- This allows you to use your own GitHub account for all operations

Without this pattern, GitHub CLI commands may fail with authentication errors or use incorrect credentials.