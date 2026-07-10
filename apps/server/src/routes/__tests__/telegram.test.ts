import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRealRootCacheForTests } from "../../lib/path-allowed.js";

/**
 * Tests for the /send-to-chat endpoint in telegram.ts.
 *
 * Covers:
 *   1. Missing filePath returns 400
 *   2. Disallowed filePath returns 403 (path validation)
 *   3. Happy path: allowed path triggers fetch to Telegram API, returns messageId
 *   4. Telegram API failure surfaces as 500 / 502
 *   5. H1 hardening (server #299): the route now validates via the race-safe
 *      openAllowedForRead (fd identity), not the old check-then-use-by-name
 *      isPathAllowed, and relays the fd-resolved realPath rather than the
 *      raw client-supplied path.
 *
 * Strategy: same sandbox-mock approach as files.test.ts / download-ticket.test.ts
 * — mock path-allowed.js to delegate openAllowedForRead to the REAL
 * implementation against a temp-dir allowlist, so the fd/realpath semantics
 * under test are the real ones, not a hand-rolled stand-in.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let sandbox: string;
let outsideDir: string;
let testAllowedRoots: string[] = [];

vi.mock("../../lib/path-allowed.js", async () => {
  const real = await vi.importActual<typeof import("../../lib/path-allowed.js")>(
    "../../lib/path-allowed.js",
  );
  return {
    ...real,
    openAllowedForRead: async (candidate: string, _ignoredAllowedRoots: string[]) => {
      return real.openAllowedForRead(candidate, testAllowedRoots);
    },
  };
});

// Mock getTelegramCreds so we don't need real secrets
vi.mock("../utils.js", async () => {
  const real = await vi.importActual<typeof import("../utils.js")>("../utils.js");
  return {
    ...real,
    getTelegramCreds: async () => ({
      botToken: "test-bot-token",
      chatId: "12345",
    }),
  };
});

// We need to mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { telegramRoute } = await import("../telegram.js");

beforeAll(() => {
  process.env.NODE_ENV = "test";
  sandbox = mkdtempSync(join(tmpdir(), "cpc-telegram-test-"));
  outsideDir = mkdtempSync(join(tmpdir(), "cpc-telegram-outside-"));
  testAllowedRoots = [sandbox];
  __resetRealRootCacheForTests();

  writeFileSync(join(sandbox, "test-file.ts"), "export const x = 1;");
  writeFileSync(join(outsideDir, "secret.txt"), "top secret");
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
  __resetRealRootCacheForTests();
});

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// POST /send-to-chat
// ---------------------------------------------------------------------------
describe("POST /send-to-chat", () => {
  it("returns 400 when filePath is missing", async () => {
    const res = await telegramRoute.request("/send-to-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("filePath required");
  });

  it("returns 403 for a disallowed filePath", async () => {
    const res = await telegramRoute.request("/send-to-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "/etc/passwd" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Access denied");
  });

  it("returns 403 for path traversal attempt", async () => {
    const res = await telegramRoute.request("/send-to-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: join(sandbox, "../../../etc/shadow") }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Access denied");
  });

  it("does not call fetch when path is disallowed", async () => {
    await telegramRoute.request("/send-to-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: join(outsideDir, "secret.txt") }),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends message via fetch and returns messageId on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 42 } }),
    });

    const filePath = join(sandbox, "test-file.ts");
    const res = await telegramRoute.request("/send-to-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; messageId: number };
    expect(body.ok).toBe(true);
    expect(body.messageId).toBe(42);

    // Verify fetch was called with the right URL and payload
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottest-bot-token/sendMessage");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    const payload = JSON.parse(opts.body);
    expect(payload.chat_id).toBe("12345");
    expect(payload.parse_mode).toBe("MarkdownV2");
    // The text should contain the (escaped) real path of the file.
    expect(payload.text).toContain("test\\-file\\.ts");
  });

  it("returns 500 when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network failure"));

    const res = await telegramRoute.request("/send-to-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: join(sandbox, "test-file.ts") }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("network failure");
  });

  it("returns 502 when Telegram returns ok:false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, description: "Bad Request: chat not found" }),
    });

    const res = await telegramRoute.request("/send-to-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: join(sandbox, "test-file.ts") }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Bad Request: chat not found");
  });

  // -------------------------------------------------------------------------
  // H1 hardening (server #299): fd-validated open/read path, not by-name
  // check-then-relay. /tmp-style world-writable roots make a by-name check
  // a deferred cross-process confused-deputy — the message names a path an
  // out-of-band Telegram-relayed agent will read later, well after this
  // request's validation window closes.
  // -------------------------------------------------------------------------
  it("relays the fd-resolved real path of a symlink, not the symlink's own name", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 7 } }),
    });

    const linkPath = join(sandbox, "alias-link.ts");
    symlinkSync(join(sandbox, "test-file.ts"), linkPath);
    try {
      const res = await telegramRoute.request("/send-to-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: linkPath }),
      });
      expect(res.status).toBe(200);

      const [, opts] = mockFetch.mock.calls[0];
      const payload = JSON.parse(opts.body);
      // The message should carry the resolved target's name, never the
      // symlink's own name — so a later swap of `alias-link.ts` can't
      // redirect what the downstream agent actually reads.
      expect(payload.text).toContain("test\\-file\\.ts");
      expect(payload.text).not.toContain("alias\\-link");
    } finally {
      rmSync(linkPath, { force: true });
    }
  });

  it("denies a symlink whose target has been swapped to point outside the allowed root", async () => {
    // Model the TOCTOU this route used to be vulnerable to: a path that
    // would pass a naive by-name check gets swapped for an escape symlink.
    // openAllowedForRead validates the OPENED fd's real identity, so the
    // swap is caught regardless of when it happens relative to any earlier
    // check.
    const racyPath = join(sandbox, "racy.txt");
    writeFileSync(racyPath, "legit content");
    try {
      // State A: legit file inside the sandbox — allowed.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 1 } }),
      });
      const okRes = await telegramRoute.request("/send-to-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: racyPath }),
      });
      expect(okRes.status).toBe(200);

      // State B: swapped for a symlink pointing outside the allowed root.
      rmSync(racyPath, { force: true });
      symlinkSync(join(outsideDir, "secret.txt"), racyPath);

      mockFetch.mockClear();
      const deniedRes = await telegramRoute.request("/send-to-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: racyPath }),
      });
      expect(deniedRes.status).toBe(403);
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      rmSync(racyPath, { force: true });
    }
  });
});
