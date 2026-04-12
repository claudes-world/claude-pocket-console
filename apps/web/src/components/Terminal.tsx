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
      fontSize: 12,
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
    let authParam = "";
    if (initData) {
      authParam = `?auth=${encodeURIComponent(initData)}`;
    } else {
      // Fallback: URL token from keyboard button, then saved session token
      const urlParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#[^&]*&?/, ""));
      const urlToken = urlParams.get("token") || hashParams.get("token") || "";
      const savedToken = localStorage.getItem("cpc-session-token") || "";
      const token = urlToken || savedToken;
      if (token) authParam = `?token=${encodeURIComponent(token)}`;
    }
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal${authParam}`;
    const ws = new WebSocket(wsUrl);

    fit.fit();
    const frameId = window.requestAnimationFrame(() => {
      fit.fit();
    });

    ws.onopen = () => {
      onConnectionChange(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "dimensions") {
          // Use the SMALLER of tmux pane width and what fits in the viewport.
          // This prevents text being cut off on narrow screens while still
          // aligning correctly when the viewport is wider than the pane.
          console.log(`[tmux pane] ${msg.cols}x${msg.rows}`);
          if (msg.cols > 0 && msg.rows > 0) {
            fit.fit(); // Calculate what fits in the viewport
            const viewCols = term.cols;
            const viewRows = term.rows;
            const cols = Math.min(msg.cols, viewCols);
            const rows = Math.min(msg.rows, viewRows);
            if (cols !== viewCols || rows !== viewRows) {
              term.resize(cols, rows);
            }
          }
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
    };

    ws.onerror = () => {
      onConnectionChange(false);
    };

    wsRef.current = ws;

    // Handle viewport resize — just refit xterm to container
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
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
        position: "relative",
      }}
    >
      <div
        ref={mountRef}
        data-testid="terminal-mount"
        style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0 }}
      />
      {/* Invisible overlay to block all touch/click events on the read-only terminal.
          Prevents xterm's hidden textarea from capturing focus and triggering mobile keyboard. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 10,
          touchAction: "none",
        }}
      />
      <style>{`
        .xterm textarea { pointer-events: none !important; }
      `}</style>
    </div>
  );
}
