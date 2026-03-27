import { spawn, execSync } from "node:child_process";
import type { WSContext } from "hono/ws";
import { checkAuth } from "../auth.js";

const TMUX_SESSION = process.env.TMUX_SESSION || "claudes-world";

function getPaneDimensions(): { cols: number; rows: number } {
  try {
    const out = execSync(
      `tmux display-message -t ${TMUX_SESSION} -p '#{pane_width}x#{pane_height}'`,
      { encoding: "utf-8" },
    ).trim();
    const [cols, rows] = out.split("x").map(Number);
    return { cols: cols || 80, rows: rows || 24 };
  } catch {
    return { cols: 80, rows: 24 };
  }
}

export function terminalRoute(c: any) {
  // Auth check: initData passed as query param
  const initData = c.req.query("auth") || "";
  const authResult = checkAuth(initData);

  return {
    onOpen(_event: Event, ws: WSContext) {
      if (!authResult.ok) {
        console.log(`[ws] unauthorized: ${authResult.error}`);
        ws.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
        ws.close(4001, "Unauthorized");
        return;
      }
      console.log(`[ws] client connected (user: ${authResult.user?.username || "unknown"})`);

      let lastContent = "";
      let interval: ReturnType<typeof setInterval>;

      // Send pane dimensions so client can match
      const dims = getPaneDimensions();
      ws.send(JSON.stringify({ type: "dimensions", cols: dims.cols, rows: dims.rows }));

      const sendPaneContent = () => {
        // -J joins wrapped lines so they reflow to client width
        const capture = spawn("tmux", [
          "capture-pane",
          "-t", TMUX_SESSION,
          "-p",
          "-J",
        ]);

        let output = "";
        capture.stdout.on("data", (data: Buffer) => {
          output += data.toString();
        });

        capture.on("close", () => {
          if (output !== lastContent) {
            lastContent = output;
            ws.send(JSON.stringify({ type: "pane", content: output }));
          }
        });

        capture.on("error", (err: Error) => {
          console.error("[tmux] capture error:", err.message);
        });
      };

      sendPaneContent();
      interval = setInterval(sendPaneContent, 500);

      (ws as any)._cleanup = () => {
        clearInterval(interval);
      };
    },

    onMessage(event: MessageEvent, ws: WSContext) {
      try {
        const msg = JSON.parse(event.data.toString());
        if (msg.type === "resize") {
          console.log(`[ws] resize: ${msg.cols}x${msg.rows}`);
        }
      } catch {
        // Ignore non-JSON messages
      }
    },

    onClose(_event: Event, ws: WSContext) {
      console.log("[ws] client disconnected");
      (ws as any)._cleanup?.();
    },
  };
}
