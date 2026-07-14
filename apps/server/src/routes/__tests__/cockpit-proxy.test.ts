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

function buildApp(overrides: { internalUrl?: string } = {}): Hono {
  const app = new Hono();
  app.route("/api/cockpit-proxy", createCockpitProxyRoute({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    getConfig: () => ({ ...config, ...overrides }),
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

  it("does not renew a session authenticated only by its existing cookie", async () => {
    const app = buildApp();
    const cookie = await proxyCookie(app);
    const response = await app.request("/api/cockpit-proxy/health", {
      headers: { Cookie: cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: true });
    expect(response.headers.get("set-cookie")).toBeNull();
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

  it.each([
    "/api/cockpit-proxy/http://attacker.example/",
    "/api/cockpit-proxy//attacker.example/",
    "/api/cockpit-proxy/http:%5C%5Cattacker.example/",
    "/api/cockpit-proxy/%2F%2Fattacker.example/",
  ])("rejects unsafe upstream path %s without fetching", async (path) => {
    const app = buildApp();
    const cookie = await proxyCookie(app);
    fetchImpl.mockClear();

    const response = await app.request(path, { headers: { Cookie: cookie } });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects dot-segment traversal escaping a subpath internal URL", async () => {
    const app = buildApp({ internalUrl: "http://127.0.0.1:38847/cockpit" });
    const cookie = await proxyCookie(app);
    fetchImpl.mockClear();

    const response = await app.request("/api/cockpit-proxy/../admin/secrets", {
      headers: { Cookie: cookie },
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("still proxies normally when the internal URL carries a subpath", async () => {
    const app = buildApp({ internalUrl: "http://127.0.0.1:38847/cockpit" });
    const cookie = await proxyCookie(app);
    await app.request("/api/cockpit-proxy/api/fleet", {
      headers: { Cookie: cookie },
    });

    const [target] = fetchImpl.mock.calls[0] as [URL];
    expect(String(target)).toBe("http://127.0.0.1:38847/cockpit/api/fleet");
  });

  it("strips headers nominated by the incoming Connection header", async () => {
    const app = buildApp();
    const cookie = await proxyCookie(app);
    await app.request("/api/cockpit-proxy/api/fleet", {
      headers: {
        Cookie: cookie,
        Connection: "X-Remove-Me, X-Also-Remove",
        "X-Also-Remove": "private",
        "X-Keep-Me": "public",
        "X-Remove-Me": "private",
      },
    });

    const [, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("connection")).toBeNull();
    expect(headers.get("x-remove-me")).toBeNull();
    expect(headers.get("x-also-remove")).toBeNull();
    expect(headers.get("x-keep-me")).toBe("public");
  });

  it("rewrites same-origin absolute redirects beneath the proxy prefix", async () => {
    fetchImpl.mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: "http://127.0.0.1:38847/login?next=%2Ffleet#auth" },
    }));
    const app = buildApp();
    const cookie = await proxyCookie(app);
    const response = await app.request("/api/cockpit-proxy/api/fleet", {
      headers: { Cookie: cookie },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/api/cockpit-proxy/login?next=%2Ffleet#auth",
    );
  });

  it("rewrites root-relative upstream redirects beneath the proxy prefix", async () => {
    fetchImpl.mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: "/login?next=%2Ffleet" },
    }));
    const app = buildApp();
    const cookie = await proxyCookie(app);
    const response = await app.request("/api/cockpit-proxy/api/fleet", {
      headers: { Cookie: cookie },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/api/cockpit-proxy/login?next=%2Ffleet",
    );
  });

  it("passes relative upstream redirects through unchanged", async () => {
    fetchImpl.mockResolvedValue(new Response(null, {
      status: 307,
      headers: { Location: "../login?next=fleet" },
    }));
    const app = buildApp();
    const cookie = await proxyCookie(app);
    const response = await app.request("/api/cockpit-proxy/api/fleet", {
      headers: { Cookie: cookie },
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("../login?next=fleet");
  });

  it("rejects absolute upstream redirects to another origin", async () => {
    fetchImpl.mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: "https://attacker.example/collect" },
    }));
    const app = buildApp();
    const cookie = await proxyCookie(app);
    const response = await app.request("/api/cockpit-proxy/api/fleet", {
      headers: { Cookie: cookie },
    });

    expect(response.status).toBe(502);
    expect(response.headers.get("location")).toBeNull();
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
