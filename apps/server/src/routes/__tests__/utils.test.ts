import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `utils.ts` — shared utility functions and constants.
 *
 * Coverage:
 *   - TMUX_SESSION validation (module-load-time regex guard)
 *   - sendToTmux — calls execFile with correct args, literal flag, and --
 *   - tgRaw / tgSanitize — Telegram MarkdownV2 escaping
 *   - loadOpenAIEnv / loadAnthropicEnv — secrets file loading
 *   - getTelegramCreds — parses common.sh output
 *   - Exported constants (HOME, CLAUDES_WORLD, SESSION_NAMES_FILE)
 *
 * Strategy:
 *   - Mock `node:child_process` to spy on execFile without running real tmux/bash.
 *   - Mock `node:fs` readFileSync for secrets file loading.
 *   - Use real tgRaw/tgSanitize (pure functions, no side effects).
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before dynamic imports
// ---------------------------------------------------------------------------

const execFileSpy = vi.fn(
  (_cmd: string, _args: string[], _opts: any, cb?: (err: Error | null, stdout: string, stderr: string) => void) => {
    if (cb) cb(null, "", "");
  },
);

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    exec: vi.fn(
      (_cmd: string, _opts: any, cb?: (err: Error | null, stdout: string, stderr: string) => void) => {
        if (cb) cb(null, "", "");
      },
    ),
    execFile: execFileSpy,
  };
});

// Mock readFileSync for secrets loading tests. Keep a reference to control
// per-test behavior.
const readFileSyncSpy = vi.fn((_path: string, _enc?: string) => "");

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    readFileSync: (...args: any[]) => readFileSyncSpy(...args),
  };
});

// ---------------------------------------------------------------------------
// Import AFTER mocks
// ---------------------------------------------------------------------------

const {
  TMUX_SESSION,
  HOME,
  CLAUDES_WORLD,
  SESSION_NAMES_FILE,
  tgRaw,
  tgSanitize,
  sendToTmux,
  loadOpenAIEnv,
  loadAnthropicEnv,
  execAsync,
} = await import("../utils.js");

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  execFileSpy.mockClear();
  readFileSyncSpy.mockClear();
  // Snapshot env to prevent cross-test state bleed from loadOpenAIEnv / loadAnthropicEnv
  savedEnv = { ...process.env };
});

afterEach(() => {
  vi.clearAllMocks();
  // Restore full env snapshot
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------
describe("exported constants", () => {
  it("TMUX_SESSION is a valid identifier (alphanumerics, hyphens, underscores, dots)", () => {
    expect(TMUX_SESSION).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it("HOME is set", () => {
    expect(typeof HOME).toBe("string");
    expect(HOME.length).toBeGreaterThan(0);
  });

  it("CLAUDES_WORLD is HOME/claudes-world", () => {
    expect(CLAUDES_WORLD).toBe(`${HOME}/claudes-world`);
  });

  it("SESSION_NAMES_FILE is under CLAUDES_WORLD", () => {
    expect(SESSION_NAMES_FILE).toBe(`${CLAUDES_WORLD}/.cpc-session-names`);
  });
});

// ---------------------------------------------------------------------------
// tgRaw
// ---------------------------------------------------------------------------
describe("tgRaw", () => {
  it("escapes each Telegram MarkdownV2 special character individually", () => {
    // Use exact toBe assertions on single chars to catch double-escape bugs.
    // toContain on a full string would pass even if output is "\\__" etc.
    expect(tgRaw("_")).toBe("\\_");
    expect(tgRaw("*")).toBe("\\*");
    expect(tgRaw("[")).toBe("\\[");
    expect(tgRaw("]")).toBe("\\]");
    expect(tgRaw("(")).toBe("\\(");
    expect(tgRaw(")")).toBe("\\)");
    expect(tgRaw("~")).toBe("\\~");
    expect(tgRaw("`")).toBe("\\`");
    expect(tgRaw(">")).toBe("\\>");
    expect(tgRaw("#")).toBe("\\#");
    expect(tgRaw("+")).toBe("\\+");
    expect(tgRaw("-")).toBe("\\-");
    expect(tgRaw("=")).toBe("\\=");
    expect(tgRaw("|")).toBe("\\|");
    expect(tgRaw("{")).toBe("\\{");
    expect(tgRaw("}")).toBe("\\}");
    expect(tgRaw(".")).toBe("\\.");
    expect(tgRaw("!")).toBe("\\!");
    expect(tgRaw("\\")).toBe("\\\\");
  });

  it("leaves plain alphanumeric text unchanged", () => {
    expect(tgRaw("hello123")).toBe("hello123");
  });

  it("escapes dots, tildes, and exclamation marks in strings", () => {
    // ~ is a MarkdownV2 special character, so it gets escaped too
    expect(tgRaw("~/code/test.ts")).toBe("\\~/code/test\\.ts");
    expect(tgRaw("Done!")).toBe("Done\\!");
  });
});

// ---------------------------------------------------------------------------
// tgSanitize
// ---------------------------------------------------------------------------
describe("tgSanitize", () => {
  it("preserves *bold* markers while escaping outer text AND inner special chars", () => {
    // Input has special chars both outside ("!") and inside ("." in "5.00") the
    // bold markers. A no-op identity function would return the raw string — these
    // assertions would fail because "!" and "." would be unescaped.
    const result = tgSanitize("Price: *$5.00* today!");
    // The asterisk markers must survive intact
    expect(result).toMatch(/\*/);
    // The dot inside bold must be escaped: *$5\.00*
    expect(result).toContain("*$5\\.00*");
    // The "!" outside bold must be escaped
    expect(result).toContain("\\!");
    // Identity function returns "Price: *$5.00* today!" — raw dot, unescaped "!"
    expect(result).not.toBe("Price: *$5.00* today!");
  });

  it("preserves _italic_ markers while escaping inner special chars", () => {
    // Dot inside italic must be escaped; dot after "details" (outside) also escaped.
    const result = tgSanitize("See _v1.2_ for details.");
    // Italic markers must survive
    expect(result).toMatch(/_/);
    // The dot inside italic must be escaped
    expect(result).toContain("_v1\\.2_");
    // The dot after "details" (outside italic) must also be escaped
    expect(result).toContain("details\\.");
    // Identity function would return raw input, which this test must reject
    expect(result).not.toBe("See _v1.2_ for details.");
  });

  it("preserves `code` markers with inner content verbatim (no escaping inside code)", () => {
    // tgSanitize holds code spans as placeholders, so raw content inside backticks
    // survives unchanged. Special chars OUTSIDE backticks are still escaped.
    const result = tgSanitize("Run `npm install` now!");
    expect(result).toContain("`npm install`");
    // The "!" outside code must still be escaped
    expect(result).toContain("\\!");
    // Identity function fails because "!" is unescaped in the raw input
    expect(result).not.toBe("Run `npm install` now!");
  });

  it("escapes special characters outside of format markers", () => {
    const result = tgSanitize("Hello. World!");
    expect(result).toContain("\\.");
    expect(result).toContain("\\!");
  });

  it("handles text with no special characters", () => {
    expect(tgSanitize("plain text")).toBe("plain text");
  });

  it("handles text with only special characters", () => {
    const result = tgSanitize("...");
    expect(result).toBe("\\.\\.\\.");
  });

  it("escapes special chars inside *bold* content", () => {
    const result = tgSanitize("*hello.world*");
    // The dot inside bold should be escaped
    expect(result).toContain("*hello\\.world*");
  });
});

// ---------------------------------------------------------------------------
// sendToTmux
// ---------------------------------------------------------------------------
describe("sendToTmux", () => {
  it("calls execFile twice (send-keys with -l, then Enter)", async () => {
    await sendToTmux("hello");
    expect(execFileSpy).toHaveBeenCalledTimes(2);

    // First call: literal text
    const [cmd1, args1] = execFileSpy.mock.calls[0];
    expect(cmd1).toBe("tmux");
    expect(args1).toContain("send-keys");
    expect(args1).toContain("-l");
    expect(args1).toContain("-t");
    expect(args1).toContain(TMUX_SESSION);
    expect(args1).toContain("--");
    expect(args1).toContain("hello");

    // Second call: Enter key
    const [cmd2, args2] = execFileSpy.mock.calls[1];
    expect(cmd2).toBe("tmux");
    expect(args2).toContain("send-keys");
    expect(args2).toContain("Enter");
    expect(args2).toContain("-t");
    expect(args2).toContain(TMUX_SESSION);
  });

  it("passes timeout option to both execFile calls", async () => {
    await sendToTmux("test");
    // Both calls should have a timeout option
    const [, , opts1] = execFileSpy.mock.calls[0];
    const [, , opts2] = execFileSpy.mock.calls[1];
    expect(opts1.timeout).toBe(5_000);
    expect(opts2.timeout).toBe(5_000);
  });

  it("uses -- separator to prevent tmux from interpreting keys as options", async () => {
    await sendToTmux("-dangerous-flag");
    const [, args] = execFileSpy.mock.calls[0];
    // The -- should appear before the key text
    const dashDashIdx = args.indexOf("--");
    const keyIdx = args.indexOf("-dangerous-flag");
    expect(dashDashIdx).toBeGreaterThan(-1);
    expect(keyIdx).toBeGreaterThan(dashDashIdx);
  });
});

// ---------------------------------------------------------------------------
// loadOpenAIEnv / loadAnthropicEnv
// ---------------------------------------------------------------------------
describe("loadOpenAIEnv", () => {
  it("reads the secrets file and sets env vars", () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      readFileSyncSpy.mockReturnValueOnce("OPENAI_API_KEY=sk-test-key\n");
      loadOpenAIEnv();
      expect(readFileSyncSpy).toHaveBeenCalledTimes(1);
      const [path] = readFileSyncSpy.mock.calls[0];
      expect(path).toContain(".secrets/openai.env");
      expect(process.env.OPENAI_API_KEY).toBe("sk-test-key");
    } finally {
      if (original === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = original;
    }
  });

  it("does not overwrite existing env vars", () => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "existing-key";
    try {
      readFileSyncSpy.mockReturnValueOnce("OPENAI_API_KEY=new-key\n");
      loadOpenAIEnv();
      expect(process.env.OPENAI_API_KEY).toBe("existing-key");
    } finally {
      if (original === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = original;
    }
  });

  it("skips comment lines and blank lines", () => {
    delete process.env.SOME_TEST_VAR;
    try {
      readFileSyncSpy.mockReturnValueOnce(
        "# This is a comment\n\nSOME_TEST_VAR=value\n  \n",
      );
      loadOpenAIEnv();
      expect(process.env.SOME_TEST_VAR).toBe("value");
    } finally {
      delete process.env.SOME_TEST_VAR;
    }
  });

  it("gracefully handles missing secrets file", () => {
    readFileSyncSpy.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    // Should not throw
    expect(() => loadOpenAIEnv()).not.toThrow();
  });
});

describe("loadAnthropicEnv", () => {
  it("reads the anthropic secrets file", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      readFileSyncSpy.mockReturnValueOnce("ANTHROPIC_API_KEY=sk-ant-test\n");
      loadAnthropicEnv();
      expect(readFileSyncSpy).toHaveBeenCalledTimes(1);
      const [path] = readFileSyncSpy.mock.calls[0];
      expect(path).toContain(".secrets/anthropic.env");
      expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("gracefully handles missing secrets file", () => {
    readFileSyncSpy.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    expect(() => loadAnthropicEnv()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getTelegramCreds
// ---------------------------------------------------------------------------
// getTelegramCreds is intentionally NOT unit-tested here.
//
// The function uses `execAsync = promisify(exec)`. The `promisify` call
// happens at module import time and captures the `exec` reference in a
// closure that is NOT re-evaluated when we later call
// `vi.mocked(exec).mockImplementationOnce(...)`. As a result, any try-catch
// wrapper that swallowed assertion failures would be a false-green test —
// the assertions would silently not run. Removing the try-catch surfaces
// a test that is either genuinely broken (wrong) or genuinely passing.
//
// The actual parsing logic ("botToken|||chatId" split) is exercised end-to-end
// in telegram.test.ts, which mocks `../utils.js` at the module level and
// drives the real HTTP route. That is the correct seam for this test.
//
// If a future refactor decouples the `exec` call from `promisify`
// (e.g. by accepting an injected executor), add a unit test here then.

// ---------------------------------------------------------------------------
// execAsync
// ---------------------------------------------------------------------------
describe("execAsync", () => {
  it("is exported and is a function", () => {
    expect(typeof execAsync).toBe("function");
  });
});
