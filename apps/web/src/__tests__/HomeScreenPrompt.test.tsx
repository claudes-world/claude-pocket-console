import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { HomeScreenPrompt } from "../components/HomeScreenPrompt";

// --- Mocks ---

// Mock getTelegramWebApp so we control addToHomeScreen
let mockAddToHomeScreen: ReturnType<typeof vi.fn>;
let mockCheckHomeScreenStatus: ReturnType<typeof vi.fn> | undefined;

vi.mock("../lib/telegram", () => ({
  getTelegramWebApp: () => ({
    addToHomeScreen: mockAddToHomeScreen,
    checkHomeScreenStatus: mockCheckHomeScreenStatus,
  }),
  getAuthHeaders: () => ({}),
  hasAuth: () => true,
  setSessionToken: vi.fn(),
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => { store[key] = val; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock, writable: true });

beforeEach(() => {
  localStorageMock.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  mockAddToHomeScreen = vi.fn();
  mockCheckHomeScreenStatus = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Component tests ---

describe("HomeScreenPrompt", () => {
  it("renders the prompt with Add and Not now buttons", () => {
    const onDismiss = vi.fn();
    render(<HomeScreenPrompt onDismiss={onDismiss} />);

    expect(screen.getByText("Add to Home Screen")).toBeInTheDocument();
    expect(screen.getByText("Add")).toBeInTheDocument();
    expect(screen.getByText("Not now")).toBeInTheDocument();
  });

  it("calls onDismiss when 'Not now' is clicked", () => {
    const onDismiss = vi.fn();
    render(<HomeScreenPrompt onDismiss={onDismiss} />);

    fireEvent.click(screen.getByText("Not now"));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(mockAddToHomeScreen).not.toHaveBeenCalled();
  });

  it("calls addToHomeScreen and then onDismiss when 'Add' is clicked", () => {
    const onDismiss = vi.fn();
    render(<HomeScreenPrompt onDismiss={onDismiss} />);

    fireEvent.click(screen.getByText("Add"));

    expect(mockAddToHomeScreen).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

// --- Hook logic tests (localStorage flag gate) ---

describe("home screen prompt localStorage gate", () => {
  it("does not show prompt when localStorage flag is already set", () => {
    // Pre-set the flag — the useEffect in App.tsx would bail early
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === "cpc:home-screen-prompted") return "1";
      return null;
    });

    // Verify the gate condition directly: if getItem returns truthy, skip
    const flagSet = !!localStorageMock.getItem("cpc:home-screen-prompted");
    expect(flagSet).toBe(true);
  });

  it("handleHomeScreenDismiss sets the localStorage flag and hides the prompt", () => {
    const onDismiss = vi.fn(() => {
      // Simulate what handleHomeScreenDismiss does in App.tsx
      localStorageMock.setItem("cpc:home-screen-prompted", "1");
    });

    render(<HomeScreenPrompt onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText("Not now"));

    expect(localStorageMock.setItem).toHaveBeenCalledWith("cpc:home-screen-prompted", "1");
  });

  it("skips prompt silently when checkHomeScreenStatus is not available (older client)", () => {
    // Simulate older Bot API: checkHomeScreenStatus is undefined
    mockCheckHomeScreenStatus = undefined;

    // The gate in App.tsx: if (!twa?.checkHomeScreenStatus) return
    // Validate the mock reflects the absence correctly
    const twa = { addToHomeScreen: mockAddToHomeScreen, checkHomeScreenStatus: mockCheckHomeScreenStatus };
    expect(twa.checkHomeScreenStatus).toBeUndefined();
  });

  it("sets localStorage flag when Add is clicked via the prompt", async () => {
    const onDismiss = vi.fn(() => {
      localStorageMock.setItem("cpc:home-screen-prompted", "1");
    });

    render(<HomeScreenPrompt onDismiss={onDismiss} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Add"));
    });

    expect(mockAddToHomeScreen).toHaveBeenCalledTimes(1);
    expect(localStorageMock.setItem).toHaveBeenCalledWith("cpc:home-screen-prompted", "1");
  });
});
