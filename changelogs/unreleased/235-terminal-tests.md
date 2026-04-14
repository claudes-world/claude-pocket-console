---
type: infrastructure
pr: 235
---

Add Terminal component test suite (22 tests). Covers WebSocket URL construction, auth fallback chain (Telegram initData → URL param → localStorage), connection state callbacks, xterm initialization, message handling (dimensions/pane/raw), and cleanup on unmount. Establishes the WebSocket mock pattern for the codebase.
