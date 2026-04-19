import { createPortal } from "react-dom";
import { useRef, useState, useCallback, useEffect, useLayoutEffect } from "react";
import { useDrawerGesture } from "../hooks/useDrawerGesture";
import type { SnapPoint } from "../hooks/useDrawerGesture";
import { AppSwitcher } from "./AppSwitcher";
import { MessageTicker } from "./MessageTicker";
import "./BottomDrawer.css";

type Tab = "terminal" | "files" | "links" | "voice" | "prs";

interface BottomDrawerProps {
  children: React.ReactNode;       // TabDock (always visible at bottom)
  drawerContent?: React.ReactNode; // ActionChips (half/full)
  activeTab: Tab;                  // for AppSwitcher
  onTabChange: (tab: Tab) => void; // for AppSwitcher tile tap
  connected?: boolean;             // for MessageTicker
  onSnapChange?: (snap: SnapPoint) => void;
  // Imperative handle: parent passes a ref, we assign animateTo into it
  snapToRef?: React.MutableRefObject<((snap: SnapPoint) => void) | null>;
}

export function BottomDrawer({ children, drawerContent, activeTab, onTabChange, connected, onSnapChange, snapToRef }: BottomDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<SnapPoint>("peek");
  const wasDragging = useRef(false);

  const handleSnapChange = useCallback((s: SnapPoint) => {
    setSnap(s);
    onSnapChange?.(s);
  }, [onSnapChange]);

  const handleDragEnd = useCallback((hasMoved: boolean) => {
    if (hasMoved) {
      wasDragging.current = true;
      setTimeout(() => { wasDragging.current = false; }, 100);
    }
  }, []);

  const handleDragStart = useCallback(() => {
    wasDragging.current = false;
  }, []);

  const { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, animateTo } = useDrawerGesture({
    drawerRef,
    overlayRef,
    onSnapChange: handleSnapChange,
    onDragEnd: handleDragEnd,
    onDragStart: handleDragStart,
  });

  // Expose animateTo imperatively so App.tsx can call it for onMore
  useEffect(() => {
    if (snapToRef) snapToRef.current = animateTo;
    return () => {
      if (snapToRef) snapToRef.current = null;
    };
  }, [snapToRef, animateTo]);

  // Replace CSS-calc initial transform with a resolved px value so DOMMatrix
  // can read it correctly on first touch (WebKit may return NaN for env() expressions).
  // useLayoutEffect fires before paint — no transition flicker on mount.
  useLayoutEffect(() => {
    animateTo("peek", true); // instant = true, no transition on mount
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOverlayTap = useCallback(() => {
    if (wasDragging.current) { wasDragging.current = false; return; }
    animateTo("peek");
  }, [animateTo]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* Dimmed overlay — behind drawer, above content */}
      <div
        ref={overlayRef}
        className="drawer-overlay"
        onClick={handleOverlayTap}
      />

      {/* Drawer shell — 90vh tall; useLayoutEffect writes initial px transform before paint */}
      <div
        ref={drawerRef}
        className="bottom-drawer"
      >
        {/* Tab dock — FIRST in DOM so it's visible in peek (top of shifted-down element).
            Gesture handlers attached here provide drag surface in peek state.
            onTouchEnd only calls stopPropagation when hasMoved=true so pill taps still fire. */}
        <div
          className="drawer-tab-dock"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
        >
          {children}
        </div>

        {/* Message ticker — between tab dock and drawer content */}
        <MessageTicker connected={connected} />

        {/* Drag handle — only visible when half/full */}
        <div
          className={`drawer-handle${snap !== "peek" ? " visible" : ""}`}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
        >
          <div className="drawer-handle-bar" />
        </div>

        {/* AppSwitcher at full, ActionChips (drawerContent) at half — ActionChips remounts on full→half transition;
            useActionBarModals state (debounce timers, audio refs) is discarded when AppSwitcher is open */}
        <div className="drawer-content">
          {snap === "full"
            ? <AppSwitcher activeTab={activeTab} onSelect={(tab) => { onTabChange(tab); animateTo("peek"); }} />
            : drawerContent
          }
        </div>
      </div>
    </>,
    document.body
  );
}
