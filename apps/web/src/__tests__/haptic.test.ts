import { describe, it, expect, vi, beforeEach } from "vitest";
import { haptic } from "../lib/haptic";

// Mock getTelegramWebApp
let mockHapticFeedback: {
  impactOccurred: ReturnType<typeof vi.fn>;
  notificationOccurred: ReturnType<typeof vi.fn>;
  selectionChanged: ReturnType<typeof vi.fn>;
} | undefined;

vi.mock("../lib/telegram", () => ({
  getTelegramWebApp: () =>
    mockHapticFeedback
      ? { HapticFeedback: mockHapticFeedback }
      : { HapticFeedback: undefined },
}));

beforeEach(() => {
  mockHapticFeedback = {
    impactOccurred: vi.fn(),
    notificationOccurred: vi.fn(),
    selectionChanged: vi.fn(),
  };
});

describe("haptic — HapticFeedback present", () => {
  it("success() calls notificationOccurred('success')", () => {
    haptic.success();
    expect(mockHapticFeedback!.notificationOccurred).toHaveBeenCalledWith("success");
  });

  it("error() calls notificationOccurred('error')", () => {
    haptic.error();
    expect(mockHapticFeedback!.notificationOccurred).toHaveBeenCalledWith("error");
  });

  it("selection() calls selectionChanged()", () => {
    haptic.selection();
    expect(mockHapticFeedback!.selectionChanged).toHaveBeenCalled();
  });

  it("impact('medium') calls impactOccurred('medium')", () => {
    haptic.impact("medium");
    expect(mockHapticFeedback!.impactOccurred).toHaveBeenCalledWith("medium");
  });

  it("impact() defaults to 'light'", () => {
    haptic.impact();
    expect(mockHapticFeedback!.impactOccurred).toHaveBeenCalledWith("light");
  });
});

describe("haptic — HapticFeedback absent (older client)", () => {
  beforeEach(() => {
    mockHapticFeedback = undefined;
  });

  it("success() is a no-op", () => {
    expect(() => haptic.success()).not.toThrow();
  });

  it("error() is a no-op", () => {
    expect(() => haptic.error()).not.toThrow();
  });

  it("selection() is a no-op", () => {
    expect(() => haptic.selection()).not.toThrow();
  });

  it("impact() is a no-op", () => {
    expect(() => haptic.impact("medium")).not.toThrow();
  });
});
