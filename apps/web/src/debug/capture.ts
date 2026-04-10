/**
 * capture.ts — Bootstrap error capture for CPC debug overlay.
 *
 * MUST be called in main.tsx BEFORE createRoot().render() so it captures
 * errors that occur during module evaluation, initial render, and any
 * unhandled promise rejections from the very start.
 *
 * The entire module is guarded by a top-level try/catch and a hostname
 * gate. On production hostnames, installCapture() returns immediately
 * with zero side effects.
 */

import { scrubSecrets } from "./scrubber";

// --- Types ---

export interface DebugEntry {
  id: string;
  timestamp: number;
  type: "error" | "rejection";
  message: string;
  detail: string;
  source?: string;
}

// --- Configuration ---

const DEV_HOSTNAMES = ["localhost", "127.0.0.1", "cpc-dev.claude.do"];

/** Max entries in the ring buffer */
const MAX_ENTRIES = 500;

// --- Kill switches (module-level booleans, individually toggleable) ---

let captureOnerror = true;
let captureUnhandledRejection = true;

// --- Ring buffer store ---

const entries: DebugEntry[] = [];
let listeners: Array<() => void> = [];

function generateId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

function getTimestamp(): number {
  try {
    return performance.now();
  } catch {
    return Date.now();
  }
}

function pushEntry(entry: DebugEntry): void {
  if (entries.length >= MAX_ENTRIES) {
    entries.shift();
  }
  entries.push(entry);
  // Notify subscribers
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // never let a subscriber error break capture
    }
  }
}

// --- Public API ---

/** Check if the current hostname is in the dev allowlist */
export function isDevHost(): boolean {
  try {
    const hostname = window.location.hostname;
    return DEV_HOSTNAMES.includes(hostname);
  } catch {
    return false;
  }
}

/** Get current snapshot of captured entries (newest last) */
export function getEntries(): readonly DebugEntry[] {
  return entries;
}

/** Get current entry count */
export function getEntryCount(): number {
  return entries.length;
}

/** Clear all captured entries */
export function clearEntries(): void {
  entries.length = 0;
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // ignore
    }
  }
}

/** Subscribe to entry changes. Returns unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

/** Manually push a debug entry (used by ErrorBoundary bridge) */
export function pushDebug(partial: {
  type: DebugEntry["type"];
  message: string;
  detail?: string;
  source?: string;
}): void {
  if (!_installed) return;
  pushEntry({
    id: generateId(),
    timestamp: getTimestamp(),
    type: partial.type,
    message: scrubSecrets(partial.message),
    detail: scrubSecrets(partial.detail ?? ""),
    source: partial.source,
  });
}

// --- Bootstrap installation ---

let _installed = false;

/**
 * Install error capture listeners. Call this ONCE in main.tsx before
 * createRoot().render().
 *
 * Safe to call on any hostname — returns immediately on prod.
 * Wrapped in try/catch — cannot crash the app.
 */
export function installCapture(): void {
  try {
    // Hostname gate — on prod, do nothing
    if (!isDevHost()) return;

    // Kill-switch via URL hash
    if (window.location.hash.includes("cpc-debug-off")) return;

    // Kill-switch via localStorage
    try {
      if (localStorage.getItem("cpc-debug-disabled") === "1") return;
    } catch {
      // localStorage may be unavailable (private browsing) — continue
    }

    if (_installed) return;
    _installed = true;

    // Install window.onerror
    if (captureOnerror) {
      window.addEventListener("error", (event: ErrorEvent) => {
        try {
          const filename = event.filename || "";
          const lineno = event.lineno || 0;
          const colno = event.colno || 0;
          const location = filename ? `${filename}:${lineno}:${colno}` : "";
          pushEntry({
            id: generateId(),
            timestamp: getTimestamp(),
            type: "error",
            message: scrubSecrets(event.message || "Unknown error"),
            detail: scrubSecrets(
              event.error?.stack || location || "(no details)",
            ),
            source: location || undefined,
          });
        } catch {
          // Capture must never throw
        }
      });
    }

    // Install unhandledrejection
    if (captureUnhandledRejection) {
      window.addEventListener(
        "unhandledrejection",
        (event: PromiseRejectionEvent) => {
          try {
            const reason = event.reason;
            const message =
              reason instanceof Error
                ? reason.message
                : typeof reason === "string"
                  ? reason
                  : "Unhandled promise rejection";
            const detail =
              reason instanceof Error
                ? reason.stack || ""
                : typeof reason === "object" && reason !== null
                  ? safeStringify(reason)
                  : String(reason ?? "");
            pushEntry({
              id: generateId(),
              timestamp: getTimestamp(),
              type: "rejection",
              message: scrubSecrets(message),
              detail: scrubSecrets(detail),
            });
          } catch {
            // Capture must never throw
          }
        },
      );
    }
  } catch {
    // Top-level guard — if anything in bootstrap fails, the app still works.
    // _installed stays false so pushDebug becomes a no-op.
  }
}

/** Whether capture was successfully installed */
export function isCaptureInstalled(): boolean {
  return _installed;
}

/** Get kill-switch states */
export function getKillSwitchState(): {
  onerror: boolean;
  unhandledRejection: boolean;
} {
  return {
    onerror: captureOnerror,
    unhandledRejection: captureUnhandledRejection,
  };
}

/** Toggle kill switches (for programmatic control) */
export function setKillSwitches(opts: {
  onerror?: boolean;
  unhandledRejection?: boolean;
}): void {
  if (opts.onerror !== undefined) captureOnerror = opts.onerror;
  if (opts.unhandledRejection !== undefined)
    captureUnhandledRejection = opts.unhandledRejection;
}

// --- Helpers ---

function safeStringify(obj: unknown): string {
  try {
    const seen = new WeakSet();
    return JSON.stringify(obj, (_key, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    });
  } catch {
    return String(obj);
  }
}
