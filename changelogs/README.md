# Changelog Fragments

Drop a `.md` file here for each PR that should appear in the next release's CHANGELOG.

## Format

```yaml
---
type: feature|fix|infrastructure|breaking
pr: 123
---
One-line description of the change.
```

The `changelog-writer` agent compiles these into `CHANGELOG.md` at release time.
Files are deleted (`git rm`) when the release PR merges.
