import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { telegramAuth } from "../middleware.js";

const DEFAULT_INTERNAL_URL = "http://127.0.0.1:38847";
const PROXY_PREFIX = "/api/cockpit-proxy";
const SESSION_COOKIE = "cpc_cockpit_proxy";
const SESSION_TTL_SECONDS = 60 * 60;

const HOP_BY_HOP_HEADERS = [
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

interface CockpitProxyConfig {
  internalUrl: string;
  authToken: string;
}

interface CockpitProxyOptions {
  fetchImpl?: typeof fetch;
  getConfig?: () => CockpitProxyConfig;
  now?: () => number;
}

function defaultConfig(): CockpitProxyConfig {
  return {
    internalUrl: process.env.COCKPIT_INTERNAL_URL || DEFAULT_INTERNAL_URL,
    authToken: process.env.COCKPIT_AUTH_TOKEN || "",
  };
}

function configured(config: CockpitProxyConfig): boolean {
  if (!config.authToken) return false;
  try {
    const url = new URL(config.internalUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sessionSignature(expires: string, token: string): string {
  return createHmac("sha256", token)
    .update(`cpc-cockpit-proxy:${expires}`)
    .digest("base64url");
}

function makeSession(token: string, now: number): string {
  const expires = String(Math.floor(now / 1000) + SESSION_TTL_SECONDS);
  return `${expires}.${sessionSignature(expires, token)}`;
}

function validSession(value: string | undefined, token: string, now: number): boolean {
  if (!value || !token) return false;
  const separator = value.indexOf(".");
  if (separator <= 0) return false;
  const expires = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!/^\d+$/.test(expires) || Number(expires) <= Math.floor(now / 1000)) return false;

  const actual = Buffer.from(signature);
  const expected = Buffer.from(sessionSignature(expires, token));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function upstreamUrl(incoming: URL, internalUrl: string): URL {
  const base = new URL(internalUrl.endsWith("/") ? internalUrl : `${internalUrl}/`);
  const proxyPath = incoming.pathname.slice(PROXY_PREFIX.length).replace(/^\/+/, "");
  const target = new URL(proxyPath, base);
  target.search = incoming.search;
  return target;
}

function forwardedHeaders(incoming: Headers, authToken: string): Headers {
  const headers = new Headers(incoming);
  headers.delete("authorization");
  headers.delete("cookie");
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  headers.set("authorization", `Bearer ${authToken}`);
  return headers;
}

function rewriteCockpitHtml(html: string): string {
  // Cockpit currently keeps its CSS/JS inline, so relative future assets resolve
  // beneath the iframe's trailing-slash URL automatically. Its fetch/EventSource
  // calls are root-absolute, however; keep those on the authenticated proxy.
  return html.replace(/(["'])\/api\//g, `$1${PROXY_PREFIX}/api/`);
}

export function createCockpitProxyRoute(options: CockpitProxyOptions = {}) {
  const route = new Hono();
  const fetchImpl = options.fetchImpl ?? fetch;
  const getConfig = options.getConfig ?? defaultConfig;
  const now = options.now ?? Date.now;

  // An iframe navigation and EventSource cannot attach Telegram's tma header.
  // Bootstrap a narrow HttpOnly cookie from a normal authenticated CPC fetch,
  // then accept only that signed cookie (or the normal middleware) here.
  route.use("*", async (c, next) => {
    const config = getConfig();
    if (validSession(getCookie(c, SESSION_COOKIE), config.authToken, now())) {
      await next();
      return;
    }
    return telegramAuth(c, next);
  });

  route.get("/health", (c) => {
    const config = getConfig();
    const isConfigured = configured(config);
    if (isConfigured) {
      setCookie(c, SESSION_COOKIE, makeSession(config.authToken, now()), {
        httpOnly: true,
        maxAge: SESSION_TTL_SECONDS,
        path: PROXY_PREFIX,
        sameSite: "Strict",
        secure: process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test",
      });
    }
    return c.json({ configured: isConfigured });
  });

  route.all("*", async (c) => {
    const config = getConfig();
    if (!configured(config)) {
      return c.json({ error: "Cockpit proxy is not configured" }, 503);
    }

    const incoming = new URL(c.req.url);
    let target: URL;
    try {
      target = upstreamUrl(incoming, config.internalUrl);
    } catch {
      return c.json({ error: "Cockpit proxy is not configured" }, 503);
    }

    const method = c.req.method.toUpperCase();
    const init: RequestInit & { duplex?: "half" } = {
      method,
      headers: forwardedHeaders(c.req.raw.headers, config.authToken),
      redirect: "manual",
      signal: c.req.raw.signal,
    };
    if (method !== "GET" && method !== "HEAD") {
      init.body = c.req.raw.body;
      init.duplex = "half";
    }

    let upstream: Response;
    try {
      upstream = await fetchImpl(target, init);
    } catch {
      return c.json({ error: "Cockpit upstream unavailable" }, 502);
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const responseHeaders = new Headers({ "content-type": contentType });
    const cacheControl = upstream.headers.get("cache-control");
    if (cacheControl) responseHeaders.set("cache-control", cacheControl);

    if (contentType.toLowerCase().includes("text/html")) {
      const html = rewriteCockpitHtml(await upstream.text());
      return new Response(html, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    }

    // Passing the upstream ReadableStream directly preserves SSE and polling
    // response streaming without buffering live fleet data in CPC.
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  });

  return route;
}

export const cockpitProxyRoute = createCockpitProxyRoute();
