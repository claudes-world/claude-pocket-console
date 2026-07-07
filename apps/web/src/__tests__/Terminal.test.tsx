/**
 * Tests for Terminal component.
 *
 * Covers: DOM rendering, xterm initialization, WebSocket URL construction,
 * auth fallback chain, connection state callbacks, message handling,
 * cleanup on unmount, and ResizeObserver wiring.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { Terminal, type FitResult } from "../components/Terminal";
import type { MutableRefObject } from "react";

// ---------------------------------------------------------------------------
// WebSocket mock
// ---------------------------------------------------------------------------

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  // Match the real WebSocket readyState constants — Terminal.tsx compares
  // readyState against `WebSocket.OPEN` etc., and once the test swaps in
  // this mock as the global WebSocket, those class statics must exist or
  // every comparison silently resolves against `undefined`.
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0; // CONNECTING
  close = vi.fn(() => {
    this.readyState = 3;
  });
  send = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  simulateOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  simulateRawMessage(data: string) {
    this.onmessage?.({ data });
  }
  simulateClose() {
    this.readyState = 3;
    this.onclose?.();
  }
  simulateError() {
    this.onerror?.();
  }
}

// ---------------------------------------------------------------------------
// XTerm mock
// ---------------------------------------------------------------------------

const mockTermWrite = vi.fn();
const mockTermResize = vi.fn();
const mockTermDispose = vi.fn();
const mockTermOpen = vi.fn();
const mockTermLoadAddon = vi.fn();
const mockFitFit = vi.fn();

// Mutable so individual tests can simulate an unusually wide/narrow/short
// viewport (e.g. a desktop browser tab resolving to >500 cols) and assert
// on the clamped value Terminal.tsx sends. Getters read the current value
// at access time, matching how the component reads `term.cols`/`term.rows`
// fresh on every `sendFitRequest()` call.
let mockTermCols = 80;
let mockTermRows = 24;

vi.mock("@xterm/xterm", () => {
  function MockXTerm() {
    return {
      loadAddon: mockTermLoadAddon,
      open: mockTermOpen,
      write: mockTermWrite,
      resize: mockTermResize,
      dispose: mockTermDispose,
      get cols() { return mockTermCols; },
      get rows() { return mockTermRows; },
    };
  }
  return { Terminal: MockXTerm };
});

vi.mock("@xterm/addon-fit", () => {
  function MockFitAddon() {
    return { fit: mockFitFit };
  }
  return { FitAddon: MockFitAddon };
});

vi.mock("@xterm/addon-web-links", () => {
  function MockWebLinksAddon() {
    return {};
  }
  return { WebLinksAddon: MockWebLinksAddon };
});

// Mock CSS imported by Terminal.tsx
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// ---------------------------------------------------------------------------
// ResizeObserver mock
// ---------------------------------------------------------------------------

const mockResizeObserve = vi.fn();
const mockResizeDisconnect = vi.fn();
let resizeObserverCallback: ((entries: unknown[]) => void) | null = null;

function MockResizeObserver(cb: (entries: unknown[]) => void) {
  resizeObserverCallback = cb;
  return {
    observe: mockResizeObserve,
    disconnect: mockResizeDisconnect,
    _fire: () => cb([]),
  };
}

global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// ---------------------------------------------------------------------------
// beforeEach / afterEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  MockWebSocket.instances = [];
  resizeObserverCallback = null;
  vi.useFakeTimers();

  mockTermCols = 80;
  mockTermRows = 24;

  mockTermWrite.mockClear();
  mockTermResize.mockClear();
  mockTermDispose.mockClear();
  mockTermOpen.mockClear();
  mockTermLoadAddon.mockClear();
  mockFitFit.mockClear();
  mockResizeObserve.mockClear();
  mockResizeDisconnect.mockClear();

  global.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

  Object.defineProperty(window, "location", {
    value: {
      protocol: "https:",
      host: "cpc.claude.do",
      search: "",
      hash: "",
    },
    writable: true,
    configurable: true,
  });

  // Clear Telegram WebApp stub
  delete (window as unknown as Record<string, unknown>).Telegram;

  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderTerminal(onConnectionChange = vi.fn()) {
  return render(<Terminal onConnectionChange={onConnectionChange} />);
}

function renderTerminalWithFitRef(onConnectionChange = vi.fn(), onFitResult?: (r: FitResult) => void) {
  const fitScreenRef: MutableRefObject<(() => void) | null> = { current: null };
  const utils = render(
    <Terminal onConnectionChange={onConnectionChange} fitScreenRef={fitScreenRef} onFitResult={onFitResult} />,
  );
  return { ...utils, fitScreenRef };
}

function getWs(): MockWebSocket {
  expect(MockWebSocket.instances.length).toBeGreaterThan(0);
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

// ---------------------------------------------------------------------------
// DOM rendering
// ---------------------------------------------------------------------------

describe("DOM rendering", () => {
  it("renders terminal-wrapper", () => {
    const { getByTestId } = renderTerminal();
    expect(getByTestId("terminal-wrapper")).toBeInTheDocument();
  });

  it("renders terminal-mount", () => {
    const { getByTestId } = renderTerminal();
    expect(getByTestId("terminal-mount")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// xterm initialization
// ---------------------------------------------------------------------------

describe("xterm initialization", () => {
  it("calls XTerm constructor on mount — term.open and loadAddon are invoked", () => {
    // XTerm constructor is confirmed indirectly: open() is only reachable
    // if a Terminal instance was successfully constructed.
    renderTerminal();
    expect(mockTermOpen).toHaveBeenCalledTimes(1);
    // Two addons must be loaded: FitAddon and WebLinksAddon
    expect(mockTermLoadAddon).toHaveBeenCalledTimes(2);
  });

  it("opens xterm to the mount div", () => {
    const { getByTestId } = renderTerminal();
    const mountDiv = getByTestId("terminal-mount");
    expect(mockTermOpen).toHaveBeenCalledWith(mountDiv);
  });

  it("calls fit.fit() immediately and once more via rAF", () => {
    renderTerminal();
    // Immediate call from fit.fit() before rAF
    expect(mockFitFit).toHaveBeenCalledTimes(1);
    // Advance timers to flush the rAF
    vi.runAllTimers();
    expect(mockFitFit).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// WebSocket URL construction
// ---------------------------------------------------------------------------

describe("WebSocket URL construction", () => {
  it("uses wss: when window.location.protocol is https:", () => {
    renderTerminal();
    const ws = getWs();
    expect(ws.url).toMatch(/^wss:\/\//);
  });

  it("uses ws: when window.location.protocol is http:", () => {
    Object.defineProperty(window, "location", {
      value: { protocol: "http:", host: "localhost:5173", search: "", hash: "" },
      writable: true,
      configurable: true,
    });
    renderTerminal();
    const ws = getWs();
    expect(ws.url).toMatch(/^ws:\/\//);
  });

  it("uses ?auth= param when window.Telegram.WebApp.initData is set", () => {
    // @ts-expect-error window.Telegram is not in lib types
    window.Telegram = { WebApp: { initData: "tg-init-data-value" } };
    renderTerminal();
    const ws = getWs();
    expect(ws.url).toContain("?auth=");
    expect(ws.url).toContain(encodeURIComponent("tg-init-data-value"));
    expect(ws.url).not.toContain("?token=");
  });

  it("falls back to ?token= from localStorage when no Telegram initData", () => {
    localStorage.setItem("cpc-session-token", "saved-token-abc");
    renderTerminal();
    const ws = getWs();
    expect(ws.url).toContain("?token=");
    expect(ws.url).toContain(encodeURIComponent("saved-token-abc"));
  });
});

// ---------------------------------------------------------------------------
// Connection state callbacks
// ---------------------------------------------------------------------------

describe("connection state callbacks", () => {
  it("calls onConnectionChange(true) when WS onopen fires", () => {
    const onConnectionChange = vi.fn();
    renderTerminal(onConnectionChange);
    getWs().simulateOpen();
    expect(onConnectionChange).toHaveBeenCalledWith(true);
  });

  it("calls onConnectionChange(false) when WS onclose fires", () => {
    const onConnectionChange = vi.fn();
    renderTerminal(onConnectionChange);
    getWs().simulateClose();
    expect(onConnectionChange).toHaveBeenCalledWith(false);
  });

  it("calls onConnectionChange(false) when WS onerror fires", () => {
    const onConnectionChange = vi.fn();
    renderTerminal(onConnectionChange);
    getWs().simulateError();
    expect(onConnectionChange).toHaveBeenCalledWith(false);
  });
});

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

describe("message handling", () => {
  it("dimensions message calls term.resize(cols, rows) when smaller than viewport", () => {
    renderTerminal();
    // Mock terminal reports cols=80 rows=24; send a smaller pane
    getWs().simulateMessage({ type: "dimensions", cols: 60, rows: 20 });
    expect(mockTermResize).toHaveBeenCalledWith(60, 20);
  });

  it("dimensions message clips to viewport when pane is larger", () => {
    renderTerminal();
    // Terminal mock cols=80 rows=24; send a pane bigger than the viewport
    getWs().simulateMessage({ type: "dimensions", cols: 200, rows: 50 });
    // Math.min(200, 80) = 80, Math.min(50, 24) = 24 — same as viewport, no resize call
    // The component only calls resize when the result differs from current dims
    expect(mockFitFit).toHaveBeenCalled();
    expect(mockTermResize).not.toHaveBeenCalled();
  });

  it("pane message writes screen-clear sequence followed by content with line endings", () => {
    renderTerminal();
    getWs().simulateMessage({ type: "pane", content: "hello\nworld" });
    // First write must be the clear sequence
    expect(mockTermWrite.mock.calls[0][0]).toBe("\x1b[2J\x1b[H");
    // Content lines should be written individually with \r\n separators
    expect(mockTermWrite).toHaveBeenCalledWith("hello");
    expect(mockTermWrite).toHaveBeenCalledWith("\r\n");
    expect(mockTermWrite).toHaveBeenCalledWith("world");
  });

  it("pane message trims trailing whitespace from each line", () => {
    renderTerminal();
    getWs().simulateMessage({ type: "pane", content: "line1   \nline2\t\n" });
    const writtenArgs = mockTermWrite.mock.calls.map((c) => c[0]);
    // No call should contain trailing spaces or tabs in line content
    const lineWrites = writtenArgs.filter((a) => a !== "\x1b[2J\x1b[H" && a !== "\r\n");
    for (const line of lineWrites) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it("unparseable message writes raw data to terminal", () => {
    renderTerminal();
    getWs().simulateRawMessage("not-json{{{{");
    expect(mockTermWrite).toHaveBeenCalledWith("not-json{{{{");
  });
});

// ---------------------------------------------------------------------------
// Fit screen action (manual, via fitScreenRef)
// ---------------------------------------------------------------------------

describe("fit screen action", () => {
  it("registers a trigger function on fitScreenRef after mount", () => {
    const { fitScreenRef } = renderTerminalWithFitRef();
    expect(typeof fitScreenRef.current).toBe("function");
  });

  it("does nothing automatically — no 'fit' message is sent without invoking the ref", () => {
    renderTerminalWithFitRef();
    const ws = getWs();
    ws.simulateOpen();
    const fitSends = ws.send.mock.calls.filter((call: unknown[]) => {
      try { return JSON.parse(call[0] as string).type === "fit"; } catch { return false; }
    });
    expect(fitSends).toHaveLength(0);
  });

  it("sends a 'fit' message with the current xterm cols/rows when the trigger fires", () => {
    const { fitScreenRef } = renderTerminalWithFitRef();
    const ws = getWs();
    ws.simulateOpen();

    fitScreenRef.current?.();

    expect(mockFitFit).toHaveBeenCalled();
    const fitSends = ws.send.mock.calls
      .map((call: unknown[]) => JSON.parse(call[0] as string))
      .filter((m: { type: string }) => m.type === "fit");
    // Mock XTerm reports cols: 80, rows: 24 (see MockXTerm above)
    expect(fitSends).toEqual([{ type: "fit", cols: 80, rows: 24 }]);
  });

  it("does not send when the socket isn't open yet", () => {
    const { fitScreenRef } = renderTerminalWithFitRef();
    const ws = getWs();
    // readyState still CONNECTING (0) — never called simulateOpen()
    fitScreenRef.current?.();
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("unregisters the trigger on unmount", () => {
    const { fitScreenRef, unmount } = renderTerminalWithFitRef();
    expect(fitScreenRef.current).not.toBeNull();
    unmount();
    expect(fitScreenRef.current).toBeNull();
  });

  it("handles a fit-ack message from the server without throwing", () => {
    renderTerminalWithFitRef();
    const ws = getWs();
    expect(() => ws.simulateMessage({ type: "fit-ack", cols: 92, rows: 40 })).not.toThrow();
  });

  it("clamps an oversized viewport (e.g. a wide desktop browser tab) to the server's max cols before sending", () => {
    mockTermCols = 800; // wider than the server's FIT_COLS_MAX (500)
    mockTermRows = 24;
    const { fitScreenRef } = renderTerminalWithFitRef();
    const ws = getWs();
    ws.simulateOpen();

    fitScreenRef.current?.();

    const fitSends = ws.send.mock.calls
      .map((call: unknown[]) => JSON.parse(call[0] as string))
      .filter((m: { type: string }) => m.type === "fit");
    expect(fitSends).toEqual([{ type: "fit", cols: 500, rows: 24 }]);
  });

  it("clamps an undersized viewport to the server's minimum rows before sending", () => {
    mockTermCols = 80;
    mockTermRows = 2; // below the server's FIT_ROWS_MIN (5)
    const { fitScreenRef } = renderTerminalWithFitRef();
    const ws = getWs();
    ws.simulateOpen();

    fitScreenRef.current?.();

    const fitSends = ws.send.mock.calls
      .map((call: unknown[]) => JSON.parse(call[0] as string))
      .filter((m: { type: string }) => m.type === "fit");
    expect(fitSends).toEqual([{ type: "fit", cols: 80, rows: 5 }]);
  });

  it("calls onFitResult({ ok: true, ... }) when a fit-ack arrives", () => {
    const onFitResult = vi.fn();
    renderTerminalWithFitRef(vi.fn(), onFitResult);
    const ws = getWs();

    ws.simulateMessage({ type: "fit-ack", cols: 92, rows: 40 });

    expect(onFitResult).toHaveBeenCalledWith({ ok: true, cols: 92, rows: 40 });
  });

  it("calls onFitResult({ ok: false, message }) when a fit-error arrives, distinct from fit-ack", () => {
    const onFitResult = vi.fn();
    renderTerminalWithFitRef(vi.fn(), onFitResult);
    const ws = getWs();

    ws.simulateMessage({ type: "fit-error", message: "cols out of range (20-500)" });

    expect(onFitResult).toHaveBeenCalledWith({ ok: false, message: "cols out of range (20-500)" });
    expect(onFitResult).not.toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it("does not call onFitResult for unrelated messages (dimensions/pane)", () => {
    const onFitResult = vi.fn();
    renderTerminalWithFitRef(vi.fn(), onFitResult);
    const ws = getWs();

    ws.simulateMessage({ type: "dimensions", cols: 80, rows: 24 });
    ws.simulateMessage({ type: "pane", content: "hello" });

    expect(onFitResult).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cleanup on unmount
// ---------------------------------------------------------------------------

describe("cleanup on unmount", () => {
  it("calls ws.close() on unmount", () => {
    const { unmount } = renderTerminal();
    const ws = getWs();
    unmount();
    expect(ws.close).toHaveBeenCalled();
  });

  it("calls term.dispose() on unmount", () => {
    const { unmount } = renderTerminal();
    unmount();
    expect(mockTermDispose).toHaveBeenCalled();
  });

  it("disconnects ResizeObserver on unmount", () => {
    const { unmount } = renderTerminal();
    unmount();
    expect(mockResizeDisconnect).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ResizeObserver
// ---------------------------------------------------------------------------

describe("ResizeObserver", () => {
  it("observes mount div and calls fit.fit() when fired", () => {
    const { getByTestId } = renderTerminal();
    const mountDiv = getByTestId("terminal-mount");

    // ResizeObserver should have been set up to observe the mount div
    expect(mockResizeObserve).toHaveBeenCalledWith(mountDiv);

    // Clear fit calls from init so we only count resize-triggered ones
    mockFitFit.mockClear();

    // Simulate a resize event by firing the captured callback
    expect(resizeObserverCallback).not.toBeNull();
    resizeObserverCallback!([]);

    expect(mockFitFit).toHaveBeenCalledTimes(1);
  });
});
