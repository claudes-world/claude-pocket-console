import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PrTicker } from "../PrTicker";

// --- Mocks ---

// Mock the telegram auth module
vi.mock("../../lib/telegram", () => ({
  getAuthHeaders: () => ({ Authorization: "tma test-init-data" }),
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
Object.defineProperty(window, "localStorage", { value: localStorageMock });

// Helper to build a mock PrRow
function makePr(overrides: Record<string, unknown> = {}) {
  return {
    key: "claudes-world/inbox#10",
    repo: "claudes-world/inbox",
    number: 10,
    title: "Add unit tests",
    state: "OPEN",
    isDraft: false,
    headRefName: "test/unit-tests",
    author: "claude-do-box",
    reviewDecision: null,
    ciStatus: null,
    url: "https://github.com/claudes-world/inbox/pull/10",
    updatedAt: new Date().toISOString(),
    firstSeen: Date.now(),
    lastChanged: Date.now(),
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorageMock.clear();

  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;

  // Default: empty PR list and no branches
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/prs") {
      return {
        ok: true,
        json: async () => ({ ok: true, prs: [], lastPollOk: Date.now() }),
      };
    }
    if (url === "/api/prs/current-branch-scope") {
      return {
        ok: true,
        json: async () => ({ ok: true, branches: [] }),
      };
    }
    if (url === "/api/prs/refresh") {
      return {
        ok: true,
        json: async () => ({ ok: true, prs: [], lastPollOk: Date.now() }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PrTicker", () => {
  it("renders empty state when there are no PRs", async () => {
    render(<PrTicker />);

    await waitFor(() => {
      expect(screen.getByText("No open PRs")).toBeInTheDocument();
    });
  });

  it("shows 'No PRs on current branch' when filter is current but PRs exist on other branches", async () => {
    const pr = makePr({ headRefName: "feat/other-branch" });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [pr], lastPollOk: Date.now() }),
        };
      }
      if (url === "/api/prs/current-branch-scope") {
        return {
          ok: true,
          json: async () => ({ ok: true, branches: ["main"] }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<PrTicker />);

    await waitFor(() => {
      expect(screen.getByText(/No PRs on current branch/)).toBeInTheDocument();
    });
  });

  it("renders PR rows when data is returned", async () => {
    const pr1 = makePr({ number: 42, title: "Fix the widget", headRefName: "fix/widget" });
    const pr2 = makePr({ number: 43, title: "Add feature X", headRefName: "feat/x" });

    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [pr1, pr2], lastPollOk: Date.now() }),
        };
      }
      if (url === "/api/prs/current-branch-scope") {
        return {
          ok: true,
          json: async () => ({ ok: true, branches: ["fix/widget", "feat/x"] }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<PrTicker />);

    await waitFor(() => {
      expect(screen.getByText("#42")).toBeInTheDocument();
      expect(screen.getByText("Fix the widget")).toBeInTheDocument();
      expect(screen.getByText("#43")).toBeInTheDocument();
      expect(screen.getByText("Add feature X")).toBeInTheDocument();
    });
  });

  it("switches from 'current branch' to 'all' filter when chip is clicked", async () => {
    const prOnBranch = makePr({ number: 1, title: "On branch", headRefName: "dev" });
    const prOffBranch = makePr({ number: 2, title: "Off branch", headRefName: "other" });

    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            prs: [prOnBranch, prOffBranch],
            lastPollOk: Date.now(),
          }),
        };
      }
      if (url === "/api/prs/current-branch-scope") {
        return {
          ok: true,
          json: async () => ({ ok: true, branches: ["dev"] }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<PrTicker />);

    // Wait for data to load — in "current" mode only PR #1 is visible
    await waitFor(() => {
      expect(screen.getByText("#1")).toBeInTheDocument();
    });
    expect(screen.queryByText("#2")).not.toBeInTheDocument();

    // Click "all" filter chip
    fireEvent.click(screen.getByText("all"));

    await waitFor(() => {
      expect(screen.getByText("#2")).toBeInTheDocument();
    });
    expect(screen.getByText("#1")).toBeInTheDocument();
  });

  it("persists filter mode to localStorage", async () => {
    render(<PrTicker />);

    // Default is "current"
    await waitFor(() => {
      expect(localStorageMock.setItem).toHaveBeenCalledWith("cpc-pr-filter-mode", "current");
    });

    fireEvent.click(screen.getByText("all"));

    await waitFor(() => {
      expect(localStorageMock.setItem).toHaveBeenCalledWith("cpc-pr-filter-mode", "all");
    });
  });

  it("displays the footer count matching visible PRs", async () => {
    const pr = makePr({ headRefName: "dev" });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [pr], lastPollOk: Date.now() }),
        };
      }
      if (url === "/api/prs/current-branch-scope") {
        return {
          ok: true,
          json: async () => ({ ok: true, branches: ["dev"] }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<PrTicker />);

    await waitFor(() => {
      expect(screen.getByText("1 open")).toBeInTheDocument();
    });
  });

  it("shows error banner when fetch fails", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        throw new Error("Network down");
      }
      if (url === "/api/prs/current-branch-scope") {
        return { ok: true, json: async () => ({ ok: true, branches: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<PrTicker />);

    await waitFor(() => {
      expect(screen.getByText(/Network down/)).toBeInTheDocument();
    });
  });

  it("shows poll error from API response", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [], lastPollOk: Date.now(), lastPollErr: "rate limited" }),
        };
      }
      if (url === "/api/prs/current-branch-scope") {
        return { ok: true, json: async () => ({ ok: true, branches: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<PrTicker />);

    await waitFor(() => {
      expect(screen.getByText(/rate limited/)).toBeInTheDocument();
    });
  });

  it("displays review and CI status labels on PR rows", async () => {
    const pr = makePr({
      number: 99,
      headRefName: "dev",
      reviewDecision: "APPROVED",
      ciStatus: "SUCCESS",
    });

    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [pr], lastPollOk: Date.now() }),
        };
      }
      if (url === "/api/prs/current-branch-scope") {
        return {
          ok: true,
          json: async () => ({ ok: true, branches: ["dev"] }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<PrTicker />);

    await waitFor(() => {
      expect(screen.getByText("approved")).toBeInTheDocument();
      expect(screen.getByText("CI pass")).toBeInTheDocument();
    });
  });
});
