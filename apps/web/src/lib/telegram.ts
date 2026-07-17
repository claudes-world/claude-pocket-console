declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
  };
  ready(): void;
  expand(): void;
  close(): void;
  MainButton: {
    text: string;
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
  };
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
  };
  themeParams: Record<string, string>;
  colorScheme: "light" | "dark";
  isExpanded: boolean;
  version?: string;
  isVersionAtLeast?(version: string): boolean;
  /** Bot API 8.0+. Throws when unsupported, when `url` is not https, or when a
   *  download popup is already open — always call via `requestTelegramDownload`. */
  downloadFile?(
    params: { url: string; file_name: string },
    callback?: (accepted: boolean) => void,
  ): void;
  checkHomeScreenStatus?(callback: (status: "added" | "missed" | "unknown") => void): void;
  addToHomeScreen?(): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function getInitData(): string {
  return window.Telegram?.WebApp?.initData ?? "";
}

/**
 * - `handed-off`: Telegram accepted it and now owns the flow (its own confirm
 *   dialog, its own downloader).
 * - `busy`: we ARE in a capable Telegram client, but it refused this call right
 *   now — in practice because a download popup is already open.
 * - `unsupported`: no Telegram, too old, or a URL its downloader won't take.
 */
export type TelegramDownloadOutcome = "handed-off" | "busy" | "unsupported";

/**
 * Hand a download off to Telegram's native file downloader.
 *
 * Inside Telegram's WebView a `<a download>` navigation does not save the file:
 * the WebView renders the response bytes inline as uncopyable text instead.
 * `downloadFile` is the only path that produces a real file, so callers should
 * prefer it and keep the anchor strictly for non-Telegram browsers.
 *
 * Never throws, though `downloadFile` does — on an unsupported client, a
 * non-https URL (e.g. local dev over http), or an already-open popup.
 *
 * The `busy` case matters: once the capability and https gates pass we know we
 * are inside a Telegram WebView, where the anchor is broken by definition. A
 * caller that treated a refusal as "fall back to the anchor" would re-trigger
 * the very inline-render bug this function exists to avoid — so a throw past
 * those gates is reported as `busy`, never as `unsupported`.
 */
export function requestTelegramDownload(url: string, fileName: string): TelegramDownloadOutcome {
  const tg = getTelegramWebApp();
  if (typeof tg?.downloadFile !== "function") return "unsupported";
  if (!tg.isVersionAtLeast?.("8.0")) return "unsupported";
  if (!url.startsWith("https:")) return "unsupported";
  try {
    tg.downloadFile({ url, file_name: fileName });
    return "handed-off";
  } catch (err) {
    // Deliberately not classified by error content — matching on message text
    // would be brittle. But that means a throw which is genuinely "this client
    // won't take this request" is reported as `busy` and does nothing visible.
    // We cannot see inside Telegram's downloader, so leave a breadcrumb: if a
    // tap ever appears to do nothing on-device, this is the only evidence.
    console.debug("[cpc] Telegram declined downloadFile; treating as busy", err);
    return "busy";
  }
}

export function getUrlToken(): string {
  const params = new URLSearchParams(window.location.search);
  // Also check hash params for Voice button URL format (#voice&token=...)
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#[^&]*&?/, ""));
  return params.get("token") || hashParams.get("token") || "";
}

export function getAuthHeaders(): Record<string, string> {
  const initData = getInitData();
  if (initData) return { Authorization: `tma ${initData}` };

  // Fallback: URL token from keyboard button
  const urlToken = getUrlToken();
  if (urlToken) return { Authorization: `Bearer ${urlToken}` };

  // Fallback: saved session token from Login Widget
  const sessionToken = localStorage.getItem("cpc-session-token");
  if (sessionToken) return { Authorization: `Bearer ${sessionToken}` };

  return {};
}

export function setSessionToken(token: string) {
  localStorage.setItem("cpc-session-token", token);
}

export function clearSessionToken() {
  localStorage.removeItem("cpc-session-token");
}

export function hasAuth(): boolean {
  return !!(getInitData() || getUrlToken() || localStorage.getItem("cpc-session-token"));
}
