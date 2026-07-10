import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  constants,
  existsSync,
  fstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
  promises as fs,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

let sandbox: string;
let allowedFile: string;
let openFailure: "not-found" | "denied" | "error" | undefined;
let statOverride: { isFile: () => boolean; size: number } | undefined;
let publishedContent: string | undefined;
let publishedFd: number | undefined;
let stagedPath: string | undefined;
let spawnFailure: Error | undefined;
let spawnStdout: string;
const handleCloseSpies: Array<ReturnType<typeof vi.fn>> = [];
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let fsOpenSpy: ReturnType<typeof vi.spyOn>;

function capturePublishedFile(options: any) {
  publishedFd = options.stdio[3];
  stagedPath = readlinkSync(`/proc/self/fd/${publishedFd}`);
  publishedContent = readFileSync(`/proc/self/fd/${publishedFd}`, "utf8");
}

const openAllowedForReadSpy = vi.fn(async (path: string, roots: readonly string[]) => {
  if (openFailure) {
    return { ok: false as const, reason: openFailure };
  }
  const actual = await vi.importActual<typeof import("../../lib/path-allowed.js")>(
    "../../lib/path-allowed.js",
  );
  const opened = await actual.openAllowedForRead(path, roots);
  if (!opened.ok) return opened;

  const closeSpy = vi.fn(() => opened.handle.close());
  handleCloseSpies.push(closeSpy);
  return {
    ...opened,
    handle: {
      stat: () => statOverride ? Promise.resolve(statOverride) : opened.handle.stat(),
      createReadStream: (options: any) => opened.handle.createReadStream(options),
      close: closeSpy,
    } as any,
  };
});

vi.mock("../../lib/path-allowed.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/path-allowed.js")>(
    "../../lib/path-allowed.js",
  );
  return {
    ...actual,
    openAllowedForRead: openAllowedForReadSpy,
  };
});

const spawnSpy = vi.fn(
  (_command: string, _args: string[], _options: any) => {
    capturePublishedFile(_options);
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    queueMicrotask(() => {
      if (spawnFailure) {
        child.emit("error", spawnFailure);
        return;
      }
      child.stdout.end(spawnStdout);
      child.stderr.end();
      child.emit("close", 0, null);
    });
    return child;
  },
);

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    spawn: spawnSpy,
  };
});

const { shareRoute } = await import("../share.js");

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "cpc-share-test-"));
  allowedFile = join(sandbox, "example.md");
  writeFileSync(allowedFile, "# Example\n");
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 6, 10, 12, 34, 56));
  openFailure = undefined;
  statOverride = undefined;
  publishedContent = undefined;
  publishedFd = undefined;
  stagedPath = undefined;
  spawnFailure = undefined;
  spawnStdout =
    "Published: /home/claude/shared/public/example-20260710\n" +
    "URL: https://shared.claude.do/public/example-20260710\n";
  handleCloseSpies.length = 0;
  openAllowedForReadSpy.mockClear();
  spawnSpy.mockClear();
  fsOpenSpy = vi.spyOn(fs, "open");
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  fsOpenSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

async function postPublish(body: unknown) {
  const res = await shareRoute.request("/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as {
      ok: boolean;
      error?: string;
      url?: string;
      destPath?: string;
    },
  };
}

describe("POST /publish", () => {
  it("returns 400 when path is missing", async () => {
    const { status, body } = await postPublish({ scope: "public" });

    expect(status).toBe(400);
    expect(body).toEqual({ ok: false, error: "path required" });
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("returns 400 when scope is invalid", async () => {
    const { status, body } = await postPublish({ path: allowedFile, scope: "team" });

    expect(status).toBe(400);
    expect(body).toEqual({ ok: false, error: "scope must be public or private" });
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("returns 403 when the resolved path is disallowed", async () => {
    openFailure = "denied";

    const { status, body } = await postPublish({ path: allowedFile, scope: "public" });

    expect(status).toBe(403);
    expect(body).toEqual({ ok: false, error: "path not allowed" });
    expect(openAllowedForReadSpy).toHaveBeenCalledWith(
      resolve(allowedFile),
      expect.any(Array),
    );
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing allowlisted file", async () => {
    const missingPath = join(sandbox, "missing.md");

    const { status, body } = await postPublish({ path: missingPath, scope: "public" });

    expect(status).toBe(404);
    expect(body).toEqual({ ok: false, error: "file not found" });
    expect(openAllowedForReadSpy).toHaveBeenCalled();
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("publishes a public file with the exact argv and parses stdout", async () => {
    const { status, body } = await postPublish({ path: allowedFile, scope: "public" });

    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      url: "https://shared.claude.do/public/example-20260710",
      destPath: "/home/claude/shared/public/example-20260710",
    });
    expect(spawnSpy).toHaveBeenCalledWith(
      "/home/claude/bin/publish-shared",
      ["public", "/dev/fd/3", "example-20260710-123456"],
      expect.objectContaining({
        env: expect.objectContaining({
          SHARED_PUBLIC_BASE_URL: expect.any(String),
        }),
        stdio: ["ignore", "pipe", "pipe", expect.any(Number)],
      }),
    );
    expect(publishedContent).toBe("# Example\n");
    const stagedOpenCalls = fsOpenSpy.mock.calls.filter(
      ([path]) => path === stagedPath,
    );
    expect(stagedOpenCalls).toEqual([[
      stagedPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
      0o600,
    ]]);
    expect(handleCloseSpies).toHaveLength(1);
    expect(handleCloseSpies[0]).toHaveBeenCalledTimes(1);
    expect(basename(stagedPath!)).toBe(basename(allowedFile));
    expect(dirname(stagedPath!).startsWith(join(tmpdir(), "cpc-share-"))).toBe(true);
    expect(existsSync(dirname(stagedPath!))).toBe(false);
    expect(() => fstatSync(publishedFd!)).toThrow();
  });

  it("publishes a private temporary file with --tmp first", async () => {
    await postPublish({ path: allowedFile, scope: "private", tmp: true });

    const args = spawnSpy.mock.calls[0][1];
    expect(args.slice(0, 2)).toEqual(["--tmp", "private"]);
    expect(args[2]).toBe("/dev/fd/3");
    expect(args[3]).toBe("example-20260710-123456");
  });

  it("preserves a raw media extension in the explicit slug", async () => {
    const mediaFile = join(sandbox, "sample.OGG");
    writeFileSync(mediaFile, "audio bytes");

    await postPublish({ path: mediaFile, scope: "public" });

    expect(spawnSpy.mock.calls[0][1]).toEqual([
      "public",
      "/dev/fd/3",
      "sample-20260710-123456.OGG",
    ]);
    expect(publishedContent).toBe("audio bytes");
  });

  it("preserves a raw media extension when the stem contains a dot", async () => {
    const mediaFile = join(sandbox, "audio.master.wav");
    writeFileSync(mediaFile, "audio bytes");

    await postPublish({ path: mediaFile, scope: "public" });

    expect(spawnSpy.mock.calls[0][1][2]).toBe(
      "audio.master-20260710-123456.wav",
    );
  });

  it("rejects a non-regular file and closes its pinned handle", async () => {
    statOverride = { isFile: () => false, size: 0 };

    const { status, body } = await postPublish({ path: allowedFile, scope: "public" });

    expect(status).toBe(400);
    expect(body).toEqual({ ok: false, error: "not a regular file" });
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(handleCloseSpies[0]).toHaveBeenCalledTimes(1);
  });

  it("rejects a file over 50 MB and closes its pinned handle", async () => {
    statOverride = { isFile: () => true, size: 50 * 1024 * 1024 + 1 };

    const { status, body } = await postPublish({ path: allowedFile, scope: "public" });

    expect(status).toBe(413);
    expect(body).toEqual({ ok: false, error: "file too large" });
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(handleCloseSpies[0]).toHaveBeenCalledTimes(1);
  });

  it("returns a generic 500 when stdout has no URL line", async () => {
    spawnStdout = "Published: /home/claude/shared/public/example\n";

    const { status, body } = await postPublish({ path: allowedFile, scope: "public" });

    expect(status).toBe(500);
    expect(body).toEqual({ ok: false, error: "publish failed" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "publish-shared returned no URL",
      { stdoutTail: "Published: /home/claude/shared/public/example" },
    );
  });

  it("hides process details and closes the handle when publish-shared fails", async () => {
    spawnFailure = new Error("spawn /home/claude/bin/publish-shared: secret stderr");

    const { status, body } = await postPublish({
      path: allowedFile,
      scope: "public",
    });

    expect(status).toBe(500);
    expect(body).toEqual({ ok: false, error: "publish failed" });
    expect(body.error).not.toContain("/home/claude/bin");
    expect(body.error).not.toContain("secret stderr");
    expect(handleCloseSpies).toHaveLength(1);
    expect(handleCloseSpies[0]).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to publish shared file:",
      expect.any(Error),
    );
    expect(existsSync(dirname(stagedPath!))).toBe(false);
    expect(() => fstatSync(publishedFd!)).toThrow();
  });
});
