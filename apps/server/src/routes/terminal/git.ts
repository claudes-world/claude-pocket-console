import { Hono } from "hono";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { execAsync } from "../utils.js";
import {
  ALLOWED_FILE_ROOTS,
  isPathAllowed as isPathAllowedShared,
} from "../../lib/path-allowed.js";

const execFileAsync = promisify(execFile);


function isPathAllowed(absPath: string): Promise<boolean> {
  return isPathAllowedShared(absPath, ALLOWED_FILE_ROOTS);
}

const app = new Hono();

app.post("/git-status", async (c) => {
  try {
    const { stdout } = await execAsync("git -C /home/claude/claudes-world status --short");
    return c.json({ ok: true, output: stdout });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// GET version for bottom sheet fetch
app.get("/git-status", async (c) => {
  try {
    const { stdout } = await execAsync("git -C /home/claude/claudes-world status --short");
    return c.json({ ok: true, output: stdout || "(clean)" });
  } catch (err: any) {
    return c.json({ ok: false, output: err.message });
  }
});

app.post("/git-command", async (c) => {
  try {
    const body = await c.req.json();
    const command = body.command as string;
    if (!command) return c.json({ ok: false, error: "command required" }, 400);

    let cmd: string;
    switch (command) {
      case "branch":
        cmd = "git -C /home/claude/claudes-world branch --show-current";
        break;
      case "log":
        cmd = "git -C /home/claude/claudes-world log --oneline -10";
        break;
      case "pull":
        cmd = "git -C /home/claude/claudes-world pull";
        break;
      case "status":
        cmd = "git -C /home/claude/claudes-world status --short";
        break;
      default:
        return c.json({ ok: false, error: "unknown command" }, 400);
    }

    const { stdout, stderr } = await execAsync(cmd);
    return c.json({ ok: true, output: stdout || stderr || "(no output)" });
  } catch (err: any) {
    return c.json({ ok: false, output: err.message });
  }
});

app.get("/git-branch", async (c) => {
  try {
    // Get current branch
    const { stdout: branch } = await execAsync("git -C /home/claude/claudes-world rev-parse --abbrev-ref HEAD");

    // Check if this is a worktree or main tree
    const { stdout: gitDir } = await execAsync("git -C /home/claude/claudes-world rev-parse --git-dir");
    const isWorktree = gitDir.trim().includes("/worktrees/");

    return c.json({
      ok: true,
      branch: branch.trim(),
      isWorktree,
      treeType: isWorktree ? "linked tree" : "main tree",
    });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get("/cpc-branch", async (c) => {
  try {
    const cpcDir = join(process.env.HOME || "/home/claude", "code/claude-pocket-console");
    const { stdout: branch } = await execAsync(`git -C ${cpcDir} rev-parse --abbrev-ref HEAD`);
    return c.json({ ok: true, branch: branch.trim() });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get("/dir-branch", async (c) => {
  try {
    const dir = c.req.query("path");
    if (!dir) return c.json({ ok: false, error: "path required" }, 400);

    // Resolve the user-supplied path and verify it sits under an allowed
    // root BEFORE shelling out. Previous implementation interpolated `dir`
    // into a `git -C "${dir}" ...` shell string, so a path like
    // `a"; curl evil; "` broke out of the quotes and executed arbitrary
    // commands as the claude user. The fix switches to execFile (argv, no
    // shell) AND requires the path to live under ALLOWED_FILE_ROOTS so the
    // endpoint can never point git at /etc, /root, or a sibling-prefix dir.
    const absDir = resolve(dir);
    if (!(await isPathAllowed(absDir))) {
      return c.json({ ok: false, error: "path not allowed" }, 403);
    }

    const { stdout: branch } = await execFileAsync("git", [
      "-C",
      absDir,
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    const { stdout: gitDir } = await execFileAsync("git", [
      "-C",
      absDir,
      "rev-parse",
      "--git-dir",
    ]);
    const isWorktree = gitDir.trim().includes("/worktrees/");
    let mainTreePath: string | null = null;
    if (isWorktree) {
      try {
        const { stdout: commonDir } = await execFileAsync("git", [
          "-C",
          absDir,
          "rev-parse",
          "--git-common-dir",
        ]);
        // common dir points to the main .git dir; the repo root is one level up
        const parentOfCommon = resolve(commonDir.trim(), "..");
        // Re-check allowlist for the derived path — a malicious symlink in
        // the git common-dir walk could otherwise point anywhere.
        if (await isPathAllowed(parentOfCommon)) {
          const { stdout: mainRoot } = await execFileAsync("git", [
            "-C",
            parentOfCommon,
            "rev-parse",
            "--show-toplevel",
          ]);
          mainTreePath = mainRoot.trim().replace(/^\/home\/claude\//, "~/");
        }
      } catch { /* silent */ }
    }
    return c.json({
      ok: true,
      branch: branch.trim(),
      isWorktree,
      treeType: isWorktree ? "linked tree" : "main tree",
      mainTreePath,
    });
  } catch {
    return c.json({ ok: true, branch: null });
  }
});

export { app as gitRoute };
