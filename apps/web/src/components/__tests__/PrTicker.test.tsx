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

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    name: "inbox",
    dirName: "tryinbox-sh",
    org: "claudes-world",
    fullName: "claudes-world/inbox",
    branch: "main",
    prCount: 0,
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorageMock.clear();

  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;

  // Default: empty PR list, no repos
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/prs") {
      return {
        ok: true,
        json: async () => ({ ok: true, prs: [], repos: [], lastPollOk: Date.now() }),
      };
    }
    if (url === "/api/prs/refresh") {
      return {
        ok: true,
        json: async () => ({ ok: true, prs: [], repos: [], lastPollOk: Date.now() }),
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
  it("renders empty state when there are no repos", async () => {
    render(<PrTicker />);

    await waitFor(() => {
      expect(screen.getByText("No repos discovered")).toBeInTheDocument();
    });
  });

  it("shows 'no open PRs' for a repo with zero PRs", async () => {
    const repo = makeRepo({ prCount: 0 });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [], repos: [repo], lastPollOk: Date.now() }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<PrTicker />);

    await waitFor(() => {
      expect(screen.getByText("no open PRs")).toBeInTheDocument();
    });
  });

  it("renders PR rows grouped by org and repo", async () => {
    const pr1 = makePr({ number: 42, title: "Fix the widget", headRefName: "fix/widget", repo: "claudes-world/inbox", key: "claudes-world/inbox#42" });
    const pr2 = makePr({ number: 43, title: "Add feature X", headRefName: "feat/x", repo: "claudes-world/claude-pocket-console", key: "claudes-world/claude-pocket-console#43" });
    const repo1 = makeRepo({ name: "inbox", fullName: "claudes-world/inbox", prCount: 1 });
    const repo2 = makeRepo({ name: "claude-pocket-console", fullName: "claudes-world/claude-pocket-console", prCount: 1 });

    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [pr1, pr2], repos: [repo1, repo2], lastPollOk: Date.now() }),
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

    // Org heading should be visible
    expect(screen.getByText("claudes-world")).toBeInTheDocument();
  });

  it("collapses and expands org sections", async () => {
    const pr = makePr({ number: 1, key: "claudes-world/inbox#1", title: "Test PR" });
    const repo = makeRepo({ prCount: 1 });

    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [pr], repos: [repo], lastPollOk: Date.now() }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<PrTicker />);

    // Wait for PR to show
    await waitFor(() => {
      expect(screen.getByText("#1")).toBeInTheDocument();
    });

    // Click org heading to collapse
    fireEvent.click(screen.getByText("claudes-world"));

    // PR should no longer be visible
    await waitFor(() => {
      expect(screen.queryByText("#1")).not.toBeInTheDocument();
    });

    // Click again to expand
    fireEvent.click(screen.getByText("claudes-world"));

    await waitFor(() => {
      expect(screen.getByText("#1")).toBeInTheDocument();
    });
  });

  it("displays the footer count matching total PRs", async () => {
    const pr = makePr();
    const repo = makeRepo({ prCount: 1 });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [pr], repos: [repo], lastPollOk: Date.now() }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<PrTicker />);

    await waitFor(() => {
      // "1 open" appears in both the repo subheading and the footer
      const matches = screen.getAllByText("1 open");
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows error banner when fetch fails", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        throw new Error("Network down");
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
          json: async () => ({ ok: true, prs: [], repos: [], lastPollOk: Date.now(), lastPollErr: "rate limited" }),
        };
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
      reviewDecision: "APPROVED",
      ciStatus: "SUCCESS",
    });
    const repo = makeRepo({ prCount: 1 });

    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [pr], repos: [repo], lastPollOk: Date.now() }),
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

  it("shows repo count in header", async () => {
    const repo1 = makeRepo({ name: "inbox", fullName: "claudes-world/inbox" });
    const repo2 = makeRepo({ name: "cpc", fullName: "claudes-world/claude-pocket-console" });

    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [], repos: [repo1, repo2], lastPollOk: Date.now() }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<PrTicker />);

    await waitFor(() => {
      expect(screen.getByText("2 repos")).toBeInTheDocument();
    });
  });

  it("shows branch badge on repo subheading", async () => {
    const repo = makeRepo({ branch: "dev" });

    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [], repos: [repo], lastPollOk: Date.now() }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<PrTicker />);

    await waitFor(() => {
      expect(screen.getByText("dev")).toBeInTheDocument();
    });
  });

  it("handles multi-org grouping", async () => {
    const pr1 = makePr({ number: 1, repo: "claudes-world/inbox", key: "claudes-world/inbox#1" });
    const pr2 = makePr({ number: 2, repo: "mcorrig4/personal-site", key: "mcorrig4/personal-site#2" });
    const repo1 = makeRepo({ name: "inbox", org: "claudes-world", fullName: "claudes-world/inbox", prCount: 1 });
    const repo2 = makeRepo({ name: "personal-site", org: "mcorrig4", fullName: "mcorrig4/personal-site", prCount: 1 });

    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [pr1, pr2], repos: [repo1, repo2], lastPollOk: Date.now() }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<PrTicker />);

    await waitFor(() => {
      expect(screen.getByText("claudes-world")).toBeInTheDocument();
      expect(screen.getByText("mcorrig4")).toBeInTheDocument();
      expect(screen.getByText("#1")).toBeInTheDocument();
      expect(screen.getByText("#2")).toBeInTheDocument();
    });
  });
});
