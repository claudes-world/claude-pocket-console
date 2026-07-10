import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

let sandbox: string;
let allowedFile: string;
let openFailure: "not-found" | "denied" | "error" | undefined;

const openAllowedForReadSpy = vi.fn(async (path: string, roots: readonly string[]) => {
  if (openFailure) {
    return { ok: false as const, reason: openFailure };
  }
  const actual = await vi.importActual<typeof import("../../lib/path-allowed.js")>(
    "../../lib/path-allowed.js",
  );
  return actual.openAllowedForRead(path, roots);
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

const execFileSpy = vi.fn(
  (_command: string, _args: string[], _options: object, callback: any) => {
    callback(
      null,
      {
        stdout:
          "Published: /home/claude/shared/public/example-20260710\n" +
          "URL: https://shared.claude.do/public/example-20260710\n",
        stderr: "",
      },
    );
    return { kill: () => {} } as any;
  },
);

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    execFile: execFileSpy,
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
  openFailure = undefined;
  openAllowedForReadSpy.mockClear();
  execFileSpy.mockClear();
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
    expect(execFileSpy).not.toHaveBeenCalled();
  });

  it("returns 400 when scope is invalid", async () => {
    const { status, body } = await postPublish({ path: allowedFile, scope: "team" });

    expect(status).toBe(400);
    expect(body).toEqual({ ok: false, error: "scope must be public or private" });
    expect(execFileSpy).not.toHaveBeenCalled();
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
    expect(execFileSpy).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing allowlisted file", async () => {
    const missingPath = join(sandbox, "missing.md");

    const { status, body } = await postPublish({ path: missingPath, scope: "public" });

    expect(status).toBe(404);
    expect(body).toEqual({ ok: false, error: "file not found" });
    expect(openAllowedForReadSpy).toHaveBeenCalled();
    expect(execFileSpy).not.toHaveBeenCalled();
  });

  it("publishes a public file with the exact argv and parses stdout", async () => {
    const { status, body } = await postPublish({ path: allowedFile, scope: "public" });

    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      url: "https://shared.claude.do/public/example-20260710",
      destPath: "/home/claude/shared/public/example-20260710",
    });
    expect(execFileSpy).toHaveBeenCalledWith(
      "/home/claude/bin/publish-shared",
      ["public", expect.any(String)],
      expect.objectContaining({
        env: expect.objectContaining({
          SHARED_PUBLIC_BASE_URL: expect.any(String),
        }),
        timeout: 30_000,
      }),
      expect.any(Function),
    );
    const stagedPath = execFileSpy.mock.calls[0][1][1];
    expect(basename(stagedPath)).toBe(basename(allowedFile));
    expect(dirname(stagedPath).startsWith(join(tmpdir(), "cpc-share-"))).toBe(true);
    expect(existsSync(dirname(stagedPath))).toBe(false);
  });

  it("publishes a private temporary file with --tmp first", async () => {
    await postPublish({ path: allowedFile, scope: "private", tmp: true });

    const args = execFileSpy.mock.calls[0][1];
    expect(args.slice(0, 2)).toEqual(["--tmp", "private"]);
    expect(basename(args[2])).toBe(basename(allowedFile));
  });

  it("returns 500 when stdout has no URL line", async () => {
    execFileSpy.mockImplementationOnce(
      (_command: string, _args: string[], _options: object, callback: any) => {
        callback(null, {
          stdout: "Published: /home/claude/shared/public/example\n",
          stderr: "",
        });
        return { kill: () => {} } as any;
      },
    );

    const { status, body } = await postPublish({ path: allowedFile, scope: "public" });

    expect(status).toBe(500);
    expect(body.error).toContain("publish-shared returned no URL");
    expect(body.error).toContain("Published: /home/claude/shared/public/example");
  });

  it("cleans up the staging directory when publish-shared fails", async () => {
    execFileSpy.mockImplementationOnce(
      (_command: string, _args: string[], _options: object, callback: any) => {
        callback(new Error("publish failed"), null);
        return { kill: () => {} } as any;
      },
    );

    const { status, body } = await postPublish({
      path: allowedFile,
      scope: "public",
    });

    expect(status).toBe(500);
    expect(body).toEqual({ ok: false, error: "publish failed" });
    const stagedPath = execFileSpy.mock.calls[0][1][1];
    expect(existsSync(dirname(stagedPath))).toBe(false);
  });
});
