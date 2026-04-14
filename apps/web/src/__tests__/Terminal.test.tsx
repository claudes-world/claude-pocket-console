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
import { Terminal } from "../components/Terminal";

// ---------------------------------------------------------------------------
// WebSocket mock
// ---------------------------------------------------------------------------

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0; // CONNECTING
  close = vi.fn(() => {
    this.readyState = 3;
  });

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

vi.mock("@xterm/xterm", () => {
  function MockXTerm() {
    return {
      loadAddon: mockTermLoadAddon,
      open: mockTermOpen,
      write: mockTermWrite,
      resize: mockTermResize,
      dispose: mockTermDispose,
      cols: 80,
      rows: 24,
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
  // @ts-expect-error window.Telegram is not in lib types
  delete window.Telegram;

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
  it("calls XTerm constructor on mount — term.open is invoked", () => {
    // XTerm constructor is confirmed indirectly: open() is only reachable
    // if a Terminal instance was successfully constructed.
    renderTerminal();
    expect(mockTermOpen).toHaveBeenCalledTimes(1);
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
    expect(mockTermResize).not.toHaveBeenCalled();
  });

  it("pane message writes screen-clear sequence followed by content", () => {
    renderTerminal();
    getWs().simulateMessage({ type: "pane", content: "hello\nworld" });
    // First write must be the clear sequence
    expect(mockTermWrite.mock.calls[0][0]).toBe("\x1b[2J\x1b[H");
    // Content lines should be present in subsequent calls
    const allWritten = mockTermWrite.mock.calls.map((c) => c[0]).join("");
    expect(allWritten).toContain("hello");
    expect(allWritten).toContain("world");
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
