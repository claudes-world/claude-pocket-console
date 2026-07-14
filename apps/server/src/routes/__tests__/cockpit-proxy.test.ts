import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCockpitProxyRoute } from "../cockpit-proxy.js";

const TEST_BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
const TEST_USER = { id: 999111, first_name: "TestUser" };
const COCKPIT_TOKEN = "cockpit-server-secret";

const savedEnv = {
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  allowedUsers: process.env.ALLOWED_TELEGRAM_USERS,
  nodeEnv: process.env.NODE_ENV,
};

let config = {
  internalUrl: "http://127.0.0.1:38847",
  authToken: COCKPIT_TOKEN,
};
let fetchImpl: ReturnType<typeof vi.fn>;

beforeAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = TEST_BOT_TOKEN;
  process.env.ALLOWED_TELEGRAM_USERS = String(TEST_USER.id);
  process.env.NODE_ENV = "test";
});

afterAll(() => {
  restoreEnv("TELEGRAM_BOT_TOKEN", savedEnv.botToken);
  restoreEnv("ALLOWED_TELEGRAM_USERS", savedEnv.allowedUsers);
  restoreEnv("NODE_ENV", savedEnv.nodeEnv);
});

beforeEach(() => {
  config = {
    internalUrl: "http://127.0.0.1:38847",
    authToken: COCKPIT_TOKEN,
  };
  fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  }));
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function makeInitData(): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify(TEST_USER),
  });
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(TEST_BOT_TOKEN).digest();
  params.set("hash", createHmac("sha256", secretKey).update(dataCheckString).digest("hex"));
  return params.toString();
}

function buildApp(): Hono {
  const app = new Hono();
  app.route("/api/cockpit-proxy", createCockpitProxyRoute({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    getConfig: () => config,
    now: () => Date.parse("2026-07-13T12:00:00Z"),
  }));
  return app;
}

function cpcAuthHeaders(): HeadersInit {
  return { Authorization: `tma ${makeInitData()}` };
}

async function proxyCookie(app: Hono): Promise<string> {
  const response = await app.request("/api/cockpit-proxy/health", { headers: cpcAuthHeaders() });
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toContain("cpc_cockpit_proxy=");
  return setCookie!.split(";", 1)[0];
}

describe("cockpit proxy", () => {
  it("requires CPC auth before disclosing capability or proxying", async () => {
    const app = buildApp();
    expect((await app.request("/api/cockpit-proxy/health")).status).toBe(401);
    expect((await app.request("/api/cockpit-proxy/")).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports an authenticated disabled capability without setting a cookie", async () => {
    config.authToken = "";
    const response = await buildApp().request("/api/cockpit-proxy/health", {
      headers: cpcAuthHeaders(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: false });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("bootstraps a scoped HttpOnly session without exposing the cockpit token", async () => {
    const response = await buildApp().request("/api/cockpit-proxy/health", {
      headers: cpcAuthHeaders(),
    });
    const body = await response.text();
    const cookie = response.headers.get("set-cookie") || "";

    expect(response.status).toBe(200);
    expect(body).toBe('{"configured":true}');
    expect(`${body}${cookie}`).not.toContain(COCKPIT_TOKEN);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api/cockpit-proxy");
  });

  it("forwards method, path, query and body with only the server Bearer credential", async () => {
    let receivedBody = "";
    fetchImpl.mockImplementation(async (input: URL | RequestInfo, init?: RequestInit) => {
      receivedBody = await new Response(init?.body).text();
      return new Response('{"accepted":true}', {
        headers: { "content-type": "application/json" },
      });
    });
    const app = buildApp();
    const cookie = await proxyCookie(app);
    const response = await app.request(
      "/api/cockpit-proxy/api/sessions/agent-1/compact?detail=full",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer client-credential-that-must-be-replaced",
          Cookie: `${cookie}; unrelated=client-cookie`,
          "Content-Type": "application/json",
          "X-Cockpit-Intent": "compact",
        },
        body: '{"request":"compact"}',
      },
    );

    expect(response.status).toBe(200);
    const responseBody = await response.text();
    expect(responseBody).toBe('{"accepted":true}');
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [target, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe(
      "http://127.0.0.1:38847/api/sessions/agent-1/compact?detail=full",
    );
    const headers = new Headers(init.headers);
    expect(init.method).toBe("POST");
    expect(headers.get("authorization")).toBe(`Bearer ${COCKPIT_TOKEN}`);
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-cockpit-intent")).toBe("compact");
    expect(receivedBody).toBe('{"request":"compact"}');
    expect(responseBody).not.toContain(COCKPIT_TOKEN);
  });

  it("rewrites root-absolute cockpit API paths beneath the proxy prefix", async () => {
    fetchImpl.mockResolvedValue(new Response(
      '<script>fetch("/api/fleet");new EventSource("/api/fleet/stream")</script>',
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ));
    const app = buildApp();
    const cookie = await proxyCookie(app);
    const response = await app.request("/api/cockpit-proxy/", {
      headers: { Cookie: cookie },
    });

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain(
      'fetch("/api/cockpit-proxy/api/fleet")',
    );
  });

  it("passes SSE through as a streamed response with its content type", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: one\n\n"));
        controller.close();
      },
    });
    fetchImpl.mockResolvedValue(new Response(stream, {
      headers: {
        "cache-control": "no-cache",
        "content-type": "text/event-stream",
      },
    }));
    const app = buildApp();
    const cookie = await proxyCookie(app);
    const response = await app.request("/api/cockpit-proxy/api/fleet/stream", {
      headers: { Cookie: cookie },
    });

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toBe("data: one\n\n");
  });
});
