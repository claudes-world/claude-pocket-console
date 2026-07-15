import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// --- Mocks (must be declared before importing FileViewer) ---

const { requestTelegramDownloadMock } = vi.hoisted(() => ({
  requestTelegramDownloadMock: vi.fn(),
}));

vi.mock("../../lib/telegram", () => ({
  getAuthHeaders: () => ({ Authorization: "tma test" }),
  requestTelegramDownload: requestTelegramDownloadMock,
}));

// Minimal stub for MarkdownViewer (heavy dependency tree)
vi.mock("../MarkdownViewer", () => ({
  MarkdownViewer: ({ content }: { content: string }) => (
    <div data-testid="markdown-viewer">{content}</div>
  ),
}));

// Minimal stub for BottomSheet
vi.mock("../BottomSheet", () => ({
  BottomSheet: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="bottom-sheet">{children}</div> : null,
}));

// Minimal stub for file-icons
vi.mock("../file-icons", () => ({
  getFileIcon: () => null,
}));

import { FileViewer, SORT_OPTIONS, middleTruncatePath } from "../FileViewer";

let fetchMock: ReturnType<typeof vi.fn>;

// Helper to build a fetch response matching the real API shape
function makeListResponse(items: Array<{ name: string; path: string; type: string; size: number; modified: string }>, parent: string | null = "/home/claude") {
  return {
    ok: true,
    json: async () => ({
      items,
      path: items.length > 0 ? items[0].path.substring(0, items[0].path.lastIndexOf("/")) : "/home/claude/claudes-world",
      parent,
    }),
  };
}

function makeDirBranchResponse() {
  return {
    ok: true,
    json: async () => ({ ok: true, branch: "main", isWorktree: false }),
  };
}

beforeEach(() => {
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;

  // Default: return a directory listing
  fetchMock.mockImplementation(async (url: string) => {
    if (typeof url === "string" && url.includes("/api/files/list")) {
      return makeListResponse(
        [
          { name: "README.md", path: "/home/claude/claudes-world/README.md", type: "file", size: 1234, modified: "2026-04-10T12:00:00Z" },
          { name: "src", path: "/home/claude/claudes-world/src", type: "dir", size: 0, modified: "2026-04-10T11:00:00Z" },
        ],
        "/home/claude",
      );
    }
    if (typeof url === "string" && url.includes("/api/terminal/dir-branch")) {
      return makeDirBranchResponse();
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FileViewer", () => {
  it("renders a directory listing on mount", async () => {
    const onClose = vi.fn();
    render(<FileViewer onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText("README.md")).toBeInTheDocument();
      expect(screen.getByText("src")).toBeInTheDocument();
    });
  });

  it("shows an error message when fetch fails", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/terminal/dir-branch")) {
        return makeDirBranchResponse();
      }
      throw new Error("Network failure");
    });

    const onClose = vi.fn();
    render(<FileViewer onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText(/Network failure|Failed to load/)).toBeInTheDocument();
    });
  });

  it("navigates into a directory when clicked", async () => {
    const onClose = vi.fn();
    render(<FileViewer onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText("src")).toBeInTheDocument();
    });

    // When user clicks "src", a new fetch is made for that path
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/files/list")) {
        return makeListResponse(
          [
            { name: "index.ts", path: "/home/claude/claudes-world/src/index.ts", type: "file", size: 500, modified: "2026-04-10T10:00:00Z" },
          ],
          "/home/claude/claudes-world",
        );
      }
      if (typeof url === "string" && url.includes("/api/terminal/dir-branch")) {
        return makeDirBranchResponse();
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    fireEvent.click(screen.getByText("src"));

    await waitFor(() => {
      expect(screen.getByText("index.ts")).toBeInTheDocument();
    });
  });

  it("opens a file when clicked and shows its content", async () => {
    const onClose = vi.fn();
    const onViewChange = vi.fn();
    render(<FileViewer onClose={onClose} onViewChange={onViewChange} />);

    await waitFor(() => {
      expect(screen.getByText("README.md")).toBeInTheDocument();
    });

    // After clicking README.md, mock the file read endpoint
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/files/read")) {
        return {
          ok: true,
          json: async () => ({
            content: "# Hello World\n\nThis is a test.",
            path: "/home/claude/claudes-world/README.md",
            name: "README.md",
          }),
        };
      }
      if (typeof url === "string" && url.includes("/api/terminal/dir-branch")) {
        return makeDirBranchResponse();
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    fireEvent.click(screen.getByText("README.md"));

    await waitFor(() => {
      // MarkdownViewer is mocked to render content as text
      expect(screen.getByTestId("markdown-viewer")).toBeInTheDocument();
    });

    // onViewChange should have been called with the file info
    expect(onViewChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: "README.md" }),
    );
  });

  it("caps the expanded parent path and ellipsizes the collapsed path", async () => {
    render(<FileViewer onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("README.md")).toBeInTheDocument();
    });

    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/files/read")) {
        return {
          ok: true,
          json: async () => ({
            content: "# Test",
            path: "/home/claude/claudes-world/README.md",
            name: "README.md",
          }),
        };
      }
      if (typeof url === "string" && url.includes("/api/terminal/dir-branch")) {
        return makeDirBranchResponse();
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    fireEvent.click(screen.getByText("README.md"));

    const collapsedButton = await screen.findByRole("button", {
      name: "Expand parent directory path",
    });
    expect(collapsedButton).toHaveStyle({ overflow: "hidden", textOverflow: "ellipsis" });

    fireEvent.click(collapsedButton);

    const expandedButton = screen.getByRole("button", {
      name: "Collapse parent directory path",
    });
    expect(expandedButton).toHaveStyle({
      maxHeight: "72px",
      overflowX: "hidden",
      overflowY: "auto",
    });
  });
});

describe("SORT_OPTIONS export", () => {
  it("exports all four sort modes", () => {
    expect(SORT_OPTIONS).toHaveLength(4);
    const values = SORT_OPTIONS.map((o) => o.value);
    expect(values).toContain("name-asc");
    expect(values).toContain("name-desc");
    expect(values).toContain("date-asc");
    expect(values).toContain("date-desc");
  });

  it("each option has short and long labels", () => {
    for (const opt of SORT_OPTIONS) {
      expect(opt.short).toBeTruthy();
      expect(opt.long).toBeTruthy();
    }
  });
});

describe("middleTruncatePath", () => {
  it("leaves a short path unchanged", () => {
    expect(middleTruncatePath("/home/claude/code/")).toBe("/home/claude/code/");
  });

  it("middle-truncates a long path while preserving prefix and trailing directories", () => {
    const path = "/home/claude/claudes-world/.claude/skills/some/really/deeply/nested/foo/";
    const truncated = middleTruncatePath(path);
    const [prefix, suffix] = truncated.split("\u2026");

    expect(truncated).toContain("\u2026");
    expect(truncated).toMatch(/^\/home\/claude\//);
    expect(truncated).toMatch(/\/deeply\/nested\/foo\/$/);
    expect(prefix.endsWith("/")).toBe(true);
    expect(suffix.startsWith("/")).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(60);
  });

  it("falls back to a hard suffix cut when a boundary would waste most of the budget", () => {
    const maxLength = 60;
    const path = "/home/claude/code/claude-pocket-console-worktrees/feat-issue-243-fileviewer-path/";
    const truncated = middleTruncatePath(path, maxLength);

    expect(path).toHaveLength(81);
    expect(truncated).toContain("\u2026");
    expect(truncated).toMatch(/fileviewer-path\/$/);
    expect(truncated.length).toBeGreaterThanOrEqual(maxLength - 12);
    expect(truncated.length).toBeLessThanOrEqual(maxLength);
  });

  it("falls back to a hard prefix cut when a boundary would waste most of the budget", () => {
    const path = `/a/${"p".repeat(50)}/meaningful/suffix/`;
    const truncated = middleTruncatePath(path, 60);
    const [prefix] = truncated.split("\u2026");

    expect(prefix).toHaveLength(30);
    expect(prefix.endsWith("p")).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(60);
  });

  it("does not split surrogate pairs at hard cuts", () => {
    const truncated = middleTruncatePath("abcd\ud83d\ude00efghi\ud83d\ude80jkl", 10);

    expect(truncated).toBe("abcd\u2026jkl");
    expect(truncated).not.toMatch(/[\uD800-\uDFFF]/);
    expect(truncated.length).toBeLessThanOrEqual(10);
  });

  it("leaves a path at the exact boundary unchanged", () => {
    const path = `/${"a".repeat(58)}/`;
    expect(path).toHaveLength(60);
    expect(middleTruncatePath(path)).toBe(path);
  });
});

describe("FileViewer download (WORLD-375)", () => {
  const TICKET = "a".repeat(32);

  // restoreAllMocks() does not clear a vi.fn(), so call counts would leak
  // between these tests.
  beforeEach(() => {
    requestTelegramDownloadMock.mockReset();
  });

  /** Open README.md and mock the ticket endpoint, leaving the viewer on-screen. */
  async function openFileWithDownloadReady() {
    render(<FileViewer onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("README.md")).toBeInTheDocument();
    });

    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/files/download-ticket")) {
        return { ok: true, json: async () => ({ ticket: TICKET }) };
      }
      if (typeof url === "string" && url.includes("/api/files/read")) {
        return {
          ok: true,
          json: async () => ({
            content: "# Hello World",
            path: "/home/claude/claudes-world/README.md",
            name: "README.md",
          }),
        };
      }
      if (typeof url === "string" && url.includes("/api/terminal/dir-branch")) {
        return makeDirBranchResponse();
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    fireEvent.click(screen.getByText("README.md"));
    await waitFor(() => {
      expect(screen.getByLabelText("Download file")).toBeInTheDocument();
    });
  }

  it("offers Telegram an absolute URL carrying the ticket, and stops there", async () => {
    requestTelegramDownloadMock.mockReturnValue(true);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await openFileWithDownloadReady();

    fireEvent.click(screen.getByLabelText("Download file"));

    await waitFor(() => {
      expect(requestTelegramDownloadMock).toHaveBeenCalledTimes(1);
    });
    const [url, name] = requestTelegramDownloadMock.mock.calls[0];
    // Absolute, not "/api/..." — Telegram's downloader runs outside this document.
    expect(url).toMatch(new RegExp(`^https?://[^/]+/api/files/download\\?ticket=${TICKET}$`));
    expect(name).toBe("README.md");
    // Telegram took it, so the anchor fallback must not also fire.
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("falls back to an anchor download when Telegram declines", async () => {
    requestTelegramDownloadMock.mockReturnValue(false);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await openFileWithDownloadReady();

    fireEvent.click(screen.getByLabelText("Download file"));

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("README.md");
    expect(anchor.href).toContain(`/api/files/download?ticket=${TICKET}`);
  });

  it("surfaces an error and never downloads when the ticket is refused", async () => {
    requestTelegramDownloadMock.mockReturnValue(true);
    await openFileWithDownloadReady();

    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/files/download-ticket")) {
        return { ok: false, status: 403, json: async () => ({ error: "path not allowed" }) };
      }
      if (typeof url === "string" && url.includes("/api/terminal/dir-branch")) {
        return makeDirBranchResponse();
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    fireEvent.click(screen.getByLabelText("Download file"));

    await waitFor(() => {
      expect(screen.getByText("path not allowed")).toBeInTheDocument();
    });
    expect(requestTelegramDownloadMock).not.toHaveBeenCalled();
  });
});
