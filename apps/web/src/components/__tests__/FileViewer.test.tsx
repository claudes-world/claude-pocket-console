import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// --- Mocks (must be declared before importing FileViewer) ---

vi.mock("../../lib/telegram", () => ({
  getAuthHeaders: () => ({ Authorization: "tma test" }),
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

import { FileViewer, SORT_OPTIONS } from "../FileViewer";

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
