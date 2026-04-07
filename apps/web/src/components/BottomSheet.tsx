import { useState, useRef, useCallback, useEffect } from "react";

/** Hook: swipe-down-to-close — ONLY from header/drag handle area */
function useSwipeDown(onClose: () => void, threshold = 80) {
  const startY = useRef(0);
  const currentY = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation(); // prevent Telegram mini app from minimizing
    startY.current = e.touches[0].clientY;
    currentY.current = e.touches[0].clientY;
    if (sheetRef.current) sheetRef.current.style.transition = "none";
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    currentY.current = e.touches[0].clientY;
    const dy = currentY.current - startY.current;
    if (dy > 0 && sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    const dy = currentY.current - startY.current;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "transform 200ms ease-out";
      if (dy > threshold) {
        sheetRef.current.style.transform = "translateY(100%)";
        setTimeout(onClose, 200);
      } else {
        sheetRef.current.style.transform = "translateY(0)";
      }
    }
  }, [onClose, threshold]);

  return { sheetRef, onTouchStart, onTouchMove, onTouchEnd };
}

interface BottomSheetProps {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

/** Bottom sheet — swipe-to-close ONLY from header, content scrolls independently */
export function BottomSheet({ onClose, title, children }: BottomSheetProps) {
  const { sheetRef, onTouchStart, onTouchMove, onTouchEnd } = useSwipeDown(onClose);
  const [bottomOffset, setBottomOffset] = useState(0);

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.safeAreaInset?.bottom) setBottomOffset(tg.safeAreaInset.bottom);
  }, []);

  // Disable Telegram's swipe-to-minimize while bottom sheet is open (Bot API 7.7+)
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.disableVerticalSwipes) tg.disableVerticalSwipes();
    return () => {
      if (tg?.enableVerticalSwipes) tg.enableVerticalSwipes();
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1a1b26",
          borderTop: "1px solid #2a2b3d",
          borderRadius: "16px 16px 0 0",
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          paddingBottom: bottomOffset,
          animation: "slideUp 200ms ease-out",
        }}
      >
        {/* Header — ONLY this area triggers swipe-to-close */}
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{ padding: "12px 16px 0", cursor: "grab", flexShrink: 0 }}
        >
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "#3b3d57" }} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#c0caf5", marginBottom: 12 }}>
            {title}
          </div>
        </div>
        {/* Content — scrolls independently, does NOT trigger swipe-to-close or Telegram minimize */}
        <div style={{ overflowY: "auto", padding: "0 16px 24px", flex: 1, minHeight: 0 }}>
          {children}
        </div>
      </div>
      <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  );
}
