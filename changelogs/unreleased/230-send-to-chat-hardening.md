---
type: fix
pr: 230
---
Validate filePath with isPathAllowed + replace shell curl with native fetch (eliminates shell injection) + check Telegram API response (return 502 on failure).
