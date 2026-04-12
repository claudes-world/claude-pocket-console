/**
 * Canonical list of origins allowed to connect to the CPC server.
 *
 * Used by:
 *  - Hono cors() middleware (HTTP requests)
 *  - WebSocket upgrade Origin validation (terminal-ws.ts)
 *
 * Keep in sync: both consumers import this constant so there is a single
 * source of truth. Adding an origin here covers both HTTP CORS and WS.
 */
export const ALLOWED_ORIGINS: readonly string[] = [
  "https://web.telegram.org",
  "https://cpc.claude.do",
  "https://cpc-dev.claude.do",
  "http://localhost:5173",
  "http://localhost:58830",
];
