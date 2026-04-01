import { Hono } from "hono";
import { execAsync, sendToTmux, TMUX_SESSION } from "../utils.js";

const app = new Hono();

app.post("/send-keys", async (c) => {
  try {
    const body = await c.req.json();
    const keys = body.keys;
    if (!keys || typeof keys !== "string") {
      return c.json({ ok: false, error: "keys required" }, 400);
    }
    if (body.raw) {
      // Raw tmux key names (Escape, BTab, etc.) — no -l flag, no Enter
      await execAsync(`tmux send-keys -t ${TMUX_SESSION} ${keys}`);
    } else {
      // Literal text — use -l to avoid special char issues, then Enter
      await execAsync(`tmux send-keys -t ${TMUX_SESSION} -l ${JSON.stringify(keys)}`);
      await execAsync(`tmux send-keys -t ${TMUX_SESSION} Enter`);
    }
    return c.json({ ok: true, action: "send-keys" });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/compact", async (c) => {
  try {
    const body = await c.req.json();
    const message = body.message as string;
    if (!message) return c.json({ ok: false, error: "message required" }, 400);

    // Send via tmux send-keys
    await execAsync(`tmux send-keys -t ${TMUX_SESSION} -l ${JSON.stringify(message)}`);
    await execAsync(`tmux send-keys -t ${TMUX_SESSION} Enter`);
    return c.json({ ok: true, action: "compact" });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/reload-plugins", async (c) => {
  try {
    await sendToTmux("/reload-plugins");
    return c.json({ ok: true, action: "reload-plugins" });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/resize-terminal", async (c) => {
  try {
    await execAsync(`tmux resize-window -t ${TMUX_SESSION} -A`);
    return c.json({ ok: true, action: "resize-terminal" });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

export { app as slashCommandsRoute };
