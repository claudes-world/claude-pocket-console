import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Tests for `GET /api/session/names` — S-3 fix.
 *
 * Previously the route caught every error (including JSON.parse failures from
 * a corrupted / partially-written session-names file) and silently returned
 * `{ ok: true, names: [] }`. Clients had no way to tell "no history yet"
 * apart from "history file is broken", which hid at least one partial-write
 * bug for weeks. The fix logs the error and returns 500 with a structured
 * error code.
 *
 * Strategy:
 *   - Mock `./utils.js` so SESSION_NAMES_FILE points at a temp-dir path the
 *     test controls. Every other export from utils.js is preserved via
 *     vi.importActual so unrelated routes keep working.
 *   - Use real fs calls to write/corrupt the file; no need to mock node:fs.
 *   - Drive the route via Hono `app.request()`.
 */

let sandbox: string;
let namesFile: string;

vi.mock("../utils.js", async () => {
  const actual = await vi.importActual<typeof import("../utils.js")>("../utils.js");
  return {
    ...actual,
    get SESSION_NAMES_FILE() {
      return namesFile;
    },
  };
});

const { sessionRoute } = await import("../session.js");

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "cpc-session-test-"));
  namesFile = join(sandbox, ".cpc-session-names");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
  vi.clearAllMocks();
});

async function getNames() {
  const res = await sessionRoute.request("/names");
  const body = (await res.json()) as {
    ok: boolean;
    names?: Array<{ name: string; ts: number }>;
    error?: string;
    message?: string;
  };
  return { status: res.status, body };
}

describe("GET /names error handling (S-3)", () => {
  it("returns ok:true, names:[] when the file does not exist (no history yet)", async () => {
    // Missing file is still the "empty history" case, not an error.
    const { status, body } = await getNames();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.names).toEqual([]);
  });

  it("returns the stored list when the file contains valid JSON", async () => {
    const stored = [
      { name: "session-one", ts: 1_700_000_000_000 },
      { name: "session-two", ts: 1_700_000_001_000 },
    ];
    writeFileSync(namesFile, JSON.stringify(stored));
    const { status, body } = await getNames();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.names).toEqual(stored);
  });

  it("returns 500 with a structured error when the file is corrupted JSON", async () => {
    // This is the exact case the old implementation swallowed: partial write
    // leaves `[{"name":"x","ts":` in the file, JSON.parse throws, and the
    // client would previously have seen `{ok:true, names:[]}` — losing all
    // signal that the file is broken. The new implementation must return 500.
    writeFileSync(namesFile, '[{"name":"x","ts":');
    const { status, body } = await getNames();
    expect(status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("session_names_read_failed");
    // A human-readable message field should also be present.
    expect(typeof body.message).toBe("string");
    expect(body.message!.length).toBeGreaterThan(0);
  });

  it("returns 500 when the file contains something that isn't JSON at all", async () => {
    writeFileSync(namesFile, "this is not json");
    const { status, body } = await getNames();
    expect(status).toBe(500);
    expect(body.error).toBe("session_names_read_failed");
  });

  it("returns 500 when the file path points at a directory (readFileSync throws EISDIR)", async () => {
    // Create a directory at the path so readFileSync rejects with EISDIR.
    // Previously this would also be swallowed as an empty list.
    mkdirSync(namesFile, { recursive: true });
    const { status, body } = await getNames();
    expect(status).toBe(500);
    expect(body.ok).toBe(false);
    // Clean up the directory so afterEach's rmSync doesn't hit a permissions
    // quirk on the dir-vs-file shape.
    rmSync(namesFile, { recursive: true, force: true });
  });
});
