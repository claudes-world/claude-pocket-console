import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import type { Context, Next } from "hono";

/**
 * Auth middleware integration tests.
 *
 * Strategy: build a minimal Hono app with the real telegramAuth middleware
 * protecting a single test route, then drive it via `app.request()`.
 * The bot token is set via process.env so HMAC validation works end-to-end
 * against a known secret — no crypto mocking needed.
 */

const TEST_BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
const TEST_USER_ID = "999111";
const TEST_USER = { id: 999111, first_name: "TestUser" };

let savedBotToken: string | undefined;
let savedAllowed: string | undefined;

beforeAll(() => {
  savedBotToken = process.env.TELEGRAM_BOT_TOKEN;
  savedAllowed = process.env.ALLOWED_TELEGRAM_USERS;
  process.env.TELEGRAM_BOT_TOKEN = TEST_BOT_TOKEN;
  process.env.ALLOWED_TELEGRAM_USERS = TEST_USER_ID;
});

afterAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = savedBotToken;
  process.env.ALLOWED_TELEGRAM_USERS = savedAllowed;
});

// Import after env setup so the module picks up our token.
const { telegramAuth } = await import("../../middleware.js");

function buildApp(): Hono {
  const app = new Hono();
  // Public health endpoint — no auth
  app.get("/api/health", (c) => c.json({ status: "ok" }));
  // Auth middleware for /api/*
  app.use("/api/*", telegramAuth);
  // Protected test endpoint
  app.get("/api/test", (c) => c.json({ ok: true }));
  // Download endpoint — ticket bypass tested here
  app.get("/api/files/download", (c) => c.json({ download: true }));
  return app;
}

/** Build valid Telegram Mini App initData with a correct HMAC. */
function makeInitData(
  user: object,
  overrides?: { botToken?: string; extraParams?: Record<string, string> },
): string {
  const token = overrides?.botToken ?? TEST_BOT_TOKEN;
  const params = new URLSearchParams();
  params.set("user", JSON.stringify(user));
  params.set("auth_date", String(Math.floor(Date.now() / 1000)));
  if (overrides?.extraParams) {
    for (const [k, v] of Object.entries(overrides.extraParams)) {
      params.set(k, v);
    }
  }

  // Build data_check_string: sorted key=value pairs joined by \n
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${key}=${val}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  params.set("hash", hash);
  return params.toString();
}

/** Build a minimal JWT signed with the bot token. */
function makeJwt(
  sub: string,
  opts?: { exp?: number; botToken?: string },
): string {
  const token = opts?.botToken ?? TEST_BOT_TOKEN;
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub, exp: opts?.exp ?? Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  const sig = createHmac("sha256", token)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
}

const app = buildApp();

describe("telegramAuth middleware", () => {
  describe("public endpoints bypass auth", () => {
    it("GET /api/health returns 200 without any auth headers", async () => {
      const res = await app.request("/api/health");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: "ok" });
    });
  });

  describe("missing auth rejects", () => {
    it("returns 401 when no Authorization header is provided", async () => {
      const res = await app.request("/api/test");
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Missing Telegram auth");
    });

    it("returns 401 for an empty Authorization header", async () => {
      const res = await app.request("/api/test", {
        headers: { Authorization: "" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 for an unrecognized auth scheme", async () => {
      const res = await app.request("/api/test", {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("tma initData validation", () => {
    it("accepts valid initData with an allowed user", async () => {
      const initData = makeInitData(TEST_USER);
      const res = await app.request("/api/test", {
        headers: { Authorization: `tma ${initData}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    });

    it("rejects initData with a wrong HMAC (tampered payload)", async () => {
      const initData = makeInitData(TEST_USER);
      // Flip a character in the hash to simulate tampering
      const tampered = initData.replace(/hash=([0-9a-f])/, "hash=Z");
      const res = await app.request("/api/test", {
        headers: { Authorization: `tma ${tampered}` },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Invalid Telegram auth");
    });

    it("rejects initData signed with a different bot token", async () => {
      const initData = makeInitData(TEST_USER, {
        botToken: "999999:WRONG-TOKEN-xxxxxx",
      });
      const res = await app.request("/api/test", {
        headers: { Authorization: `tma ${initData}` },
      });
      expect(res.status).toBe(401);
    });

    it("rejects initData with no hash parameter", async () => {
      const params = new URLSearchParams();
      params.set("user", JSON.stringify(TEST_USER));
      params.set("auth_date", String(Math.floor(Date.now() / 1000)));
      // Intentionally omit hash
      const res = await app.request("/api/test", {
        headers: { Authorization: `tma ${params.toString()}` },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("allowlist enforcement", () => {
    it("rejects a valid initData from a non-allowed user ID", async () => {
      const nonAllowedUser = { id: 777888, first_name: "Intruder" };
      const initData = makeInitData(nonAllowedUser);
      const res = await app.request("/api/test", {
        headers: { Authorization: `tma ${initData}` },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("User not authorized");
    });
  });

  describe("Bearer JWT validation", () => {
    it("accepts a valid JWT for an allowed user", async () => {
      const jwt = makeJwt(TEST_USER_ID);
      const res = await app.request("/api/test", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).toBe(200);
    });

    it("rejects an expired JWT", async () => {
      const jwt = makeJwt(TEST_USER_ID, { exp: Math.floor(Date.now() / 1000) - 3600 });
      const res = await app.request("/api/test", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Invalid or expired token");
    });

    it("rejects a JWT signed with the wrong secret", async () => {
      const jwt = makeJwt(TEST_USER_ID, { botToken: "999999:WRONG" });
      const res = await app.request("/api/test", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).toBe(401);
    });

    it("rejects a JWT for a non-allowed user", async () => {
      const jwt = makeJwt("777888");
      const res = await app.request("/api/test", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).toBe(403);
    });
  });

  describe("query param token fallback", () => {
    it("accepts a valid JWT passed as ?token= query param", async () => {
      const jwt = makeJwt(TEST_USER_ID);
      const res = await app.request(`/api/test?token=${jwt}`);
      expect(res.status).toBe(200);
    });
  });

  describe("server misconfiguration", () => {
    it("returns 500 when TELEGRAM_BOT_TOKEN is missing", async () => {
      const original = process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_BOT_TOKEN;
      try {
        const res = await app.request("/api/test", {
          headers: { Authorization: "tma anything" },
        });
        expect(res.status).toBe(500);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("missing bot token");
      } finally {
        process.env.TELEGRAM_BOT_TOKEN = original;
      }
    });
  });

  describe("ticket format bypass (issue #225)", () => {
    it("bypasses auth for a valid hex-32 ticket on /api/files/download", async () => {
      const res = await app.request(
        "/api/files/download?ticket=deadbeef00000000deadbeef00000000",
      );
      // Middleware lets it through — route responds 200
      expect(res.status).toBe(200);
    });

    it("rejects non-hex-32 ticket values (too short)", async () => {
      const res = await app.request("/api/files/download?ticket=abc123");
      // Middleware does NOT bypass — requires auth → 401
      expect(res.status).toBe(401);
    });

    it("rejects non-hex-32 ticket values (uppercase hex)", async () => {
      const res = await app.request(
        "/api/files/download?ticket=DEADBEEF00000000DEADBEEF00000000",
      );
      expect(res.status).toBe(401);
    });

    it("rejects non-hex-32 ticket values (contains non-hex chars)", async () => {
      const res = await app.request(
        "/api/files/download?ticket=zzzzzzzz00000000zzzzzzzz00000000",
      );
      expect(res.status).toBe(401);
    });

    it("rejects non-hex-32 ticket values (too long)", async () => {
      const res = await app.request(
        "/api/files/download?ticket=deadbeef00000000deadbeef00000000extra",
      );
      expect(res.status).toBe(401);
    });

    it("rejects empty ticket parameter", async () => {
      const res = await app.request("/api/files/download?ticket=");
      expect(res.status).toBe(401);
    });
  });

  describe("initData auth_date expiry (issue #227)", () => {
    it("rejects initData with auth_date older than 24 hours", async () => {
      const staleAuthDate = String(Math.floor(Date.now() / 1000) - 86401);
      const initData = makeInitData(TEST_USER, {
        extraParams: { auth_date: staleAuthDate },
      });
      const res = await app.request("/api/test", {
        headers: { Authorization: `tma ${initData}` },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Invalid Telegram auth");
    });

    it("accepts initData with auth_date within 24 hours", async () => {
      // makeInitData already sets auth_date to now — just verify it works
      const initData = makeInitData(TEST_USER);
      const res = await app.request("/api/test", {
        headers: { Authorization: `tma ${initData}` },
      });
      expect(res.status).toBe(200);
    });

    it("rejects initData with auth_date=notanumber (NaN bypass)", async () => {
      const initData = makeInitData(TEST_USER, {
        extraParams: { auth_date: "notanumber" },
      });
      const res = await app.request("/api/test", {
        headers: { Authorization: `tma ${initData}` },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Invalid Telegram auth");
    });

    it("rejects initData with auth_date absent (missing field)", async () => {
      // Build initData manually without auth_date
      const token = TEST_BOT_TOKEN;
      const params = new URLSearchParams();
      params.set("user", JSON.stringify(TEST_USER));
      // auth_date intentionally omitted
      const dataCheckString = Array.from(params.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => `${key}=${val}`)
        .join("\n");
      const { createHmac: hmac } = await import("node:crypto");
      const secretKey = hmac("sha256", "WebAppData").update(token).digest();
      const hash = hmac("sha256", secretKey).update(dataCheckString).digest("hex");
      params.set("hash", hash);
      const res = await app.request("/api/test", {
        headers: { Authorization: `tma ${params.toString()}` },
      });
      expect(res.status).toBe(401);
    });

    it("rejects initData with a far-future auth_date (year 2099)", async () => {
      // 2099-01-01T00:00:00Z as unix timestamp
      const futureAuthDate = String(4070908800);
      const initData = makeInitData(TEST_USER, {
        extraParams: { auth_date: futureAuthDate },
      });
      const res = await app.request("/api/test", {
        headers: { Authorization: `tma ${initData}` },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("ticket newline bypass (security hardening)", () => {
    it("rejects a ticket with a trailing newline (URL-encoded %0A)", async () => {
      // ticket is 32 valid hex chars + a newline — middleware must reject it
      const res = await app.request(
        "/api/files/download?ticket=deadbeef00000000deadbeef00000000%0A",
      );
      // Middleware does NOT bypass — requires auth → 401
      expect(res.status).toBe(401);
    });
  });

  describe("ambiguous ticket+path requests", () => {
    it("returns 400 when both ?ticket= and ?path= are present", async () => {
      const res = await app.request(
        "/api/files/download?ticket=deadbeef00000000deadbeef00000000&path=/some/file.txt",
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/ambiguous/i);
    });

    it("returns 400 when ?ticket= is empty string but ?path= is present", async () => {
      // Empty-string ticket value: key is present so the guard must fire.
      // A truthiness check (ticket && filePath) would miss this case.
      const res = await app.request(
        "/api/files/download?ticket=&path=/some/file.txt",
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/ambiguous/i);
    });

    it("returns 400 when ?ticket= is present but ?path= is empty string", async () => {
      const res = await app.request(
        "/api/files/download?ticket=deadbeef00000000deadbeef00000000&path=",
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/ambiguous/i);
    });
  });
});
