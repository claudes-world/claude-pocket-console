# Code Blocks And Commands

Inline code such as `getAuthHeaders()` and `Telegram.WebApp.disableVerticalSwipes()`
appears beside fenced examples in CPC docs.

```ts
type SessionStatus = "connected" | "paused" | "failed";

export function labelForStatus(status: SessionStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "paused":
      return "Paused";
    case "failed":
      return "Needs attention";
  }
}
```

```bash
cd /home/claude/code/cpc-impl-react-markdown
pnpm install --silent
pnpm --filter @cpc/web exec tsc -b
pnpm --filter @cpc/web test
```

```json
{
  "server": {
    "port": 38830,
    "prodTunnel": "https://cpc.claude.do",
    "devTunnel": "https://cpc-dev.claude.do"
  },
  "features": ["files", "terminal", "voice"]
}
```

An unlabelled block still matters:

```
Actions -> Develop -> Voice
```

The paragraph after code must resume normal wrapping and link handling.

