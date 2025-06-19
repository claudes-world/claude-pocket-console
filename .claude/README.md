install:
- ripgrep `rg`
- github cli `gh`


Give Agent It's own GitHub Account

Developer settings ▸ Personal access tokens ▸ Fine-grained tokens.

```bash
cp .claude/.env.example .claude/.env
# add your AGENT's github personal access token (with repo scope)
# add your github username
# add your github email
```

## Slash Commands

run slash command `/project:env` to get claude code to source the env variables.

run `/project:github-issue-workflow` to get claude code to create a github issue.

