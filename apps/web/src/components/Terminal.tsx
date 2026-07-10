import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

// Keep in sync with FIT_COLS_MIN/MAX, FIT_ROWS_MIN/MAX in
// apps/server/src/routes/terminal-ws.ts. Clamping client-side is a UX
// nicety (avoids a round-trip failure for the common case of a viewport
// resolving wider/taller than the bound, e.g. a wide desktop browser tab)
// — the server remains the source of truth and validates independently
// regardless of what the client sends.
const FIT_COLS_MIN = 20;
const FIT_COLS_MAX = 500;
const FIT_ROWS_MIN = 5;
const FIT_ROWS_MAX = 300;

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, value)));
}

export interface FitResult {
  ok: boolean;
  cols?: number;
  rows?: number;
  message?: string;
}

interface TerminalProps {
  onConnectionChange: (connected: boolean) => void;
  isActive?: boolean;
  /**
   * Escape hatch for the "Fit screen" action (reconnect menu). The parent
   * (App.tsx) owns this ref; Terminal populates it with a function that
   * measures the current xterm.js viewport and sends a one-shot `fit`
   * request over the live WebSocket. Terminal doesn't use forwardRef
   * elsewhere in this codebase, so a plain ref-as-prop keeps this consistent
   * with the rest of the component's imperative surface (wsRef/fitRef stay
   * internal; only the trigger function is exposed).
   */
  fitScreenRef?: MutableRefObject<(() => void) | null>;
  /**
   * Fired when the server acks (`fit-ack`) or rejects (`fit-error`) a fit
   * request, so the caller (App.tsx -> ActionBar) can replace the optimistic
   * "Fit screen requested" status with the real outcome instead of leaving
   * it looking like unconditional success.
   */
  onFitResult?: (result: FitResult) => void;
  /**
   * tmux session to view (multi-session picker). null/undefined = the
   * server's default session (today's behavior). App.tsx keys this
   * component by session, so each mount views exactly one session for its
   * whole lifetime.
   */
  session?: string | null;
}

/** Build the WebSocket URL with auth (and optional session) params. */
function buildWsUrl(session?: string | null): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams();
  const initData = window.Telegram?.WebApp?.initData || "";
  if (initData) {
    params.set("auth", initData);
  } else {
    // Fallback: URL token from keyboard button, then saved session token
    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#[^&]*&?/, ""));
    const urlToken = urlParams.get("token") || hashParams.get("token") || "";
    const savedToken = localStorage.getItem("cpc-session-token") || "";
    const token = urlToken || savedToken;
    if (token) params.set("token", token);
  }
  if (session) params.set("session", session);
  const qs = params.toString();
  return `${protocol}//${window.location.host}/ws/terminal${qs ? `?${qs}` : ""}`;
}

export function Terminal({ onConnectionChange, isActive, fitScreenRef, onFitResult, session }: TerminalProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // Stable ref for onConnectionChange so connectWs doesn't need it as a dep
  const onConnectionChangeRef = useRef(onConnectionChange);
  onConnectionChangeRef.current = onConnectionChange;

  // Same pattern for onFitResult — connectWs/ws.onmessage is only set up
  // once per connection and shouldn't need to be a dependency of anything.
  const onFitResultRef = useRef(onFitResult);
  onFitResultRef.current = onFitResult;

  // Ref so connectWs (stable useCallback) always reads the current session
  // without needing it as a dependency. In practice App.tsx remounts this
  // component when the session changes, so the value is fixed per mount.
  const sessionRef = useRef(session);
  sessionRef.current = session;

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

    const ws = new WebSocket(buildWsUrl(sessionRef.current));

    // Guard all handlers against stale sockets: if connectWs is called again
    // before the previous socket finishes closing, the old socket's events
    // must not overwrite state belonging to the new connection.
    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      onConnectionChangeRef.current(true);
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
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
        } else if (msg.type === "fit-ack") {
          // Server applied the fit request. Distinct from the generic
          // "error" type (also used for auth failures) so this can't be
          // confused with an unrelated connection error.
          console.log(`[fit] applied ${msg.cols}x${msg.rows}`);
          onFitResultRef.current?.({ ok: true, cols: msg.cols, rows: msg.rows });
        } else if (msg.type === "fit-error") {
          // Server rejected or failed to apply the fit request (validation
          // failure or a tmux resize-window error). Surfaced to the caller
          // so the UI can replace the optimistic "requested" status with
          // the real outcome instead of showing false success.
          console.log(`[fit] rejected: ${msg.message}`);
          onFitResultRef.current?.({ ok: false, message: msg.message });
        } else if (msg.type === "error") {
          // Server-initiated close reasons (unknown session, session ended
          // mid-view, auth failure). Render the reason into the terminal so
          // the user sees WHY the view stopped instead of a silent freeze —
          // the server closes the socket right after sending this, which
          // flips the header dot to "offline" via onclose below.
          console.log(`[ws] server error: ${msg.message}`);
          term.write(`\r\n\x1b[31m[${msg.message}]\x1b[0m\r\n`);
        }
      } catch {
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      onConnectionChangeRef.current(false);
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      onConnectionChangeRef.current(false);
    };

    wsRef.current = ws;
  }, []);

  /**
   * "Fit screen" action (reconnect menu, manual only — never auto-fired).
   * Re-measures the actual xterm.js viewport with the fit addon, then sends
   * exactly one `fit` request over the live WebSocket so the server can
   * issue a single bounded `tmux resize-window -x -y` call. No-ops quietly
   * if the terminal isn't mounted or the socket isn't open — there's no
   * meaningful fallback for a tap that arrives mid-reconnect.
   *
   * Dimensions are clamped to the server's own bounds before sending (a
   * wide desktop browser tab can resolve to well over 500 cols). The
   * server re-validates independently either way — this just avoids
   * manufacturing an avoidable `fit-error` round-trip for the common case.
   */
  const sendFitRequest = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    const ws = wsRef.current;
    if (!term || !fit || !ws || ws.readyState !== WebSocket.OPEN) return;
    fit.fit();
    const cols = clamp(term.cols, FIT_COLS_MIN, FIT_COLS_MAX);
    const rows = clamp(term.rows, FIT_ROWS_MIN, FIT_ROWS_MAX);
    if (cols > 0 && rows > 0) {
      ws.send(JSON.stringify({ type: "fit", cols, rows }));
    }
  }, []);

  // Register/unregister the fit trigger on the parent-owned ref so
  // ActionBar -> ReconnectMenu can reach it without forwardRef plumbing.
  useEffect(() => {
    if (!fitScreenRef) return;
    fitScreenRef.current = sendFitRequest;
    return () => {
      fitScreenRef.current = null;
    };
  }, [fitScreenRef, sendFitRequest]);

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
