import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CockpitPage } from "../CockpitPage";

const { backButton } = vi.hoisted(() => ({
  backButton: {
    hide: vi.fn(),
    offClick: vi.fn(),
    onClick: vi.fn(),
    show: vi.fn(),
  },
}));

vi.mock("../../lib/telegram", () => ({
  getAuthHeaders: () => ({ Authorization: "tma test-init-data" }),
  getTelegramWebApp: () => ({ BackButton: backButton }),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("CockpitPage", () => {
  it("refreshes proxy auth, renders the iframe, and owns Telegram BackButton", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ configured: true }),
    }));
    const onBack = vi.fn();
    const { unmount } = render(<CockpitPage onBack={onBack} />);

    expect(backButton.show).toHaveBeenCalledOnce();
    expect(backButton.onClick).toHaveBeenCalledWith(onBack);
    await waitFor(() => expect(screen.getByTitle("Fleet Cockpit")).toHaveAttribute(
      "src",
      "/api/cockpit-proxy/",
    ));

    act(() => {
      const callback = backButton.onClick.mock.calls[0][0];
      callback();
    });
    expect(onBack).toHaveBeenCalledOnce();

    unmount();
    expect(backButton.offClick).toHaveBeenCalledWith(onBack);
    expect(backButton.hide).toHaveBeenCalledOnce();
  });
});
