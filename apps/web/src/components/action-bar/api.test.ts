import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/telegram", () => ({
  getAuthHeaders: () => ({ Authorization: "tma test" }),
}));

import {
  checkReadingListPaths,
  deleteReadingListItem,
  fetchReadingList,
  saveReadingListItem,
} from "./api";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("reading-list API helpers", () => {
  it("matches the save, list, check, and delete contracts", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, id: 17 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: 17, path: "/tmp/a.ts", title: "a.ts", created_at: 123 }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ saved: { "/tmp/a.ts": true, "/tmp/b.ts": false } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(saveReadingListItem("/tmp/a.ts", "a.ts")).resolves.toEqual({ ok: true, id: 17 });
    await expect(fetchReadingList()).resolves.toEqual({
      items: [{ id: 17, path: "/tmp/a.ts", title: "a.ts", created_at: 123 }],
    });
    await expect(checkReadingListPaths(["/tmp/a.ts", "/tmp/b.ts"])).resolves.toEqual({
      saved: { "/tmp/a.ts": true, "/tmp/b.ts": false },
    });
    await expect(deleteReadingListItem({ id: 17 })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/reading-list/save", expect.objectContaining({
      method: "POST",
      headers: { Authorization: "tma test", "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/tmp/a.ts", title: "a.ts" }),
      signal: expect.any(AbortSignal),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/reading-list/list", expect.objectContaining({
      headers: { Authorization: "tma test" },
      signal: expect.any(AbortSignal),
    }));
    expect(fetchMock.mock.calls[2][0]).toBe("/api/reading-list/check?paths=%2Ftmp%2Fa.ts&paths=%2Ftmp%2Fb.ts");
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/reading-list/delete", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ id: 17 }),
      signal: expect.any(AbortSignal),
    }));
  });

  it("surfaces structured server errors", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Access denied" }), {
      status: 403,
      statusText: "Forbidden",
    }));

    await expect(saveReadingListItem("/etc/passwd")).rejects.toThrow("Access denied");
  });

  it("falls back to HTTP status for non-JSON errors", async () => {
    fetchMock.mockResolvedValue(new Response("bad gateway", { status: 502, statusText: "Bad Gateway" }));

    await expect(fetchReadingList()).rejects.toThrow("Request failed: 502 Bad Gateway");
  });
});
