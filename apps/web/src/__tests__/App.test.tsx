import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockFileViewerProps {
  initialFile?: string | null;
  onViewChange?: (file: { path: string; name: string } | null) => void;
  onPathChange?: (path: string) => void;
}

const mockFileViewerPropsByPath = new Map<string | null, MockFileViewerProps>();

vi.mock("../components/Terminal", () => ({
  Terminal: () => <div>Terminal</div>,
}));

vi.mock("../components/FileViewer", () => ({
  FileViewer: (props: MockFileViewerProps) => {
    mockFileViewerPropsByPath.set(props.initialFile ?? null, props);
    return <div>File viewer: {props.initialFile}</div>;
  },
}));

vi.mock("../components/Links", () => ({
  Links: ({ onOpenFile }: { onOpenFile: (path: string) => void }) => (
    <button onClick={() => onOpenFile("/new.ts")}>Open new reading-list file</button>
  ),
}));

vi.mock("../components/action-bar", () => ({
  ActionBar: ({
    viewingFile,
    currentFolder,
  }: {
    viewingFile?: { path: string; name: string } | null;
    currentFolder?: string | null;
  }) => (
    <div>
      <span data-testid="action-file">{viewingFile?.path ?? "none"}</span>
      <span data-testid="action-folder">{currentFolder ?? "none"}</span>
    </div>
  ),
}));

vi.mock("../components/VoiceRecorder", () => ({ VoiceRecorder: () => <div>Voice</div> }));
vi.mock("../components/PrTicker", () => ({ PrTicker: () => <div>PRs</div> }));
vi.mock("../components/HomeScreenPrompt", () => ({ HomeScreenPrompt: () => null }));
vi.mock("../components/SessionPicker", () => ({ SessionPicker: () => null }));
vi.mock("../debug/DebugOverlay", () => ({ DebugOverlay: () => null }));
vi.mock("../lib/haptic", () => ({
  haptic: { selection: vi.fn() },
}));
vi.mock("../lib/telegram", () => ({
  getTelegramWebApp: () => null,
  getAuthHeaders: () => ({}),
  hasAuth: () => true,
  setSessionToken: vi.fn(),
}));

import { App } from "../App";

beforeEach(() => {
  mockFileViewerPropsByPath.clear();
  window.history.replaceState(null, "", "#files&file=%2Fold.ts");
  localStorage.setItem("cpc:home-screen-prompted", "1");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    json: async () => ({ ok: false }),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, "", "#");
});

describe("App FileViewer callback ownership", () => {
  it("drops the old viewer's late callbacks after a reading-list open", async () => {
    render(<App />);
    const oldViewer = mockFileViewerPropsByPath.get("/old.ts");
    expect(oldViewer).toBeDefined();

    act(() => {
      oldViewer?.onViewChange?.({ path: "/old.ts", name: "old.ts" });
      oldViewer?.onPathChange?.("/old-folder");
    });
    expect(screen.getByTestId("action-file")).toHaveTextContent("/old.ts");

    fireEvent.click(screen.getByText("Open new reading-list file"));
    await waitFor(() => expect(mockFileViewerPropsByPath.has("/new.ts")).toBe(true));
    const newViewer = mockFileViewerPropsByPath.get("/new.ts");

    act(() => {
      newViewer?.onViewChange?.({ path: "/new.ts", name: "new.ts" });
      newViewer?.onPathChange?.("/new-folder");
      oldViewer?.onViewChange?.({ path: "/stale.ts", name: "stale.ts" });
      oldViewer?.onPathChange?.("/stale-folder");
    });

    expect(screen.getByTestId("action-file")).toHaveTextContent("/new.ts");
    expect(screen.getByTestId("action-folder")).toHaveTextContent("/new-folder");
  });
});
