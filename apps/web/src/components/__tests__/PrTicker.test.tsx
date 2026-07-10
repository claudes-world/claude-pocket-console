import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PrTicker } from "../PrTicker";

// --- Mocks ---

// Mock the telegram auth module
vi.mock("../../lib/telegram", () => ({
  getAuthHeaders: () => ({ Authorization: "tma test-init-data" }),
  getTelegramWebApp: () => null,
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

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    key: "claudes-world/inbox#215",
    repo: "claudes-world/inbox",
    number: 215,
    title: "Add issues mode",
    state: "OPEN",
    author: "octocat",
    updatedAt: new Date().toISOString(),
    labels: ["enhancement", "web", "mobile", "fourth-hidden"],
    url: "https://github.com/claudes-world/inbox/issues/215",
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

  it("renders an org named constructor without a saved repo order", async () => {
    const repo = makeRepo({
      name: "repo",
      org: "constructor",
      fullName: "constructor/repo",
      prCount: 0,
    });
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
      expect(screen.getByText("constructor")).toBeInTheDocument();
      expect(screen.getByText("repo")).toBeInTheDocument();
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

  it("hides a repo from the main list through the manage sheet", async () => {
    const inboxPr = makePr({ number: 1, title: "Inbox PR", key: "claudes-world/inbox#1" });
    const cpcPr = makePr({
      number: 2,
      title: "CPC PR",
      repo: "claudes-world/claude-pocket-console",
      key: "claudes-world/claude-pocket-console#2",
    });
    const inbox = makeRepo({ prCount: 1 });
    const cpc = makeRepo({ name: "claude-pocket-console", fullName: "claudes-world/claude-pocket-console", prCount: 1 });

    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [inboxPr, cpcPr], repos: [inbox, cpc], lastPollOk: Date.now() }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<PrTicker />);
    await waitFor(() => expect(screen.getByText("CPC PR")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Manage PR view" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide repo claudes-world/claude-pocket-console" }));

    await waitFor(() => {
      expect(screen.queryByText("CPC PR")).not.toBeInTheDocument();
      expect(screen.getByText("Inbox PR")).toBeInTheDocument();
      expect(screen.getByText("1 hidden")).toBeInTheDocument();
      expect(screen.getByText("1 repos")).toBeInTheDocument();
    });
  });

  it("applies org reordering from the manage sheet to the main list", async () => {
    const alphaRepo = makeRepo({ name: "one", org: "alpha", fullName: "alpha/one" });
    const zetaRepo = makeRepo({ name: "two", org: "zeta", fullName: "zeta/two" });

    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [], repos: [alphaRepo, zetaRepo], lastPollOk: Date.now() }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<PrTicker />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Manage PR view" }));
    fireEvent.click(screen.getByRole("button", { name: "Move org zeta up" }));

    const mainAlpha = screen.getAllByText("alpha")[0];
    const mainZeta = screen.getAllByText("zeta")[0];
    expect(mainZeta.compareDocumentPosition(mainAlpha) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("persists repo collapse across remounts", async () => {
    const pr = makePr({ number: 7, title: "Persisted collapse", key: "claudes-world/inbox#7" });
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

    const first = render(<PrTicker />);
    await waitFor(() => expect(screen.getByText("Persisted collapse")).toBeInTheDocument());
    fireEvent.click(screen.getByText("inbox"));
    await waitFor(() => expect(screen.queryByText("Persisted collapse")).not.toBeInTheDocument());

    expect(JSON.parse(localStorageMock.getItem("cpc-pr-view-prefs") ?? "{}").collapsedRepos)
      .toEqual(["claudes-world/inbox"]);

    first.unmount();
    render(<PrTicker />);
    await waitFor(() => expect(screen.getByText("inbox")).toBeInTheDocument());
    expect(screen.queryByText("Persisted collapse")).not.toBeInTheDocument();
  });

  it("switches between PRs and Issues and force-refreshes visible repo issues", async () => {
    const pr = makePr({ title: "PR-only title" });
    const issue = makeIssue();
    const repo = makeRepo({ prCount: 1 });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [pr], repos: [repo], lastPollOk: Date.now() }),
        };
      }
      if (url === "/api/prs/icons") {
        return { ok: true, json: async () => ({ ok: true, icons: {} }) };
      }
      if (url.startsWith("/api/prs/issues?")) {
        return { ok: true, json: async () => ({ ok: true, issues: [issue] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    render(<PrTicker />);
    await waitFor(() => expect(screen.getByText("PR-only title")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Issues" }));
    await waitFor(() => {
      expect(screen.getByText("Add issues mode")).toBeInTheDocument();
      expect(screen.queryByText("PR-only title")).not.toBeInTheDocument();
    });
    expect(screen.getByText("enhancement")).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.getByText("mobile")).toBeInTheDocument();
    expect(screen.queryByText("fourth-hidden")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh issues" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/prs/issues?repo=claudes-world%2Finbox&force=1",
        expect.objectContaining({ headers: { Authorization: "tma test-init-data" } }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "PRs" }));
    expect(screen.getByText("PR-only title")).toBeInTheDocument();
  });

  it("does not fetch issues during the 10-second PR polling interval", async () => {
    const repo = makeRepo();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [], repos: [repo], lastPollOk: Date.now() }),
        };
      }
      if (url === "/api/prs/icons") {
        return { ok: true, json: async () => ({ ok: true, icons: {} }) };
      }
      if (url.startsWith("/api/prs/issues?")) {
        return { ok: true, json: async () => ({ ok: true, issues: [] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    render(<PrTicker />);
    await waitFor(() => expect(screen.getByText("inbox")).toBeInTheDocument());
    await vi.advanceTimersByTimeAsync(20_000);

    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/prs/issues?"))).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/prs").length).toBeGreaterThanOrEqual(3);

    fireEvent.click(screen.getByRole("button", { name: "Issues" }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/prs/issues?"))).toHaveLength(1);
    });
  });

  it("renders repo icons once with org-avatar and text-only fallbacks", async () => {
    const inbox = makeRepo();
    const cpc = makeRepo({ name: "cpc", fullName: "claudes-world/cpc" });
    const icon = "data:image/png;base64,aWNvbg==";
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/prs") {
        return {
          ok: true,
          json: async () => ({ ok: true, prs: [], repos: [inbox, cpc], lastPollOk: Date.now() }),
        };
      }
      if (url === "/api/prs/icons") {
        return {
          ok: true,
          json: async () => ({ ok: true, icons: { "claudes-world/inbox": icon } }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    render(<PrTicker />);
    const repoIcon = await screen.findByAltText("inbox icon");
    const orgAvatar = screen.getByAltText("claudes-world avatar");

    expect(repoIcon).toHaveAttribute("src", icon);
    expect(orgAvatar).toHaveAttribute("src", "https://avatars.githubusercontent.com/claudes-world?s=32");
    expect(screen.queryByAltText("cpc icon")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/prs/icons")).toHaveLength(1);

    fireEvent.error(repoIcon);
    expect(repoIcon).toHaveStyle({ display: "none" });
  });
});
