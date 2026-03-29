import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  onConnectionChange: (connected: boolean) => void;
}

export function Terminal({ onConnectionChange }: TerminalProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!wrapperRef.current || !mountRef.current) return;

    const term = new XTerm({
      cursorBlink: false,
      cursorStyle: "bar",
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: "#1a1b26",
        foreground: "#c0caf5",
        cursor: "#c0caf5",
        selectionBackground: "#33467c",
        black: "#15161e",
        red: "#f7768e",
        green: "#9ece6a",
        yellow: "#e0af68",
        blue: "#7aa2f7",
        magenta: "#bb9af7",
        cyan: "#7dcfff",
        white: "#a9b1d6",
      },
      disableStdin: true,
      scrollback: 0,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(mountRef.current);

    termRef.current = term;
    fitRef.current = fit;

    // Connect to WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const initData = window.Telegram?.WebApp?.initData || "";
    const authParam = initData ? `?auth=${encodeURIComponent(initData)}` : "";
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal${authParam}`;
    const ws = new WebSocket(wsUrl);

    const syncTerminalSize = () => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    syncTerminalSize();
    const frameId = window.requestAnimationFrame(() => {
      syncTerminalSize();
    });

    ws.onopen = () => {
      onConnectionChange(true);
      syncTerminalSize();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "dimensions") {
          // Info only — we let xterm keep its own size and reflow with -J
          console.log(`[tmux pane] ${msg.cols}x${msg.rows}`);
        } else if (msg.type === "pane") {
          // Clear screen and write from top
          term.write("\x1b[2J\x1b[H");
          // Write each line, trimming trailing whitespace
          const lines = msg.content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            term.write(lines[i].trimEnd());
            if (i < lines.length - 1) term.write("\r\n");
          }
        }
      } catch {
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      onConnectionChange(false);
      term.writeln("\r\n\x1b[31m[disconnected]\x1b[0m");
    };

    ws.onerror = () => {
      onConnectionChange(false);
    };

    wsRef.current = ws;

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      syncTerminalSize();
    });
    resizeObserver.observe(mountRef.current);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
    };
  }, [onConnectionChange]);

  return (
    <div
      ref={wrapperRef}
      data-testid="terminal-wrapper"
      style={{
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        padding: "4px",
        overflow: "hidden",
      }}
      onTouchEnd={() => {
        // Prevent mobile keyboard from appearing on tap — blur xterm's hidden textarea
        const ta = wrapperRef.current?.querySelector("textarea");
        if (ta) ta.blur();
      }}
    >
      <div
        ref={mountRef}
        data-testid="terminal-mount"
        style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0 }}
      />
    </div>
  );
}
