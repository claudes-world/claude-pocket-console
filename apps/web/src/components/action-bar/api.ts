import { getAuthHeaders } from "../../lib/telegram";
import type { AudioStatus, GitBranch, SearchResult, SessionName } from "./types";

async function jsonFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  return res.json() as Promise<T>;
}

export async function postAction(endpoint: string) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  const data = await res.json();
  return { ok: res.ok, ...data } as { ok: boolean; output?: string; error?: string };
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
  await fetch("/api/session/names", {
    method: "DELETE",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ts }),
  });
}

export async function fetchGitBranch() {
  const data = await jsonFetch<{ ok?: boolean; branch: string; treeType: string }>(
    "/api/terminal/git-branch",
    { headers: getAuthHeaders() },
  );
  return data.ok ? ({ branch: data.branch, treeType: data.treeType } as GitBranch) : null;
}

export async function sendToTmux(keys: string, raw = false) {
  await fetch("/api/terminal/send-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(raw ? { keys, raw: true } : { keys }),
  });
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

export async function searchFiles(query: string) {
  const data = await jsonFetch<{ results?: SearchResult[] }>(
    `/api/files/search?q=${encodeURIComponent(query)}`,
    { headers: getAuthHeaders() },
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
