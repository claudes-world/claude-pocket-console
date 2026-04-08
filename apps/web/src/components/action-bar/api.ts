import { getAuthHeaders } from "../../lib/telegram";
import type { AudioStatus, GitBranch, SearchResult, SessionName } from "./types";

async function jsonFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    // On 4xx/5xx, try to extract a structured server error from the JSON
    // body before falling back to status text. This preserves actionable
    // messages like `{ ok: false, error: "File is empty" }` that routes
    // return on failure, while still handling non-JSON error pages (HTML
    // from a reverse proxy, for example) without throwing a SyntaxError
    // on res.json(). (Gemini round-3: non-JSON error. Codex round-4:
    // don't lose structured error bodies.)
    let serverError: string | undefined;
    try {
      const body = (await res.json()) as { error?: string };
      if (body && typeof body.error === "string") serverError = body.error;
    } catch {
      // Body wasn't JSON — fall through to generic status-text error.
    }
    throw new Error(serverError ?? `Request failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function postAction(endpoint: string) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  const data = await res.json();
  // Derive `ok` explicitly so a JSON `ok` field in the body cannot override
  // the HTTP status — and so it can't arrive as `undefined` either. A false
  // `data.ok` is respected (server says "http 200 but operationally failed"),
  // but a missing one falls back to `res.ok`. (Copilot round-2 review.)
  const ok = res.ok && data.ok !== false;
  return { ...data, ok } as { ok: boolean; output?: string; error?: string };
}

export async function fetchGitStatus() {
  const data = await jsonFetch<{ output?: string }>("/api/terminal/git-status", {
    headers: getAuthHeaders(),
  });
  return data.output || "No output";
}

export async function fetchTodo() {
  const data = await jsonFetch<{ content?: string }>("/api/todo", { headers: getAuthHeaders() });
  return data.content || "No TODO.md found";
}

export async function fetchSessionNames() {
  const data = await jsonFetch<{ names?: SessionName[] }>("/api/session/names", {
    headers: getAuthHeaders(),
  });
  return data.names || [];
}

export async function deleteSessionName(ts: number) {
  // fetch() only rejects on network errors, so a 4xx/5xx would otherwise
  // resolve successfully and the UI would optimistically filter the row
  // out — only for it to reappear on the next page load because the
  // server never actually deleted it. Check res.ok and throw with any
  // structured server error body so callers' catch blocks surface the
  // real failure. (Copilot PR #106 review; mirrors the jsonFetch pattern
  // from PR #98 round 4 split B1 above.)
  const res = await fetch("/api/session/names", {
    method: "DELETE",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ts }),
  });
  if (!res.ok) {
    let serverError: string | undefined;
    try {
      const body = (await res.json()) as { error?: string };
      if (body && typeof body.error === "string") serverError = body.error;
    } catch {
      // Body wasn't JSON — fall through to generic status-text error.
    }
    throw new Error(serverError ?? `Request failed: ${res.status} ${res.statusText}`);
  }
}

export async function fetchGitBranch() {
  const data = await jsonFetch<{ ok?: boolean; branch: string; treeType: string }>(
    "/api/terminal/git-branch",
    { headers: getAuthHeaders() },
  );
  return data.ok ? ({ branch: data.branch, treeType: data.treeType } as GitBranch) : null;
}

export async function sendToTmux(keys: string, raw = false) {
  // Most callers fire-and-forget via `void sendToTmux(...)`. Swallow fetch
  // failures here so those call sites don't produce unhandled promise
  // rejections in the browser. The API itself doesn't return a useful
  // success signal — it's best-effort "type this into the tmux pane".
  // (Copilot round-2 review.)
  try {
    await fetch("/api/terminal/send-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify(raw ? { keys, raw: true } : { keys }),
    });
  } catch (err) {
    // Swallowed so fire-and-forget callers don't throw unhandled rejections,
    // but log so the failure is still traceable in the browser console.
    console.error("sendToTmux failed:", err);
  }
}

export async function sendCompactCommand(message: string) {
  return jsonFetch<{ ok?: boolean; error?: string }>("/api/terminal/compact", {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

export async function renameSession(name: string) {
  return jsonFetch<{ ok?: boolean; error?: string }>("/api/session/rename", {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function runGitCommand(command: string) {
  const data = await jsonFetch<{ output?: string }>("/api/terminal/git-command", {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });
  return data.output || "No output";
}

export async function searchFiles(query: string, signal?: AbortSignal, scope?: string | null) {
  const scopeParam = scope ? `&scope=${encodeURIComponent(scope)}` : "";
  const data = await jsonFetch<{ results?: SearchResult[] }>(
    `/api/files/search?q=${encodeURIComponent(query)}${scopeParam}`,
    { headers: getAuthHeaders(), signal },
  );
  return data.results || [];
}

export async function checkAudio(filePath: string) {
  const data = await jsonFetch<AudioStatus & { exists: boolean }>(
    `/api/audio/check?path=${encodeURIComponent(filePath)}`,
    { headers: getAuthHeaders() },
  );
  return { exists: data.exists, path: data.path };
}

export async function generateAudio(filePath: string, signal: AbortSignal) {
  return jsonFetch<{ ok?: boolean; path?: string; error?: string }>("/api/audio/generate", {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath }),
    signal,
  });
}

export async function sendAudioTelegram(path: string, signal: AbortSignal) {
  return jsonFetch<{ ok?: boolean; error?: string }>("/api/audio/send-telegram", {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
    signal,
  });
}

export async function summarizeMarkdown(path: string, force: boolean, signal: AbortSignal) {
  return jsonFetch<{ ok?: boolean; summary?: string; cached?: boolean; ms?: number; error?: string }>(
    "/api/markdown/summarize",
    {
      method: "POST",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ path, force }),
      signal,
    },
  );
}

export async function restartSession() {
  return jsonFetch<{ ok?: boolean; error?: string }>("/api/terminal/restart-session", {
    method: "POST",
    headers: getAuthHeaders(),
  });
}

export async function sendFileToChat(filePath: string) {
  return jsonFetch<{ ok?: boolean }>("/api/telegram/send-to-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ filePath }),
  });
}
