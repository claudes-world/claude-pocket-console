---
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(gh issue view:*), Bash(gh issue list:*), Bash(gh issue comment:*)
description: Save conversation context before restarting Claude Code using the CONTINUE.md file.
---

Unfortunately the CLI is getting glitchy from our long conversation. We will need to restart.

Please create/update/overwrite CONTINUE.md to provide context for everything we need to resume where we are leaving off in a new chat.

Make sure to include the following in the file:

- current date and time
- current branch name
- current issue number (if we are working on one)
- current working directory
- current worktree (if we are working on one)

Then comment on the current GitHub issue (if we are working on one) explaining what you did and that we are restarting.

$ARGUMENTS
