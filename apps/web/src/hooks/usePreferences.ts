import { useCallback, useEffect, useRef, useState } from "react";
import { getPref, setPref } from "../lib/cloud-storage";

/**
 * React hook binding a single preference key to the unified cloud-storage
 * wrapper. Returns a three-element tuple [value, setValue, isLoading].
 * `isLoading` is true until the initial storage load resolves; callers can
 * use it to distinguish the default placeholder from the actual stored value.
 * The API is otherwise modeled on useState — so existing components using
 * useState + useEffect(localStorage) can swap in with a minimal diff.
 *
 * Semantics:
 *
 * - The first render returns `defaultValue` synchronously. The actual
 *   stored value loads asynchronously and triggers a re-render once
 *   resolved. Callers should treat the initial value as a placeholder,
 *   NOT as authoritative. For most UI prefs (toggle states, sort orders)
 *   the one-frame flash to the stored value is imperceptible and preferable
 *   to blocking the whole tree on storage.
 *
 * - `setValue` writes optimistically: local state updates immediately and
 *   the storage write happens in the background. If the write fails we log
 *   but do NOT roll back state — preferences are best-effort, and showing
 *   the user's last click survive a refresh (via in-memory state) while a
 *   network-less client silently fails to persist is the expected degraded
 *   behaviour.
 *
 * - `defaultValue` is captured ONCE on first render via a ref. Passing a
 *   fresh object/array literal on every render therefore does not cause
 *   the storage load to re-fire. Callers who want to reset to a new default
 *   should unmount and remount, or call setValue(newDefault) explicitly.
 *
 * - The hook does NOT listen for cross-tab storage events. CPC runs as a
 *   Telegram mini app in a single webview per session; multi-tab sync has
 *   no product value here and adds surface area for race bugs.
 */
export function usePreferences<T>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void, boolean] {
  // Capture the default on first render — see JSDoc note above. Using a ref
  // rather than a useState so we don't burn an extra slot.
  const defaultRef = useRef<T>(defaultValue);
  const [value, setValueState] = useState<T>(defaultValue);
  // isLoading is true until the initial storage load resolves. Callers can
  // use this to distinguish "default placeholder" from "actual stored value",
  // e.g. to defer rendering a controlled input until the true value is known.
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Track mount state so async resolution after unmount doesn't warn /
  // mutate. React 18+ tolerates setState-after-unmount but still logs, and
  // the transient Telegram CloudStorage latency (a few hundred ms) makes
  // unmount-during-load genuinely possible on fast tab switches.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Load once per (key) change. We depend on `key` so a component that
  // dynamically switches keys (rare but not impossible) stays in sync.
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    void getPref<T>(key, defaultRef.current).then((stored) => {
      if (cancelled || !mountedRef.current) return;
      setValueState(stored);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const setValue = useCallback(
    (next: T) => {
      setValueState(next);
      void setPref<T>(key, next).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`usePreferences: failed to persist ${key}`, err);
      });
    },
    [key],
  );

  return [value, setValue, isLoading];
}
