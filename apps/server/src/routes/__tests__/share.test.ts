import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let sandbox: string;
let allowedFile: string;
let pathAllowed = true;

const isPathAllowedSpy = vi.fn(async () => pathAllowed);

vi.mock("../../lib/path-allowed.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/path-allowed.js")>(
    "../../lib/path-allowed.js",
  );
  return {
    ...actual,
    isPathAllowed: isPathAllowedSpy,
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
  pathAllowed = true;
  isPathAllowedSpy.mockClear();
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
    pathAllowed = false;

    const { status, body } = await postPublish({ path: allowedFile, scope: "public" });

    expect(status).toBe(403);
    expect(body).toEqual({ ok: false, error: "path not allowed" });
    expect(isPathAllowedSpy).toHaveBeenCalledWith(resolve(allowedFile), expect.any(Array));
    expect(execFileSpy).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing allowlisted file", async () => {
    const missingPath = join(sandbox, "missing.md");

    const { status, body } = await postPublish({ path: missingPath, scope: "public" });

    expect(status).toBe(404);
    expect(body).toEqual({ ok: false, error: "file not found" });
    expect(isPathAllowedSpy).toHaveBeenCalled();
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
      ["public", resolve(allowedFile)],
      expect.objectContaining({
        env: expect.objectContaining({
          SHARED_PUBLIC_BASE_URL: expect.any(String),
        }),
        timeout: 30_000,
      }),
      expect.any(Function),
    );
  });

  it("publishes a private temporary file with --tmp first", async () => {
    await postPublish({ path: allowedFile, scope: "private", tmp: true });

    expect(execFileSpy.mock.calls[0][1]).toEqual([
      "--tmp",
      "private",
      resolve(allowedFile),
    ]);
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
});
