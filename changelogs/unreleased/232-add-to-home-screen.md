---
type: feature
pr: 232
issue: 222
---

Add-to-home-screen prompt on first CPC launch. Uses Telegram Bot API 8.0+ `addToHomeScreen()` to offer a native shortcut after a 3-second delay. Prompt is shown at most once (suppressed via `localStorage`). Silently skipped on older Telegram clients that lack the API.
