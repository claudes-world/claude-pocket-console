import { Hono } from "hono";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const app = new Hono();

const TMUX_SESSION = process.env.TMUX_SESSION || "claudes-world";

// Send keys to the tmux session
async function sendToTmux(keys: string) {
  await execAsync(`tmux send-keys -t ${TMUX_SESSION} "${keys}" Enter`);
}

app.post("/reload-plugins", async (c) => {
  try {
    await sendToTmux("/reload-plugins");
    return c.json({ ok: true, action: "reload-plugins" });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/git-status", async (c) => {
  try {
    const { stdout } = await execAsync("git -C /home/claude/claudes-world status --short");
    return c.json({ ok: true, output: stdout });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/send-keys", async (c) => {
  try {
    const body = await c.req.json();
    const keys = body.keys;
    if (!keys || typeof keys !== "string") {
      return c.json({ ok: false, error: "keys required" }, 400);
    }
    // Escape for tmux — use literal send-keys with -l to avoid special char issues
    await execAsync(`tmux send-keys -t ${TMUX_SESSION} -l ${JSON.stringify(keys)}`);
    await execAsync(`tmux send-keys -t ${TMUX_SESSION} Enter`);
    return c.json({ ok: true, action: "send-keys" });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

export { app as actionsRoute };
