import { describe, it, expect, vi, afterEach } from "vitest";
import { requestTelegramDownload } from "../telegram";

const HTTPS_URL = "https://cpc.claude.do/api/files/download?ticket=abc";

/** Install a fake WebApp. `downloadFile` defaults to a spy that succeeds. */
function stubWebApp(overrides: Record<string, unknown> = {}) {
  const downloadFile = vi.fn();
  const webApp = {
    isVersionAtLeast: () => true,
    downloadFile,
    ...overrides,
  };
  (window as unknown as { Telegram?: unknown }).Telegram = { WebApp: webApp };
  return { downloadFile };
}

afterEach(() => {
  delete (window as unknown as { Telegram?: unknown }).Telegram;
});

describe("requestTelegramDownload (WORLD-375)", () => {
  it("hands the download to Telegram and reports it was taken", () => {
    const { downloadFile } = stubWebApp();

    expect(requestTelegramDownload(HTTPS_URL, "README.md")).toBe(true);
    expect(downloadFile).toHaveBeenCalledWith({
      url: HTTPS_URL,
      file_name: "README.md",
    });
  });

  it("declines when Telegram is absent entirely (plain browser)", () => {
    expect(requestTelegramDownload(HTTPS_URL, "README.md")).toBe(false);
  });

  it("declines when the client is older than Bot API 8.0", () => {
    // downloadFile throws on such clients, so the version gate must come first.
    const { downloadFile } = stubWebApp({ isVersionAtLeast: () => false });

    expect(requestTelegramDownload(HTTPS_URL, "README.md")).toBe(false);
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it("declines when the client predates isVersionAtLeast", () => {
    const { downloadFile } = stubWebApp({ isVersionAtLeast: undefined });

    expect(requestTelegramDownload(HTTPS_URL, "README.md")).toBe(false);
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it("declines when downloadFile is missing from the SDK", () => {
    stubWebApp({ downloadFile: undefined });

    expect(requestTelegramDownload(HTTPS_URL, "README.md")).toBe(false);
  });

  it("declines a non-https URL instead of letting downloadFile throw", () => {
    // Local dev is served over http; downloadFile rejects any non-https url.
    const { downloadFile } = stubWebApp();

    expect(
      requestTelegramDownload("http://localhost:58830/api/files/download?ticket=abc", "README.md"),
    ).toBe(false);
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it("declines rather than propagating a throw from downloadFile", () => {
    // e.g. WebAppDownloadFilePopupOpened when a dialog is already up.
    stubWebApp({
      downloadFile: vi.fn(() => {
        throw new Error("WebAppDownloadFilePopupOpened");
      }),
    });

    expect(requestTelegramDownload(HTTPS_URL, "README.md")).toBe(false);
  });
});
