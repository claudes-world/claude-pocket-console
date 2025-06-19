# GitHub Issue → Branch → PR Workflow

> Purpose: Provide a lightweight, token-efficient guide that LLM agents can follow to properly manage code changes using GitHub's issue-driven development workflow.

---

## Quick Reference

```
Issue → Branch → Commits → PR → Review → Merge → Close

Prefixes: feat|fix|docs|chore|refactor
Always: Reference #issue-number in commits
Never: Commit directly to main or force push shared branches
```

---

## 1. Open an Issue (the **source of truth**)

### Before Creating
```bash
# Check for existing similar issues
gh issue list --search "keywords"
gh issue list --label "bug"
```

### Create Issue

**Title Format:**  
`<type>: <short verb-phrase>` (≤ 60 chars, lowercase after prefix)

**Types:**
- `feat:` - New capability or feature
- `fix:` - Bug fix in production code  
- `refactor:` - Code improvement without behavior change
- `docs:` - Documentation only changes
- `chore:` - Build, tooling, or dependency updates

**Template:**
```md
### Problem
_One paragraph. Plain language. Link to logs/design/docs._

### Goal / Definition of Done
- [ ] Specific measurable outcome
- [ ] Another verifiable goal

### Proposed Approach
_Brief outline or "TBD" if exploring_

### Context/Links
- Related issues: #XX, #YY
- Design doc: [link]
- Discussion: [link]
```

**Command:**
```bash
gh issue create --title "feat: add user authentication" --body "$(cat issue-body.md)"
```

### Post-Creation
- Add labels: `type/feature`, `area/auth`, `priority/high`
- Add to project board if applicable
- Assign milestone for release tracking

---

## 2. Create a Branch

```bash
# Always branch from up-to-date main
git checkout main
git pull origin main

# Create feature branch
git checkout -b <prefix>/<issue-number>-<kebab-description>

# Examples:
# feat/42-user-auth-flow
# fix/108-memory-leak
# docs/92-api-reference
```

---

## 3. Commit Guidelines

### Rules
- Atomic commits: ≤ 100 LOC or one logical change
- Reference issue number in every commit
- Use conventional commit format

### Format
```
<type>(#<issue>): <imperative summary ≤ 50 chars>

<optional body explaining WHY, not HOW>
<wrap at 72 chars>

<optional footer with breaking changes or refs>
```

### Examples

**✅ Good:**
```
feat(#42): add GitHub OAuth provider

Implements OAuth2 flow with GitHub as identity provider.
Stores tokens securely in encrypted session storage.

Co-authored-by: TeamMember <email>
```

**❌ Bad:**
```
feat: updated files              # Too vague
feat(#42): big auth changes      # Not specific
Added authentication             # Missing type and issue
```

---

## 4. Pull Request Process

### Create PR Early
```bash
# Create draft PR immediately after first commit
gh pr create --draft \
  --title "feat: add user authentication" \
  --body "$(cat pr-template.md)" \
  --base main
```

### PR Template
```md
Resolves #<issue-number>

## Summary
_One paragraph overview of what and why_

## Changes
- Implemented OAuth2 flow with GitHub provider
- Added session management with JWT tokens
- Created auth middleware for protected routes

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests pass
- [ ] Manual testing completed

## Verification Steps
1. Run `pnpm dev`
2. Navigate to /login
3. Click "Sign in with GitHub"
4. Verify redirect and session creation

## Screenshots/Recordings
_If UI changes_

## Performance Impact
_If relevant: benchmarks, load tests_

## Notes
- Decided against Passport.js due to bundle size
- JWT expiry set to 24h per security review
```

### PR Management
```bash
# Convert to ready when done
gh pr ready <number>

# Link to project
gh pr edit <number> --add-project "Q4 Goals"

# Request reviews
gh pr edit <number> --add-reviewer @teammate
```

---

## 5. Review Response Pattern

When responding to review comments:

```md
### Response to Review Comments

> @reviewer: "Why not use refresh tokens?"

Good point. Added refresh token support in commit abc123. 
Tokens now rotate every 7 days with 30-day absolute expiry.

> @reviewer: "Performance concern with N+1 queries"

Fixed by adding eager loading. Benchmarks show 65% reduction
in query time. See performance-test.md for details.
```

---

## 6. Keep Context Alive

### For Long-Running Issues

Add periodic updates to the issue:

```md
### Status Update (2024-01-15)

**Progress:**
- ✅ OAuth flow implemented
- ✅ Session management complete
- 🏗️ Working on role-based permissions

**Blockers:**
- Waiting on security review for JWT implementation

**Next Steps:**
- Complete RBAC implementation
- Add comprehensive test suite
```

### In PRs
- Push commits regularly (triggers CI)
- Comment on significant decisions
- Link to discussions: `See discussion in #42 (comment)`
- Keep commits organized for potential rebase

---

## 7. Merge Strategy

### Pre-Merge Checklist
```bash
# Update branch
git checkout feat/42-auth
git rebase main

# Verify CI status
gh pr checks <number>

# Check review status
gh pr view <number>
```

### Merge Decision Tree
- Single commit or clear story? → **Rebase and merge**
- Multiple messy commits? → **Squash and merge**
- Multiple important commits? → **Create merge commit**

### Post-Merge
```bash
# Delete remote branch (usually automatic)
git push origin --delete feat/42-auth

# Delete local branch
git branch -d feat/42-auth
```

---

## 8. Close the Loop

GitHub auto-closes issue when PR merges with `Resolves #X`.

Add final summary to issue:
```md
### Completed in #<PR-number>

✅ All acceptance criteria met
📝 Documentation updated
🚀 Will be included in v2.1.0 release

Follow-up tasks:
- #95 Add rate limiting to auth endpoints
- #96 Implement social login providers
```

---

## Common Pitfalls to Avoid

| ❌ Don't | ✅ Do Instead |
|----------|---------------|
| Include secrets in commits | Use environment variables |
| Force push shared branches | Use rebase locally only |
| Create huge PRs | Break into smaller chunks |
| Ignore CI failures | Fix before requesting review |
| Use vague commit messages | Be specific and reference issues |
| Work on main directly | Always use feature branches |
| Mix multiple fixes in one PR | One issue = one PR |

---

## Automation Tips

### GitHub CLI Aliases
```bash
# Add to shell config
alias ghi="gh issue create"
alias ghpr="gh pr create --draft"
alias ghis="gh issue status"
```

### Useful Queries
```bash
# My open issues
gh issue list --assignee @me --state open

# PRs needing my review
gh pr list --reviewer @me

# Recent merged PRs
gh pr list --state merged --limit 10
```

---

## TL;DR for LLM Agents

1. **Always start with an issue** - It's your source of truth
2. **One issue = one branch = one PR** - Keep changes focused
3. **Reference issue numbers** - In branch names, commits, and PRs
4. **Commit early and often** - Small, atomic changes
5. **Keep discussions in issues/PRs** - Not in code comments
6. **Follow conventional commits** - For automatic changelog generation
7. **Close the loop** - Update issue when PR merges with outcome

Remember: The issue tells the story, commits show the journey, PR demonstrates the solution.