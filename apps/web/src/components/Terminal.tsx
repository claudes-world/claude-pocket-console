import { useCallback, useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  onConnectionChange: (connected: boolean) => void;
  isActive?: boolean;
}

/** Build the WebSocket URL with auth params. */
function buildWsUrl(): string {
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
  return `${protocol}//${window.location.host}/ws/terminal${authParam}`;
}

export function Terminal({ onConnectionChange, isActive }: TerminalProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // Stable ref for onConnectionChange so connectWs doesn't need it as a dep
  const onConnectionChangeRef = useRef(onConnectionChange);
  onConnectionChangeRef.current = onConnectionChange;

  /** Open a WebSocket and wire it to the current xterm instance.
   *  Closes any existing connection first to prevent duplicates. */
  const connectWs = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;

    // Tear down previous connection if still open
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
      wsRef.current.close();
    }

    const ws = new WebSocket(buildWsUrl());

    ws.onopen = () => {
      onConnectionChangeRef.current(true);
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
      onConnectionChangeRef.current(false);
    };

    ws.onerror = () => {
      onConnectionChangeRef.current(false);
    };

    wsRef.current = ws;
  }, []);

  // Initialize xterm and open the first WS connection on mount
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

    fit.fit();
    const frameId = window.requestAnimationFrame(() => {
      fit.fit();
    });

    // Auto-connect on initial render
    connectWs();

    // Handle viewport resize — just refit xterm to container
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
    });
    resizeObserver.observe(mountRef.current);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      if (wsRef.current) wsRef.current.close();
      term.dispose();
    };
  }, [connectWs]);

  // Auto-reconnect when the terminal tab becomes active and WS is disconnected
  useEffect(() => {
    if (!isActive) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      connectWs();
    }
  }, [isActive, connectWs]);

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
