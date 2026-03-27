import { spawn } from "node:child_process";
import type { WSContext } from "hono/ws";

const TMUX_SESSION = process.env.TMUX_SESSION || "claudes-world";

export function terminalRoute(c: any) {
  return {
    onOpen(_event: Event, ws: WSContext) {
      console.log("[ws] client connected");

      // Attach to tmux session in read-only mode
      const tmux = spawn("tmux", [
        "capture-pane",
        "-t", TMUX_SESSION,
        "-p",
        "-S", "-",
      ]);

      // For live streaming, use tmux pipe-pane or a pty approach
      // For v1, we'll poll the tmux pane content
      let interval: ReturnType<typeof setInterval>;

      const sendPaneContent = () => {
        const capture = spawn("tmux", [
          "capture-pane",
          "-t", TMUX_SESSION,
          "-p",
          "-e",
        ]);

        let output = "";
        capture.stdout.on("data", (data: Buffer) => {
          output += data.toString();
        });

        capture.on("close", () => {
          ws.send(output);
        });

        capture.on("error", (err: Error) => {
          console.error("[tmux] capture error:", err.message);
        });
      };

      // Send initial content
      sendPaneContent();

      // Poll every 500ms for updates
      interval = setInterval(sendPaneContent, 500);

      // Store cleanup in ws context
      (ws as any)._cleanup = () => {
        clearInterval(interval);
        tmux.kill();
      };
    },

    onMessage(event: MessageEvent, ws: WSContext) {
      try {
        const msg = JSON.parse(event.data.toString());
        if (msg.type === "resize") {
          // Could resize the tmux pane if needed
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
