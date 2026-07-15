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

    expect(requestTelegramDownload(HTTPS_URL, "README.md")).toBe("handed-off");
    expect(downloadFile).toHaveBeenCalledWith({
      url: HTTPS_URL,
      file_name: "README.md",
    });
  });

  it("reports unsupported when Telegram is absent entirely (plain browser)", () => {
    expect(requestTelegramDownload(HTTPS_URL, "README.md")).toBe("unsupported");
  });

  it("reports unsupported when the client is older than Bot API 8.0", () => {
    // downloadFile throws on such clients, so the version gate must come first.
    const { downloadFile } = stubWebApp({ isVersionAtLeast: () => false });

    expect(requestTelegramDownload(HTTPS_URL, "README.md")).toBe("unsupported");
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it("reports unsupported when the client predates isVersionAtLeast", () => {
    const { downloadFile } = stubWebApp({ isVersionAtLeast: undefined });

    expect(requestTelegramDownload(HTTPS_URL, "README.md")).toBe("unsupported");
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it("reports unsupported when downloadFile is missing from the SDK", () => {
    stubWebApp({ downloadFile: undefined });

    expect(requestTelegramDownload(HTTPS_URL, "README.md")).toBe("unsupported");
  });

  it("reports unsupported for a non-https URL instead of letting downloadFile throw", () => {
    // Local dev is served over http; downloadFile rejects any non-https url.
    const { downloadFile } = stubWebApp();

    expect(
      requestTelegramDownload("http://localhost:58830/api/files/download?ticket=abc", "README.md"),
    ).toBe("unsupported");
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it("reports busy — NOT unsupported — when a download popup is already open", () => {
    // The distinction is load-bearing: we are inside a capable Telegram client
    // here, where the anchor fallback is broken. Reporting "unsupported" would
    // send the caller down that path and reproduce WORLD-375 on a double-tap.
    stubWebApp({
      downloadFile: vi.fn(() => {
        throw new Error("WebAppDownloadFilePopupOpened");
      }),
    });

    expect(requestTelegramDownload(HTTPS_URL, "README.md")).toBe("busy");
  });

  it("reports busy for any other throw from a capable client", () => {
    stubWebApp({
      downloadFile: vi.fn(() => {
        throw new Error("something else entirely");
      }),
    });

    expect(requestTelegramDownload(HTTPS_URL, "README.md")).toBe("busy");
  });
});
