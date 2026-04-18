---
type: fixes
issue: 244
---
PRs tab now always visible — dropped stale `VITE_FEATURE_PR_TICKER` feature flag so the multi-repo PR dashboard (shipped in v1.11.0–v1.11.2) is reachable in prod without env wiring.
