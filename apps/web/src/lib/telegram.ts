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
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function getInitData(): string {
  return window.Telegram?.WebApp?.initData ?? "";
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
