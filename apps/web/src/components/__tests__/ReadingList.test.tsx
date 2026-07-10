import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingListItem } from "../action-bar/types";

const mockFetchReadingList = vi.fn();
const mockDeleteReadingListItem = vi.fn();
const mockImpact = vi.fn();
const mockSuccess = vi.fn();
const mockError = vi.fn();

vi.mock("../action-bar/api", () => ({
  fetchReadingList: (...args: unknown[]) => mockFetchReadingList(...args),
  deleteReadingListItem: (...args: unknown[]) => mockDeleteReadingListItem(...args),
}));

vi.mock("../../lib/haptic", () => ({
  haptic: {
    impact: (...args: unknown[]) => mockImpact(...args),
    success: (...args: unknown[]) => mockSuccess(...args),
    error: (...args: unknown[]) => mockError(...args),
  },
}));

import { ReadingList } from "../ReadingList";

const items: ReadingListItem[] = [
  {
    id: 2,
    path: "/home/claude/code/new.ts",
    title: "new.ts",
    created_at: Date.now() - 60_000,
  },
  {
    id: 1,
    path: "/home/claude/code/old.ts",
    title: "old.ts",
    created_at: Date.now() - 3_600_000,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchReadingList.mockResolvedValue({ items });
  mockDeleteReadingListItem.mockResolvedValue({ ok: true });
});

describe("ReadingList", () => {
  it("renders the count, server order, file details, and opens a tapped file", async () => {
    const onOpenFile = vi.fn();
    render(<ReadingList onOpenFile={onOpenFile} />);

    await waitFor(() => expect(screen.getByLabelText("2 items")).toBeInTheDocument());
    const names = screen.getAllByRole("button").filter((button) =>
      button.textContent?.includes(".ts") && !button.getAttribute("aria-label"),
    );
    expect(names[0]).toHaveTextContent("new.ts");
    expect(names[1]).toHaveTextContent("old.ts");
    expect(screen.getByText("/home/claude/code/new.ts")).toBeInTheDocument();
    expect(screen.getByText("saved 1m ago")).toBeInTheDocument();

    fireEvent.click(names[0]);
    expect(onOpenFile).toHaveBeenCalledWith("/home/claude/code/new.ts");
    expect(mockImpact).toHaveBeenCalledWith("light");
  });

  it("renders the locked empty state", async () => {
    mockFetchReadingList.mockResolvedValue({ items: [] });
    render(<ReadingList onOpenFile={() => {}} />);

    expect(await screen.findByText("Nothing saved yet — use 'Save to reading list' when viewing a file.")).toBeInTheDocument();
    expect(screen.getByLabelText("0 items")).toBeInTheDocument();
  });

  it("optimistically removes an item while delete is pending", async () => {
    let resolveDelete!: (value: { ok: true }) => void;
    mockDeleteReadingListItem.mockImplementationOnce(() => new Promise((resolve) => { resolveDelete = resolve; }));
    mockFetchReadingList
      .mockResolvedValueOnce({ items })
      .mockResolvedValue({ items: [items[1]] });
    render(<ReadingList onOpenFile={() => {}} />);
    await screen.findByText("new.ts");

    fireEvent.click(screen.getByRole("button", { name: "Remove new.ts" }));
    expect(screen.queryByText("new.ts")).not.toBeInTheDocument();
    expect(mockDeleteReadingListItem).toHaveBeenCalledWith({ id: 2 });

    await act(async () => resolveDelete({ ok: true }));
    await waitFor(() => expect(mockSuccess).toHaveBeenCalled());
    expect(screen.queryByText("new.ts")).not.toBeInTheDocument();
  });

  it("restores an optimistically removed item when delete fails", async () => {
    let rejectDelete!: (error: Error) => void;
    mockDeleteReadingListItem.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDelete = reject; }));
    render(<ReadingList onOpenFile={() => {}} />);
    await screen.findByText("new.ts");

    fireEvent.click(screen.getByRole("button", { name: "Remove new.ts" }));
    expect(screen.queryByText("new.ts")).not.toBeInTheDocument();

    await act(async () => rejectDelete(new Error("Delete failed")));
    await waitFor(() => expect(screen.getByText("new.ts")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Delete failed");
    expect(mockError).toHaveBeenCalled();
  });

  it("restores concurrent failed deletes in newest-first order", async () => {
    const concurrentItems: ReadingListItem[] = [
      { id: 3, path: "/tmp/newest.ts", title: "newest.ts", created_at: 3_000 },
      { id: 2, path: "/tmp/middle.ts", title: "middle.ts", created_at: 2_000 },
      { id: 1, path: "/tmp/oldest.ts", title: "oldest.ts", created_at: 1_000 },
    ];
    let rejectNewest!: (error: Error) => void;
    let rejectMiddle!: (error: Error) => void;
    mockFetchReadingList.mockResolvedValue({ items: concurrentItems });
    mockDeleteReadingListItem
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectNewest = reject; }))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectMiddle = reject; }));

    render(<ReadingList onOpenFile={() => {}} />);
    await screen.findByText("newest.ts");
    fireEvent.click(screen.getByRole("button", { name: "Remove newest.ts" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove middle.ts" }));

    await act(async () => rejectNewest(new Error("Newest delete failed")));
    await act(async () => rejectMiddle(new Error("Middle delete failed")));

    const names = screen.getAllByRole("button").filter((button) =>
      button.textContent?.includes(".ts") && !button.getAttribute("aria-label"),
    );
    expect(names).toHaveLength(3);
    expect(names[0]).toHaveTextContent("newest.ts");
    expect(names[1]).toHaveTextContent("middle.ts");
    expect(names[2]).toHaveTextContent("oldest.ts");
  });
});
