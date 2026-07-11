export interface CloseableHttpServer {
  close(callback: () => void): unknown;
}

export interface CloseableWebSocketServer {
  clients: Iterable<{ close(code: number, reason: string): void }>;
  close(callback: (error?: Error) => void): void;
}

function closeHttpServer(server: CloseableHttpServer): Promise<void> {
  return new Promise((resolve) => {
    server.close(resolve);
  });
}

function closeWebSocketServer(wss: CloseableWebSocketServer): Promise<void> {
  // HTTP Server.close() does not close sockets that have already upgraded.
  // Start a normal WS close handshake for every client; wss.close() resolves
  // after those clients have disconnected. The process-level hard timeout in
  // index.ts remains the backstop for a client that never completes it.
  for (const client of wss.clients) {
    client.close(1001, "Server shutting down");
  }

  return new Promise((resolve, reject) => {
    wss.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/** Stop new traffic, drain HTTP and WS, then flush final telemetry. */
export async function drainServer(
  server: CloseableHttpServer,
  wss: CloseableWebSocketServer,
  shutdownTelemetry: () => Promise<void>,
): Promise<void> {
  // Begin both drains together: upgraded sockets can otherwise keep the HTTP
  // server's close callback pending, depending on Node/server adapter details.
  const results = await Promise.allSettled([
    closeHttpServer(server),
    closeWebSocketServer(wss),
  ]);
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (errors.length > 0) {
    throw new AggregateError(errors, "one or more server drains failed");
  }
  await shutdownTelemetry();
}
