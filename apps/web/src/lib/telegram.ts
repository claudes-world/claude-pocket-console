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
 * Hand a download off to Telegram's native file downloader. Returns true when
 * the request was accepted by the SDK (Telegram then shows its own confirm
 * dialog and owns the rest of the flow).
 *
 * Inside Telegram's WebView a `<a download>` navigation does not save the file:
 * the WebView renders the response bytes inline as uncopyable text instead.
 * `downloadFile` is the only path that produces a real file, so callers should
 * prefer it and keep the anchor as a fallback for desktop/browser use.
 *
 * Returns false — rather than throwing — whenever the native path is
 * unavailable, because `downloadFile` throws on an unsupported client, a
 * non-https URL (e.g. local dev over http), or an already-open popup.
 */
export function requestTelegramDownload(url: string, fileName: string): boolean {
  const tg = getTelegramWebApp();
  if (typeof tg?.downloadFile !== "function") return false;
  if (!tg.isVersionAtLeast?.("8.0")) return false;
  if (!url.startsWith("https:")) return false;
  try {
    tg.downloadFile({ url, file_name: fileName });
    return true;
  } catch {
    return false;
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
