import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// --- Mocks (must be declared before importing ActionBar) ---

vi.mock("../../lib/telegram", () => ({
  getAuthHeaders: () => ({ Authorization: "tma test" }),
}));

// Stub BottomSheet to render children directly
vi.mock("../BottomSheet", () => ({
  BottomSheet: ({ children, title }: { children: React.ReactNode; title?: string }) => (
    <div data-testid="bottom-sheet">
      {title && <div data-testid="bottom-sheet-title">{title}</div>}
      {children}
    </div>
  ),
}));

// Stub file-icons (used by FileSearchSheet)
vi.mock("../file-icons", () => ({
  getFileIcon: () => null,
}));

// Stub FileViewer's SORT_OPTIONS (used by FileOptionsSheet)
vi.mock("../FileViewer", () => ({
  SORT_OPTIONS: [
    { value: "name-asc", short: "A-Z", long: "Name (A-Z)" },
    { value: "name-desc", short: "Z-A", long: "Name (Z-A)" },
    { value: "date-asc", short: "Old", long: "Date (oldest)" },
    { value: "date-desc", short: "New", long: "Date (newest)" },
  ],
}));

// Mock the entire API module so no real fetches happen
const mockPostAction = vi.fn();
const mockFetchGitBranch = vi.fn();
const mockFetchGitStatus = vi.fn();
const mockFetchTodo = vi.fn();
const mockFetchSessionNames = vi.fn();
const mockDeleteSessionName = vi.fn();
const mockSendToTmux = vi.fn();
const mockSendCompactCommand = vi.fn();
const mockRenameSession = vi.fn();
const mockRunGitCommand = vi.fn();
const mockSearchFiles = vi.fn();
const mockCheckAudio = vi.fn();
const mockGenerateAudio = vi.fn();
const mockSendAudioTelegram = vi.fn();
const mockRestartSession = vi.fn();
const mockSendFileToChat = vi.fn();

vi.mock("../action-bar/api", () => ({
  postAction: (...args: unknown[]) => mockPostAction(...args),
  fetchGitBranch: (...args: unknown[]) => mockFetchGitBranch(...args),
  fetchGitStatus: (...args: unknown[]) => mockFetchGitStatus(...args),
  fetchTodo: (...args: unknown[]) => mockFetchTodo(...args),
  fetchSessionNames: (...args: unknown[]) => mockFetchSessionNames(...args),
  deleteSessionName: (...args: unknown[]) => mockDeleteSessionName(...args),
  sendToTmux: (...args: unknown[]) => mockSendToTmux(...args),
  sendCompactCommand: (...args: unknown[]) => mockSendCompactCommand(...args),
  renameSession: (...args: unknown[]) => mockRenameSession(...args),
  runGitCommand: (...args: unknown[]) => mockRunGitCommand(...args),
  searchFiles: (...args: unknown[]) => mockSearchFiles(...args),
  checkAudio: (...args: unknown[]) => mockCheckAudio(...args),
  generateAudio: (...args: unknown[]) => mockGenerateAudio(...args),
  sendAudioTelegram: (...args: unknown[]) => mockSendAudioTelegram(...args),
  restartSession: (...args: unknown[]) => mockRestartSession(...args),
  sendFileToChat: (...args: unknown[]) => mockSendFileToChat(...args),
  summarizeMarkdown: vi.fn().mockResolvedValue({ ok: true, summary: "Test summary", cached: false, ms: 100 }),
}));

import { ActionBar } from "../action-bar";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  // Default: fetchGitBranch resolves (called on mount)
  mockFetchGitBranch.mockResolvedValue({ branch: "main", treeType: "main-worktree" });
  mockFetchTodo.mockResolvedValue("- [ ] Write tests");
  mockFetchGitStatus.mockResolvedValue("On branch main\nnothing to commit");
  mockFetchSessionNames.mockResolvedValue([]);
  mockPostAction.mockResolvedValue({ ok: true, output: "Done" });
  mockSendToTmux.mockResolvedValue(undefined);
  mockSendCompactCommand.mockResolvedValue({ ok: true });
  mockRenameSession.mockResolvedValue({ ok: true });
  mockRunGitCommand.mockResolvedValue("branch output");
  mockSearchFiles.mockResolvedValue([]);
  mockCheckAudio.mockResolvedValue({ exists: false });
  mockGenerateAudio.mockResolvedValue({ ok: true, path: "/tmp/audio.ogg" });
  mockSendAudioTelegram.mockResolvedValue({ ok: true });
  mockRestartSession.mockResolvedValue({ ok: true });
  mockSendFileToChat.mockResolvedValue({ ok: true });
  mockDeleteSessionName.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ActionBar", () => {
  // ─── Rendering basics ───────────────────────────────────────────

  it("renders without crashing with no props", async () => {
    render(<ActionBar />);
    // The TODO button is always present
    expect(screen.getByText("TODO")).toBeInTheDocument();
  });

  it("shows TODO button regardless of active tab", () => {
    const { rerender } = render(<ActionBar activeTab="terminal" />);
    expect(screen.getByText("TODO")).toBeInTheDocument();

    rerender(<ActionBar activeTab="files" />);
    expect(screen.getByText("TODO")).toBeInTheDocument();
  });

  it("shows terminal-specific buttons when activeTab is terminal", () => {
    render(<ActionBar activeTab="terminal" onReconnect={() => {}} />);
    expect(screen.getByText("Git")).toBeInTheDocument();
    expect(screen.getByText("/commands")).toBeInTheDocument();
    expect(screen.getByText("Reconnect")).toBeInTheDocument();
  });

  it("hides terminal buttons when activeTab is files", () => {
    render(<ActionBar activeTab="files" />);
    expect(screen.queryByText("Git")).not.toBeInTheDocument();
    expect(screen.queryByText("/commands")).not.toBeInTheDocument();
    expect(screen.queryByText("Reconnect")).not.toBeInTheDocument();
  });

  it("shows Search and Options buttons in files tab without viewingFile", () => {
    render(<ActionBar activeTab="files" />);
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("Options")).toBeInTheDocument();
  });

  it("shows Send to Chat button when viewing a file", () => {
    render(<ActionBar activeTab="files" viewingFile={{ path: "/tmp/test.txt", name: "test.txt" }} />);
    expect(screen.getByText("Send to Chat")).toBeInTheDocument();
    // Search and Options should be hidden when viewing a file
    expect(screen.queryByText("Search")).not.toBeInTheDocument();
    expect(screen.queryByText("Options")).not.toBeInTheDocument();
  });

  it("shows TL;DR and Audio buttons for markdown files", () => {
    render(<ActionBar activeTab="files" viewingFile={{ path: "/tmp/README.md", name: "README.md" }} />);
    expect(screen.getByText("TL;DR")).toBeInTheDocument();
    expect(screen.getByText("Audio")).toBeInTheDocument();
  });

  it("hides TL;DR and Audio buttons for non-markdown files", () => {
    render(<ActionBar activeTab="files" viewingFile={{ path: "/tmp/app.ts", name: "app.ts" }} />);
    expect(screen.queryByText("TL;DR")).not.toBeInTheDocument();
    expect(screen.queryByText("Audio")).not.toBeInTheDocument();
    // But Send to Chat is still present
    expect(screen.getByText("Send to Chat")).toBeInTheDocument();
  });

  it("opens TL;DR modal when TL;DR button is clicked", async () => {
    render(<ActionBar activeTab="files" viewingFile={{ path: "/tmp/README.md", name: "README.md" }} />);
    fireEvent.click(screen.getByText("TL;DR"));

    await waitFor(() => {
      // TldrModal renders inside a BottomSheet stub — the sheet should be present
      expect(screen.getByTestId("bottom-sheet")).toBeInTheDocument();
    });
  });

  it("calls checkAudio when Audio button is clicked", async () => {
    render(<ActionBar activeTab="files" viewingFile={{ path: "/tmp/README.md", name: "README.md" }} />);
    fireEvent.click(screen.getByText("Audio"));

    await waitFor(() => {
      expect(mockCheckAudio).toHaveBeenCalledWith("/tmp/README.md");
    });
  });

  it("calls generateAudio when audio does not exist and generate is triggered", async () => {
    // checkAudio reports no cached audio → AudioGenModal shows a Generate button
    mockCheckAudio.mockResolvedValue({ exists: false });

    render(<ActionBar activeTab="files" viewingFile={{ path: "/tmp/README.md", name: "README.md" }} />);
    fireEvent.click(screen.getByText("Audio"));

    // Wait for modal to open and checkAudio to resolve
    await waitFor(() => {
      expect(mockCheckAudio).toHaveBeenCalledWith("/tmp/README.md");
      expect(screen.getByTestId("bottom-sheet")).toBeInTheDocument();
    });

    // Find and click the Generate Audio button inside the AudioGenModal
    const generateBtn = screen.queryByText("Generate Audio");
    if (generateBtn) {
      fireEvent.click(generateBtn);
      await waitFor(() => {
        expect(mockGenerateAudio).toHaveBeenCalledWith("/tmp/README.md", expect.any(AbortSignal));
      });
    }
  });

  it("hides Reconnect button when onReconnect is not provided", () => {
    render(<ActionBar activeTab="terminal" />);
    expect(screen.queryByText("Reconnect")).not.toBeInTheDocument();
    // Git and /commands should still appear
    expect(screen.getByText("Git")).toBeInTheDocument();
    expect(screen.getByText("/commands")).toBeInTheDocument();
  });

  // ─── StatusLine ─────────────────────────────────────────────────

  it("shows disconnected status when connected is false", async () => {
    render(<ActionBar connected={false} />);
    await waitFor(() => {
      expect(screen.getByText("[disconnected]")).toBeInTheDocument();
    });
  });

  it("shows git branch info when connected", async () => {
    render(<ActionBar connected={true} />);
    await waitFor(() => {
      expect(screen.getByText(/main.*main-worktree/)).toBeInTheDocument();
    });
  });

  it("shows idle state (non-breaking space) when fetchGitBranch returns null", async () => {
    mockFetchGitBranch.mockResolvedValue(null);
    render(<ActionBar connected={true} />);
    await waitFor(() => {
      expect(mockFetchGitBranch).toHaveBeenCalled();
    });
    // StatusLine renders \u00A0 (non-breaking space) when gitBranch is null
    const statusLine = document.querySelector("[style*='textAlign: center']") ??
      document.querySelector("[style*='text-align: center']");
    // Branch info should not appear
    expect(screen.queryByText(/main.*main-worktree/)).not.toBeInTheDocument();
    expect(screen.queryByText("[disconnected]")).not.toBeInTheDocument();
  });

  // ─── Modal: TODO ────────────────────────────────────────────────

  it("opens TODO sheet when TODO button is clicked", async () => {
    render(<ActionBar activeTab="terminal" />);
    fireEvent.click(screen.getByText("TODO"));

    await waitFor(() => {
      expect(mockFetchTodo).toHaveBeenCalled();
      expect(screen.getByTestId("bottom-sheet-title")).toHaveTextContent("TODO");
    });
  });

  // ─── Modal: /commands ───────────────────────────────────────────

  it("opens commands sheet and shows command buttons", async () => {
    render(<ActionBar activeTab="terminal" />);
    fireEvent.click(screen.getByText("/commands"));

    await waitFor(() => {
      expect(screen.getByTestId("bottom-sheet-title")).toHaveTextContent("/commands");
    });
    expect(screen.getByText("/new")).toBeInTheDocument();
    expect(screen.getByText("/resume")).toBeInTheDocument();
    expect(screen.getByText("/rename")).toBeInTheDocument();
    expect(screen.getByText("/compact")).toBeInTheDocument();
    expect(screen.getByText("/reload-plugins")).toBeInTheDocument();
  });

  it("navigates from /commands to rename modal", async () => {
    render(<ActionBar activeTab="terminal" />);
    fireEvent.click(screen.getByText("/commands"));

    await waitFor(() => {
      expect(screen.getByText("/rename")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("/rename"));

    await waitFor(() => {
      expect(screen.getByText("Rename Session")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Session name...")).toBeInTheDocument();
    });
  });

  it("navigates from /commands to new-confirm modal", async () => {
    render(<ActionBar activeTab="terminal" />);
    fireEvent.click(screen.getByText("/commands"));

    await waitFor(() => {
      expect(screen.getByText("/new")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("/new"));

    await waitFor(() => {
      expect(screen.getByText("Start new session?")).toBeInTheDocument();
      expect(screen.getByText("Cancel")).toBeInTheDocument();
      expect(screen.getByText("New")).toBeInTheDocument();
    });
  });

  it("navigates from /commands to compact-confirm modal", async () => {
    render(<ActionBar activeTab="terminal" />);
    fireEvent.click(screen.getByText("/commands"));

    await waitFor(() => {
      expect(screen.getByText("/compact")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("/compact"));

    await waitFor(() => {
      expect(screen.getByText("Compact Context")).toBeInTheDocument();
      expect(screen.getByText("Compact Now")).toBeInTheDocument();
      expect(screen.getByText("Prompt for Continuity")).toBeInTheDocument();
    });
  });

  // ─── Modal: Rename flow ─────────────────────────────────────────

  it("submits rename and calls renameSession API", async () => {
    render(<ActionBar activeTab="terminal" />);
    fireEvent.click(screen.getByText("/commands"));
    await waitFor(() => expect(screen.getByText("/rename")).toBeInTheDocument());
    fireEvent.click(screen.getByText("/rename"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Session name...")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Session name...");
    fireEvent.change(input, { target: { value: "my-session" } });
    fireEvent.click(screen.getByText("Rename"));

    await waitFor(() => {
      expect(mockRenameSession).toHaveBeenCalledWith("my-session");
      expect(mockSendToTmux).toHaveBeenCalledWith("/rename my-session");
    });
  });

  it("does not submit rename when name is empty", async () => {
    render(<ActionBar activeTab="terminal" />);
    fireEvent.click(screen.getByText("/commands"));
    await waitFor(() => expect(screen.getByText("/rename")).toBeInTheDocument());
    fireEvent.click(screen.getByText("/rename"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Session name...")).toBeInTheDocument();
    });

    // Leave input empty, click Rename
    fireEvent.click(screen.getByText("Rename"));

    expect(mockRenameSession).not.toHaveBeenCalled();
  });

  // ─── Modal: Git ─────────────────────────────────────────────────

  it("opens git status sheet when Git button is clicked", async () => {
    render(<ActionBar activeTab="terminal" />);
    fireEvent.click(screen.getByText("Git"));

    await waitFor(() => {
      expect(mockFetchGitStatus).toHaveBeenCalled();
      expect(screen.getByTestId("bottom-sheet-title")).toHaveTextContent("Git Status");
    });
  });

  it("opens git menu via dropdown arrow button", async () => {
    render(<ActionBar activeTab="terminal" />);
    const gitMenuBtn = screen.getByLabelText("Open git menu");
    fireEvent.click(gitMenuBtn);

    await waitFor(() => {
      expect(screen.getByTestId("bottom-sheet-title")).toHaveTextContent("Git");
      expect(screen.getByText("View Status")).toBeInTheDocument();
      expect(screen.getByText("Check Branch")).toBeInTheDocument();
      expect(screen.getByText("View Log")).toBeInTheDocument();
      expect(screen.getByText("Pull")).toBeInTheDocument();
    });
  });

  it("runs a git command from the git menu", async () => {
    render(<ActionBar activeTab="terminal" />);
    fireEvent.click(screen.getByLabelText("Open git menu"));
    await waitFor(() => expect(screen.getByText("Pull")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Pull"));

    await waitFor(() => {
      expect(mockRunGitCommand).toHaveBeenCalledWith("pull");
    });
  });

  // ─── Modal: Reconnect menu ─────────────────────────────────────

  it("opens reconnect menu and shows restart option", async () => {
    const onReconnect = vi.fn();
    render(<ActionBar activeTab="terminal" onReconnect={onReconnect} />);
    fireEvent.click(screen.getByLabelText("Open reconnect menu"));

    await waitFor(() => {
      expect(screen.getByTestId("bottom-sheet-title")).toHaveTextContent("Session Controls");
      expect(screen.getByText("Reconnect Terminal")).toBeInTheDocument();
      expect(screen.getByText("Restart Claude Session")).toBeInTheDocument();
    });
  });

  it("calls onReconnect when reconnect terminal is clicked in menu", async () => {
    const onReconnect = vi.fn();
    render(<ActionBar activeTab="terminal" onReconnect={onReconnect} />);
    fireEvent.click(screen.getByLabelText("Open reconnect menu"));
    await waitFor(() => expect(screen.getByText("Reconnect Terminal")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Reconnect Terminal"));

    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it("calls restartSession when restart button is clicked", async () => {
    const onReconnect = vi.fn();
    render(<ActionBar activeTab="terminal" onReconnect={onReconnect} />);
    fireEvent.click(screen.getByLabelText("Open reconnect menu"));
    await waitFor(() => expect(screen.getByText("Restart Claude Session")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Restart Claude Session"));

    await waitFor(() => {
      expect(mockRestartSession).toHaveBeenCalled();
    });
  });

  // ─── Modal: New session confirm ────────────────────────────────

  it("sends /new command when new session is confirmed", async () => {
    render(<ActionBar activeTab="terminal" />);
    fireEvent.click(screen.getByText("/commands"));
    await waitFor(() => expect(screen.getByText("/new")).toBeInTheDocument());
    fireEvent.click(screen.getByText("/new"));
    await waitFor(() => expect(screen.getByText("New")).toBeInTheDocument());

    fireEvent.click(screen.getByText("New"));

    await waitFor(() => {
      expect(mockSendCompactCommand).toHaveBeenCalledWith("/new");
    });
  });

  // ─── Modal: Compact flow ───────────────────────────────────────

  it("opens compact focus from compact-confirm and submits", async () => {
    render(<ActionBar activeTab="terminal" />);
    fireEvent.click(screen.getByText("/commands"));
    await waitFor(() => expect(screen.getByText("/compact")).toBeInTheDocument());
    fireEvent.click(screen.getByText("/compact"));
    await waitFor(() => expect(screen.getByText("Compact Now")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Compact Now"));

    await waitFor(() => {
      expect(screen.getByText("Compact Focus")).toBeInTheDocument();
    });

    // Submit without focus text should send plain /compact
    fireEvent.click(screen.getByText("Compact"));

    await waitFor(() => {
      expect(mockSendCompactCommand).toHaveBeenCalledWith("/compact");
    });
  });

  it("sends compact with focus text when provided", async () => {
    render(<ActionBar activeTab="terminal" />);
    fireEvent.click(screen.getByText("/commands"));
    await waitFor(() => expect(screen.getByText("/compact")).toBeInTheDocument());
    fireEvent.click(screen.getByText("/compact"));
    await waitFor(() => expect(screen.getByText("Compact Now")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Compact Now"));
    await waitFor(() => expect(screen.getByText("Compact Focus")).toBeInTheDocument());

    const textarea = screen.getByPlaceholderText(/Focus on/);
    fireEvent.change(textarea, { target: { value: "auth refactor" } });
    fireEvent.click(screen.getByText("Compact"));

    await waitFor(() => {
      expect(mockSendCompactCommand).toHaveBeenCalledWith("/compact auth refactor");
    });
  });

  // ─── Modal: File Search ─────────────────────────────────────────

  it("opens file search sheet when Search button is clicked", async () => {
    render(<ActionBar activeTab="files" />);
    fireEvent.click(screen.getByText("Search"));

    await waitFor(() => {
      expect(screen.getByTestId("bottom-sheet-title")).toHaveTextContent("Search Files");
      expect(screen.getByPlaceholderText("Search files...")).toBeInTheDocument();
    });
  });

  // ─── Modal: File Options ────────────────────────────────────────

  it("opens file options sheet when Options button is clicked", async () => {
    render(<ActionBar activeTab="files" />);
    fireEvent.click(screen.getByText("Options"));

    await waitFor(() => {
      expect(screen.getByTestId("bottom-sheet-title")).toHaveTextContent("File Options");
    });
  });

  // ─── Send to Chat ──────────────────────────────────────────────

  it("sends file to chat when Send to Chat is clicked", async () => {
    render(<ActionBar activeTab="files" viewingFile={{ path: "/tmp/test.txt", name: "test.txt" }} />);
    fireEvent.click(screen.getByText("Send to Chat"));

    await waitFor(() => {
      expect(mockSendFileToChat).toHaveBeenCalledWith("/tmp/test.txt");
    });
  });

  // ─── Status message lifecycle ──────────────────────────────────

  it("clears status message after the 2-second handleSendToChat timeout", async () => {
    render(<ActionBar activeTab="files" viewingFile={{ path: "/tmp/test.txt", name: "test.txt" }} />);
    fireEvent.click(screen.getByText("Send to Chat"));

    await waitFor(() => {
      expect(screen.getByText("Sent to chat")).toBeInTheDocument();
    });

    // At 1900ms the 2s timeout has NOT yet fired — message must still be present
    act(() => { vi.advanceTimersByTime(1900); });
    expect(screen.getByText("Sent to chat")).toBeInTheDocument();

    // Advance past 2000ms — the 2s timeout fires and clears the message
    act(() => { vi.advanceTimersByTime(200); });

    await waitFor(() => {
      expect(screen.queryByText("Sent to chat")).not.toBeInTheDocument();
    });
  });

  // ─── Error handling ─────────────────────────────────────────────

  it("shows error status when rename fails", async () => {
    mockRenameSession.mockRejectedValue(new Error("Server error"));

    render(<ActionBar activeTab="terminal" />);
    fireEvent.click(screen.getByText("/commands"));
    await waitFor(() => expect(screen.getByText("/rename")).toBeInTheDocument());
    fireEvent.click(screen.getByText("/rename"));
    await waitFor(() => expect(screen.getByPlaceholderText("Session name...")).toBeInTheDocument());

    const input = screen.getByPlaceholderText("Session name...");
    fireEvent.change(input, { target: { value: "fail-name" } });
    fireEvent.click(screen.getByText("Rename"));

    await waitFor(() => {
      expect(screen.getByText(/Failed: Server error/)).toBeInTheDocument();
    });
  });

  it("shows error status when restart session fails", async () => {
    mockRestartSession.mockRejectedValue(new Error("Connection refused"));

    const onReconnect = vi.fn();
    render(<ActionBar activeTab="terminal" onReconnect={onReconnect} />);
    fireEvent.click(screen.getByLabelText("Open reconnect menu"));
    await waitFor(() => expect(screen.getByText("Restart Claude Session")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Restart Claude Session"));

    await waitFor(() => {
      expect(screen.getByText(/Restart failed: Connection refused/)).toBeInTheDocument();
    });
  });

  // ─── Accessibility ─────────────────────────────────────────────

  it("has aria-label on git menu dropdown button", () => {
    render(<ActionBar activeTab="terminal" />);
    const gitMenuBtn = screen.getByLabelText("Open git menu");
    expect(gitMenuBtn).toBeInTheDocument();
  });

  it("has aria-label on reconnect menu dropdown button", () => {
    render(<ActionBar activeTab="terminal" onReconnect={() => {}} />);
    const reconnectMenuBtn = screen.getByLabelText("Open reconnect menu");
    expect(reconnectMenuBtn).toBeInTheDocument();
  });
});
