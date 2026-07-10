import { useCallback, useEffect, useRef, useState } from "react";
import { deleteReadingListItem, fetchReadingList } from "./action-bar/api";
import type { ReadingListItem } from "./action-bar/types";
import { haptic } from "../lib/haptic";
import { emitReadingListChanged, READING_LIST_CHANGED_EVENT } from "../lib/reading-list-events";

interface ReadingListProps {
  onOpenFile: (path: string) => void;
}

function fileName(item: ReadingListItem): string {
  return item.title || item.path.split("/").pop() || item.path;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ReadingList({ onOpenFile }: ReadingListProps) {
  const [items, setItems] = useState<ReadingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSeqRef = useRef(0);

  const loadItems = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchReadingList();
      if (seq === loadSeqRef.current) setItems(data.items);
    } catch (err) {
      if (seq === loadSeqRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load reading list");
      }
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
    const refresh = () => void loadItems();
    window.addEventListener(READING_LIST_CHANGED_EVENT, refresh);
    return () => {
      ++loadSeqRef.current;
      window.removeEventListener(READING_LIST_CHANGED_EVENT, refresh);
    };
  }, [loadItems]);

  const removeItem = async (item: ReadingListItem) => {
    haptic.impact("light");
    setError(null);
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    try {
      await deleteReadingListItem({ id: item.id });
      haptic.success();
      emitReadingListChanged();
    } catch (err) {
      haptic.error();
      setItems((current) => {
        if (current.some((candidate) => candidate.id === item.id)) return current;
        return [...current, item].sort((a, b) => b.created_at - a.created_at);
      });
      setError(err instanceof Error ? err.message : "Failed to remove item");
    }
  };

  return (
    <section
      aria-label="Reading List"
      style={{
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg)",
      }}
    >
      <div
        style={{
          padding: "12px 16px 8px",
          display: "flex",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <span style={{ color: "var(--color-fg)", fontSize: 14, fontWeight: 600 }}>
          Reading List
        </span>
        <span aria-label={`${items.length} items`} style={{ color: "var(--color-muted)", fontSize: 12 }}>
          {items.length}
        </span>
      </div>

      {loading && items.length === 0 ? (
        <div style={{ padding: "4px 16px 14px", color: "var(--color-muted)", fontSize: 12 }}>
          Loading…
        </div>
      ) : items.length === 0 && !error ? (
        <div style={{ padding: "4px 16px 14px", color: "var(--color-muted)", fontSize: 12 }}>
          Nothing saved yet — use 'Save to reading list' when viewing a file.
        </div>
      ) : (
        items.map((item) => {
          const name = fileName(item);
          return (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 10px 9px 16px",
                borderTop: "1px solid var(--color-separator)",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  haptic.impact("light");
                  onOpenFile(item.path);
                }}
                style={{
                  minWidth: 0,
                  flex: 1,
                  padding: 0,
                  border: "none",
                  background: "none",
                  textAlign: "left",
                }}
              >
                <div
                  style={{
                    color: "var(--color-fg)",
                    fontSize: 13,
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {name}
                </div>
                <div
                  title={item.path}
                  style={{
                    color: "var(--color-muted)",
                    fontSize: 11,
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.path}
                </div>
                <div style={{ color: "var(--color-subtle)", fontSize: 10, marginTop: 2 }}>
                  saved {timeAgo(item.created_at)}
                </div>
              </button>
              <button
                type="button"
                aria-label={`Remove ${name}`}
                title="Remove from reading list"
                onClick={() => void removeItem(item)}
                style={{
                  width: 30,
                  height: 30,
                  flexShrink: 0,
                  padding: 0,
                  borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  color: "var(--color-accent-red)",
                  fontSize: 14,
                }}
              >
                ✕
              </button>
            </div>
          );
        })
      )}

      {error && (
        <div role="alert" style={{ padding: "4px 16px 10px", color: "var(--color-accent-red)", fontSize: 11 }}>
          {error}
        </div>
      )}
    </section>
  );
}
