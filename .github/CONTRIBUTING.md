# Contributing to Claude Pocket Console

Thank you for your interest in contributing! This guide will help you get started with contributing to Claude Pocket Console.

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [How to Contribute](#how-to-contribute)
3. [Development Process](#development-process)
4. [Coding Standards](#coding-standards)
5. [Testing Requirements](#testing-requirements)
6. [Pull Request Process](#pull-request-process)
7. [Release Process](#release-process)
8. [Getting Help](#getting-help)

---

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you are expected to uphold this code. Please report unacceptable behavior to [conduct@claude-console.app].

## How to Contribute

### = Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When creating a bug report, include:

- **Clear title and description**
- **Steps to reproduce**
- **Expected vs actual behavior**
- **Environment details** (OS, browser, versions)
- **Screenshots** if applicable
- **Error messages** and logs

### =� Suggesting Features

Feature requests are welcome! Please provide:

- **Use case** - Why is this needed?
- **Proposed solution** - How should it work?
- **Alternatives considered**
- **Additional context** - Mockups, examples

### =� Improving Documentation

Documentation improvements are always welcome:

- Fix typos and grammar
- Improve clarity and examples
- Add missing information
- Translate documentation

---

## Development Process

### 1. Git Workflow

We use a GitHub Flow-based workflow:

```
main (stable)
     feature/issue-123-description
     fix/issue-456-description
     docs/improve-readme
```

### 2. Branch Naming

Use descriptive branch names with issue numbers:

| Type | Pattern | Example |
| --- | --- | --- |
| Feature | `feature/<issue>-<description>` | `feature/42-add-auth` |
| Bug Fix | `fix/<issue>-<description>` | `fix/108-memory-leak` |
| Docs | `docs/<description>` | `docs/api-examples` |
| Refactor | `refactor/<description>` | `refactor/extract-utils` |
| Test | `test/<description>` | `test/websocket-coverage` |

### 3. Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting, missing semicolons, etc.
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding missing tests
- `chore`: Updating build tasks, package manager configs, etc.

**Examples:**
```bash
feat(web): add dark mode toggle

Implements theme switching with system preference detection.
Stores user preference in localStorage.

Closes #123
```

```bash
fix(terminal): prevent memory leak in WebSocket handler

Clear reconnection timeout on component unmount to prevent
memory leaks when navigating away from terminal page.

Fixes #456
```

---

## Coding Standards

### TypeScript/JavaScript

We use ESLint and Prettier for consistent code style:

```bash
# Check linting
pnpm lint

# Auto-fix issues
pnpm lint:fix

# Format code
pnpm format
```

**Key Guidelines:**
- Use TypeScript for all new code
- Prefer functional components with hooks
- Use explicit types (avoid `any`)
- Keep components small and focused
- Extract reusable logic to custom hooks

**Example:**
```typescript
//  Good
interface TerminalProps {
  sessionId: string;
  onClose: () => void;
}

export function Terminal({ sessionId, onClose }: TerminalProps) {
  const { socket, isConnected } = useWebSocket(sessionId);
  // ...
}

// L Avoid
export function Terminal(props: any) {
  // ...
}
```

### Python

We use Ruff for Python linting and Black for formatting:

```bash
# Check linting
pnpm --filter terminal-server lint

# Format code
pnpm --filter terminal-server format
```

**Key Guidelines:**
- Follow PEP 8
- Use type hints for all functions
- Write docstrings for public APIs
- Keep functions small and testable

**Example:**
```python
#  Good
from typing import Dict, Optional

async def create_session(user_id: str) -> Dict[str, str]:
    """Create a new terminal session for the user.
    
    Args:
        user_id: The ID of the user requesting the session
        
    Returns:
        Dictionary containing session_id and container_id
        
    Raises:
        SessionLimitError: If user has too many active sessions
    """
    # Implementation
```

### CSS/Styling

- Use Tailwind CSS utility classes
- Avoid custom CSS unless necessary
- Follow mobile-first responsive design
- Use CSS variables for theme values

---

## Testing Requirements

### Test Coverage

We aim for high test coverage:

| Type | Target | Current |
| --- | --- | --- |
| Unit Tests | 80% | ![Coverage](https://img.shields.io/badge/coverage-80%25-green) |
| Integration | Critical paths |  |
| E2E | User journeys |  |

### Running Tests

```bash
# Run all tests
pnpm test

# Run specific service tests
pnpm --filter web test
pnpm --filter terminal-server test

# Run in watch mode
pnpm test:watch

# Generate coverage report
pnpm test:coverage
```

### Writing Tests

**Frontend (Vitest + React Testing Library):**
```typescript
describe('Terminal', () => {
  it('should connect to WebSocket on mount', async () => {
    const { getByTestId } = render(
      <Terminal sessionId="test-123" />
    );
    
    await waitFor(() => {
      expect(getByTestId('connection-status')).toHaveTextContent('Connected');
    });
  });
});
```

**Backend (Pytest):**
```python
@pytest.mark.asyncio
async def test_create_session(client: TestClient, mock_docker):
    response = await client.post(
        "/api/v1/sessions",
        json={"user_id": "test-user"}
    )
    assert response.status_code == 200
    assert "session_id" in response.json()
```

---

## Pull Request Process

### Before Submitting

- [ ] Create an issue first (unless trivial fix)
- [ ] Branch from latest `main`
- [ ] Follow coding standards
- [ ] Add/update tests
- [ ] Update documentation
- [ ] Run `pnpm checks` locally

### PR Template

```markdown
## Description
Brief description of changes

Closes #<issue-number>

## Type of Change
- [ ] Bug fix (non-breaking change)
- [ ] New feature (non-breaking change)
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] No new warnings
```

### Review Process

1. **Automated Checks** - CI must pass
2. **Code Review** - At least 1 approval required
3. **Testing** - Reviewer should test locally if possible
4. **Feedback** - Address review comments
5. **Merge** - Squash and merge to maintain clean history

### Response Time

- First review: Within 48 hours
- Follow-up reviews: Within 24 hours
- Critical fixes: ASAP

---

## Release Process

### Version Numbering

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR.MINOR.PATCH** (e.g., 2.1.3)
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes

### Release Checklist

1. [ ] All PRs for release merged
2. [ ] Update CHANGELOG.md
3. [ ] Update version in package.json files
4. [ ] Create release PR
5. [ ] Run full test suite
6. [ ] Tag release: `git tag -a v2.1.3 -m "Release v2.1.3"`
7. [ ] Push tag: `git push origin v2.1.3`
8. [ ] Create GitHub Release
9. [ ] Deploy to production
10. [ ] Announce release

---

## Getting Help

### Resources

- **Documentation**: [docs/](../docs/)
- **Discord**: [Join our community](https://discord.gg/claude-console)
- **Discussions**: [GitHub Discussions](https://github.com/org/claude-pocket-console/discussions)
- **Stack Overflow**: Tag with `claude-console`

### Core Team

- **Project Lead**: @projectlead
- **Frontend**: @frontend-lead
- **Backend**: @backend-lead
- **DevOps**: @devops-lead

### Office Hours

- **When**: Thursdays 2-3 PM UTC
- **Where**: Discord #office-hours channel
- **What**: Live Q&A, PR reviews, architecture discussions

Thank you for contributing to Claude Pocket Console! <�