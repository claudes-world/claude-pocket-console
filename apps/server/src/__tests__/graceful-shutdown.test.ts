import { describe, expect, it, vi } from "vitest";
import {
  drainServer,
  type CloseableHttpServer,
  type CloseableWebSocketServer,
} from "../lib/graceful-shutdown.js";

describe("drainServer", () => {
  it("waits for HTTP and WS drains before flushing telemetry", async () => {
    const events: string[] = [];
    let finishHttpDrain!: () => void;
    const server = {
      close: vi.fn((callback: () => void) => {
        finishHttpDrain = () => {
          events.push("http");
          callback();
        };
      }),
    } as CloseableHttpServer;

    const wsClient = { close: vi.fn() };
    let finishWebSocketDrain!: () => void;
    const wss = {
      clients: new Set([wsClient]),
      close: vi.fn((callback: (error?: Error) => void) => {
        finishWebSocketDrain = () => {
          events.push("ws");
          callback();
        };
      }),
    } as unknown as CloseableWebSocketServer;
    const flushTelemetry = vi.fn(async () => {
      events.push("telemetry");
    });

    const draining = drainServer(server, wss, flushTelemetry);
    await new Promise((resolve) => setImmediate(resolve));

    expect(flushTelemetry).not.toHaveBeenCalled();
    expect(wsClient.close).toHaveBeenCalledWith(1001, "Server shutting down");

    // Models Node's Server.close callback: it fires only after the held-open
    // request has completed. Telemetry must remain live until that point.
    finishHttpDrain();
    await new Promise((resolve) => setImmediate(resolve));
    expect(flushTelemetry).not.toHaveBeenCalled();

    finishWebSocketDrain();
    await draining;

    expect(events).toEqual(["http", "ws", "telemetry"]);
    expect(flushTelemetry).toHaveBeenCalledOnce();
  });
});
