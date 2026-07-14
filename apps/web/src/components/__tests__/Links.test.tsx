import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Links } from "../Links";

vi.mock("../ReadingList", () => ({ ReadingList: () => null }));
vi.mock("../../lib/telegram", () => ({
  getAuthHeaders: () => ({ Authorization: "tma test-init-data" }),
  getTelegramWebApp: () => null,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "#links");
});

describe("Fleet Cockpit link", () => {
  it("uses the internal SPA route when the authenticated proxy is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ configured: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<Links onClose={vi.fn()} onOpenFile={vi.fn()} />);

    const link = screen.getByRole("link", { name: /Fleet Cockpit/ });
    await waitFor(() => expect(link).toHaveAttribute("href", "#/cockpit"));
    expect(link).not.toHaveAttribute("target");
    expect(fetchMock).toHaveBeenCalledWith("/api/cockpit-proxy/health", {
      headers: { Authorization: "tma test-init-data" },
      credentials: "same-origin",
    });

    fireEvent.click(link);
    expect(window.location.hash).toBe("#/cockpit");
  });

  it("retains the external-tab fallback when the proxy is disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ configured: false }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<Links onClose={vi.fn()} onOpenFile={vi.fn()} />);

    const link = screen.getByRole("link", { name: /Fleet Cockpit/ });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(link).toHaveAttribute("href", "https://cockpit.claude.do");
    expect(link).toHaveAttribute("target", "_blank");
  });
});

describe("Vault Explorer link", () => {
  it("always uses the local vault route without waiting for server configuration", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<Links onClose={vi.fn()} onOpenFile={vi.fn()} />);

    const link = screen.getByRole("link", { name: /Vault Explorer/ });
    expect(link).toHaveAttribute("href", "#/vault");
    expect(link).not.toHaveAttribute("target");

    fireEvent.click(link);
    expect(window.location.hash).toBe("#/vault");
  });
});
