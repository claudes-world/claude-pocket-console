import { spawn } from "node:child_process";
import type { WSContext } from "hono/ws";

const TMUX_SESSION = process.env.TMUX_SESSION || "claudes-world";

export function terminalRoute(c: any) {
  return {
    onOpen(_event: Event, ws: WSContext) {
      console.log("[ws] client connected");

      let lastContent = "";
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
          // Only send if content changed
          if (output !== lastContent) {
            lastContent = output;
            ws.send(JSON.stringify({ type: "pane", content: output }));
          }
        });

        capture.on("error", (err: Error) => {
          console.error("[tmux] capture error:", err.message);
        });
      };

      // Send initial content
      sendPaneContent();

      // Poll every 500ms for updates
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
