install:
- ripgrep `rg`
- github cli `gh`


Give Agent It's own GitHub Account

Settings ▸ Developer settings ▸ Personal access tokens ▸ Fine-grained tokens.

```bash
cp .claude/settings.local.json.example .claude/settings.local.json
# or update the env seciion in settings.local.json
# add your AGENT's github personal access token (with repo scope)
# add your github username
# add your github email
```

run `/project:github-issue-workflow` to get claude code to create a github issue.

