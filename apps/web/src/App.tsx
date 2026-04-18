declare const __APP_VERSION__: string;
import { useState, useEffect, useCallback, useRef } from "react";
import { Terminal } from "./components/Terminal";
import { FileViewer } from "./components/FileViewer";
import type { SortMode } from "./components/FileViewer";
import { Links } from "./components/Links";
import { ActionBar } from "./components/action-bar";
import { VoiceRecorder } from "./components/VoiceRecorder";
import { getTelegramWebApp, getAuthHeaders, hasAuth, setSessionToken } from "./lib/telegram";
import { haptic } from "./lib/haptic";
import { DebugOverlay } from "./debug/DebugOverlay";
import { PrTicker } from "./components/PrTicker";
import { HomeScreenPrompt } from "./components/HomeScreenPrompt";

type Tab = "terminal" | "files" | "links" | "voice" | "prs";
const TABS: Tab[] = ["terminal", "files", "links", "voice", "prs"];
const SWIPE_THRESHOLD = 120;

// Moving blue underline indicator that tracks the active tab and follows
// swipe progress in real time. Replaces the per-button static borderBottom.
// See plan: ~/claudes-world/tmp/20260408-issue-102-tab-underline-plan.md
function TabUnderline({
  tabRefs,
  activeIdx,
  dragOffset,
  isAnimating,
}: {
  tabRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  activeIdx: number;
  dragOffset: number;
  isAnimating: boolean;
}) {
  const [geom, setGeom] = useState<{ left: number; width: number }[]>([]);

  // Measure tab button positions after mount and on window resize.
  // Refs are populated during commit, so the first measure() runs with
  // valid DOM nodes.
  useEffect(() => {
    const measure = () => {
      const buttons = tabRefs.current ?? [];
      const rects = buttons.map((b) => {
        if (!b) return { left: 0, width: 0 };
        return { left: b.offsetLeft, width: b.offsetWidth };
      });
      setGeom(rects);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [tabRefs]);

  if (geom.length === 0 || !geom[activeIdx]) return null;

  // dragOffset is raw finger-delta pixels: negative dx = finger moved left
  // = content strip advances to the NEXT tab = indicator should move right.
  // One full-viewport swipe == one tab of progress, so normalize by viewport.
  const viewportWidth = window.innerWidth || 375;
  const dragFraction = -dragOffset / viewportWidth;
  // Clamp to neighbor range so rubber-banded over-swipe at edges doesn't
  // slingshot the indicator off the tab bar.
  const clampedFraction = Math.max(-1, Math.min(1, dragFraction));

  const targetFloat = activeIdx + clampedFraction;
  const leftIdx = Math.max(0, Math.min(TABS.length - 1, Math.floor(targetFloat)));
  const rightIdx = Math.max(0, Math.min(TABS.length - 1, Math.ceil(targetFloat)));
  const t = targetFloat - leftIdx; // 0..1 interpolation weight

  const leftGeom = geom[leftIdx] ?? geom[activeIdx];
  const rightGeom = geom[rightIdx] ?? geom[activeIdx];

  const interpLeft = leftGeom.left + (rightGeom.left - leftGeom.left) * t;
  const interpWidth = leftGeom.width + (rightGeom.width - leftGeom.width) * t;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        width: interpWidth,
        height: 2,
        background: "var(--color-accent-blue)",
        transform: `translateX(${interpLeft}px)`,
        transition: isAnimating ? "transform 300ms ease-out, width 300ms ease-out" : "none",
        pointerEvents: "none",
      }}
    />
  );
}

const SORT_KEY = "cpc-file-sort-mode";
const HIDDEN_KEY = "cpc-file-show-hidden";
const HOME_SCREEN_PROMPT_KEY = "cpc:home-screen-prompted";
const VALID_SORTS: SortMode[] = ["name-asc", "name-desc", "date-asc", "date-desc"];

export function App() {
  const [authed, setAuthed] = useState(() => hasAuth());
  const [connected, setConnected] = useState(false);
  const hashParams = window.location.hash.replace("#", "");
  const initialFile = hashParams.match(/file=([^&]+)/)?.[1] ? decodeURIComponent(hashParams.match(/file=([^&]+)/)![1]) : null;
  const initialTab = initialFile ? "files" : (hashParams.split("&")[0] || "terminal") as Tab;
  const [activeTab, setActiveTab] = useState<Tab>(
    TABS.includes(initialTab as Tab) ? initialTab : "terminal"
  );
  const [reconnectKey, setReconnectKey] = useState(0);
  const [initialFilePath] = useState<string | null>(initialFile);
  const [fileShowHidden, setFileShowHidden] = useState<boolean>(() => {
    try { return localStorage.getItem(HIDDEN_KEY) === "1"; } catch { return false; }
  });
  const [fileSortMode, setFileSortMode] = useState<SortMode>(() => {
    try {
      const saved = localStorage.getItem(SORT_KEY);
      return VALID_SORTS.includes(saved as SortMode) ? (saved as SortMode) : "name-asc";
    } catch { return "name-asc"; }
  });

  useEffect(() => {
    try { localStorage.setItem(SORT_KEY, fileSortMode); } catch { /* ignore */ }
  }, [fileSortMode]);

  useEffect(() => {
    try { localStorage.setItem(HIDDEN_KEY, fileShowHidden ? "1" : "0"); } catch { /* ignore */ }
  }, [fileShowHidden]);
  const [viewingFile, setViewingFile] = useState<{ path: string; name: string } | null>(null);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [cpcBranch, setCpcBranch] = useState<string | null>(null);
  const [showHomeScreenPrompt, setShowHomeScreenPrompt] = useState(false);

  const onConnectionChange = useCallback((c: boolean) => setConnected(c), []);
  const onReconnect = useCallback(() => {
    fetch("/api/terminal/resize-terminal", { method: "POST" }).catch(() => {});
    setReconnectKey((k) => k + 1);
  }, []);

  // Swipe gesture state
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isDragging = useRef(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  // Refs to each tab button so the moving underline can measure
  // variable-width tab labels.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const activeIdx = TABS.indexOf(activeTab);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isDragging.current = false;
    setIsAnimating(false);
    setDragOffset(0);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    // Only track horizontal swipes where horizontal is dominant
    if (!isDragging.current && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if (!isDragging.current) {
      if (Math.abs(dx) > Math.abs(dy) * 1.2) {
        isDragging.current = true;
      } else {
        return;
      }
    }
    // Clamp: can't swipe past first/last tab
    const currentIdx = TABS.indexOf(activeTab);
    const clampedDx =
      (dx < 0 && currentIdx >= TABS.length - 1) ? Math.min(0, dx * 0.2) :
      (dx > 0 && currentIdx <= 0) ? Math.max(0, dx * 0.2) :
      dx;
    setDragOffset(clampedDx);
  }, [activeTab]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    setIsAnimating(true);
    setDragOffset(0);
    if (isDragging.current && Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const currentIdx = TABS.indexOf(activeTab);
      if (dx < 0 && currentIdx < TABS.length - 1) {
        haptic.selection();
        setActiveTab(TABS[currentIdx + 1]);
      } else if (dx > 0 && currentIdx > 0) {
        haptic.selection();
        setActiveTab(TABS[currentIdx - 1]);
      }
    }
    isDragging.current = false;
  }, [activeTab]);

  useEffect(() => {
    const tg = getTelegramWebApp();
    if (tg) {
      tg.ready();
      tg.expand();
    }
  }, []);

  // Telegram Login Widget callback (for fallback auth)
  useEffect(() => {
    if (authed) return;

    (window as any).onTelegramAuth = async (user: any) => {
      try {
        const res = await fetch("/api/auth/telegram-widget", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user),
        });
        const result = await res.json();
        if (result.ok && result.token) {
          setSessionToken(result.token);
          setAuthed(true);
        }
      } catch (err) {
        console.error("Login failed:", err);
      }
    };

    return () => {
      delete (window as any).onTelegramAuth;
    };
  }, [authed]);

  // Fetch CPC branch on mount and every 30 seconds
  useEffect(() => {
    const fetchCpcBranch = async () => {
      try {
        const res = await fetch("/api/terminal/cpc-branch", { headers: getAuthHeaders() });
        const data = await res.json();
        if (data.ok) setCpcBranch(data.branch);
      } catch { /* silent */ }
    };
    fetchCpcBranch();
    const interval = setInterval(fetchCpcBranch, 30000);
    return () => clearInterval(interval);
  }, []);

  // Home screen prompt — show once if not already added (Bot API 8.0+)
  useEffect(() => {
    try {
      if (localStorage.getItem(HOME_SCREEN_PROMPT_KEY)) return;
    } catch {
      return; // storage blocked (private browsing, etc.) — skip silently
    }

    let active = true;
    const timer = setTimeout(() => {
      const twa = getTelegramWebApp();
      if (!twa?.checkHomeScreenStatus) return; // older client — skip silently
      twa.checkHomeScreenStatus((status) => {
        if (active && status !== "added") {
          setShowHomeScreenPrompt(true);
        }
      });
    }, 3000);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  const handleHomeScreenDismiss = useCallback(() => {
    try {
      localStorage.setItem(HOME_SCREEN_PROMPT_KEY, "1");
    } catch {
      // storage blocked — suppress silently, prompt won't re-appear this session
    }
    setShowHomeScreenPrompt(false);
  }, []);

  // The strip is (TABS.length * 100vw) wide. To show tab N we shift by -(N * 100vw).
  // Expressed as % of the strip: -(N * 100% / TABS.length).
  // dragOffset is in px (finger delta) and should also be expressed relative to strip width,
  // but since we just want pixel-accurate dragging we use a calc mix.
  const stripShift = `calc(${(-activeIdx * 100) / TABS.length}% + ${dragOffset / TABS.length}px)`;

  const isDev = window.location.hostname.includes("cpc-dev") || window.location.pathname.startsWith("/dev");

  // Login screen when no auth available (e.g. opened from reply keyboard button)
  if (!authed) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        height: "100%", background: "var(--color-bg)", color: "var(--color-fg)", padding: 20,
      }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Claude Pocket Console</div>
        <div style={{ fontSize: 13, color: "var(--color-muted)", marginBottom: 24, textAlign: "center" }}>
          Telegram auth unavailable. Sign in to continue.
        </div>
        <div id="telegram-login-container" ref={(el) => {
          if (!el || el.querySelector("script")) return;
          const script = document.createElement("script");
          script.src = "https://telegram.org/js/telegram-widget.js?22";
          script.setAttribute("data-telegram-login", "claude_do_bot");
          script.setAttribute("data-size", "large");
          script.setAttribute("data-onauth", "onTelegramAuth(user)");
          script.setAttribute("data-request-access", "write");
          script.async = true;
          el.appendChild(script);
        }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", maxWidth: "100vw", overflowX: "hidden" }}>
      {/* Dev mode banner */}
      {isDev && (
        <div style={{
          background: "#f59e0b",
          color: "#000",
          textAlign: "center",
          fontSize: 11,
          fontWeight: 700,
          padding: "2px 0",
          letterSpacing: "0.1em",
          flexShrink: 0,
        }}>
          DEVELOPMENT
        </div>
      )}
      {/* Header with tabs — stop propagation so swipe doesn't fire from tab bar */}
      <header
        style={{
          padding: "0 12px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          height: 40,
        }}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", gap: 0, position: "relative" }}>
          {TABS.map((tab, i) => (
            <button
              ref={(el) => { tabRefs.current[i] = el; }}
              key={tab}
              onClick={() => { haptic.selection(); setIsAnimating(true); setActiveTab(tab); }}
              style={{
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: activeTab === tab ? 600 : 400,
                background: "none",
                color: activeTab === tab ? "var(--color-fg)" : "var(--color-muted)",
                border: "none",
                // borderBottom removed — moving indicator below replaces it
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {tab}
            </button>
          ))}
          <TabUnderline
            tabRefs={tabRefs}
            activeIdx={activeIdx}
            dragOffset={dragOffset}
            isAnimating={isAnimating}
          />
        </div>
        <span
          style={{
            fontSize: 11,
            color: connected ? "var(--color-accent-green)" : "var(--color-accent-red)",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: connected ? "var(--color-accent-green)" : "var(--color-accent-red)",
              display: "inline-block",
            }}
          />
          {connected ? "live" : "offline"}
        </span>
      </header>

      {/* CPC branch indicator — terminal tab only */}
      {activeTab === "terminal" && cpcBranch && (
        <div
          style={{
            fontSize: 11,
            color: "var(--color-muted)",
            padding: "3px 14px",
            borderBottom: "1px solid var(--color-border)",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
          }}
        >
          <span>Claude Pocket Console: {cpcBranch}</span>
          <span style={{ marginLeft: "auto", color: "var(--color-subtle)" }}>{__APP_VERSION__}</span>
        </div>
      )}

      {/* Content area — swipeable viewport */}
      <div
        style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Sliding strip of all tab contents */}
        <div
          style={{
            display: "flex",
            width: `${TABS.length * 100}%`,
            height: "100%",
            transform: `translateX(${stripShift})`,
            transition: isAnimating ? "transform 300ms ease-out" : "none",
            willChange: "transform",
          }}
          onTransitionEnd={() => setIsAnimating(false)}
        >
          <div style={{ width: `${100 / TABS.length}%`, height: "100%", flexShrink: 0 }}>
            <Terminal key={reconnectKey} onConnectionChange={onConnectionChange} isActive={activeTab === "terminal"} />
          </div>
          <div style={{ width: `${100 / TABS.length}%`, height: "100%", flexShrink: 0 }}>
            <FileViewer onClose={() => setActiveTab("terminal")} initialFile={initialFilePath} showHidden={fileShowHidden} sortMode={fileSortMode} onSortModeChange={setFileSortMode} onViewChange={setViewingFile} onPathChange={setCurrentFolder} />
          </div>
          <div style={{ width: `${100 / TABS.length}%`, height: "100%", flexShrink: 0 }}>
            <Links onClose={() => setActiveTab("terminal")} />
          </div>
          <div style={{ width: `${100 / TABS.length}%`, height: "100%", flexShrink: 0 }}>
            <VoiceRecorder />
          </div>
          <div style={{ width: `${100 / TABS.length}%`, height: "100%", flexShrink: 0 }}>
            <PrTicker />
          </div>
        </div>
      </div>

      {/* Action bar — stop propagation so swipe doesn't fire from action buttons */}
      <div onTouchStart={(e) => e.stopPropagation()}>
        <ActionBar
          onReconnect={onReconnect}
          connected={connected}
          activeTab={activeTab}
          fileShowHidden={fileShowHidden}
          setFileShowHidden={setFileShowHidden}
          fileSortMode={fileSortMode}
          setFileSortMode={setFileSortMode}
          viewingFile={viewingFile}
          currentFolder={currentFolder}
        />
      </div>

      {/* Home screen prompt — rendered once, dismissed to localStorage */}
      {showHomeScreenPrompt && <HomeScreenPrompt onDismiss={handleHomeScreenDismiss} />}

      {/* Dev-only debug overlay — renders nothing on production hostnames */}
      <DebugOverlay />
    </div>
  );
}
