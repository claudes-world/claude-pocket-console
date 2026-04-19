import { createPortal } from "react-dom";
import { useRef, useState, useCallback, useEffect } from "react";
import { useDrawerGesture } from "../hooks/useDrawerGesture";
import type { SnapPoint } from "../hooks/useDrawerGesture";
import "./BottomDrawer.css";

interface BottomDrawerProps {
  children: React.ReactNode; // TabDock (always visible at bottom)
  onSnapChange?: (snap: SnapPoint) => void;
  // Imperative handle: parent passes a ref, we assign animateTo into it
  snapToRef?: React.MutableRefObject<((snap: SnapPoint) => void) | null>;
}

export function BottomDrawer({ children, onSnapChange, snapToRef }: BottomDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<SnapPoint>("peek");

  const handleSnapChange = useCallback((s: SnapPoint) => {
    setSnap(s);
    onSnapChange?.(s);
  }, [onSnapChange]);

  const { onTouchStart, onTouchMove, onTouchEnd, animateTo } = useDrawerGesture({
    drawerRef,
    overlayRef,
    onSnapChange: handleSnapChange,
  });

  // Expose animateTo imperatively so App.tsx can call it for onMore
  useEffect(() => {
    if (snapToRef) {
      snapToRef.current = animateTo;
    }
  }, [snapToRef, animateTo]);

  const handleOverlayTap = useCallback(() => {
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

      {/* Drawer shell — 90vh tall, translateY to peek position initially */}
      <div
        ref={drawerRef}
        className="bottom-drawer"
        style={{ transform: `translateY(calc(90vh - var(--dock-height)))` }}
      >
        {/* Drag handle — only visible when half/full */}
        <div
          className={`drawer-handle${snap !== "peek" ? " visible" : ""}`}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="drawer-handle-bar" />
        </div>

        {/* Expandable content area — empty in Phase 2, filled in Phase 3+ */}
        <div className="drawer-content" />

        {/* Tab dock — always at bottom */}
        <div className="drawer-tab-dock">
          {children}
        </div>
      </div>
    </>,
    document.body
  );
}
