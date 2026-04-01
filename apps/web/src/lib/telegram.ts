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

export function getAuthHeaders(): Record<string, string> {
  const initData = getInitData();
  if (initData) return { Authorization: `tma ${initData}` };

  // Fallback: check for saved session token from Login Widget
  const token = localStorage.getItem("cpc-session-token");
  if (token) return { Authorization: `Bearer ${token}` };

  return {};
}

export function setSessionToken(token: string) {
  localStorage.setItem("cpc-session-token", token);
}

export function clearSessionToken() {
  localStorage.removeItem("cpc-session-token");
}

export function hasAuth(): boolean {
  return !!(getInitData() || localStorage.getItem("cpc-session-token"));
}
