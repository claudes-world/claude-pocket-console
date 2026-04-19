import { useRef, useCallback, useEffect } from "react";

export type SnapPoint = "peek" | "half" | "full";

/** Resolve dock height using Telegram WebApp safe-area API (matches BottomSheet.tsx pattern). */
function getDockHeight(): number {
  const safeArea = (window as any).Telegram?.WebApp?.safeAreaInset?.bottom ?? 0;
  return 48 + safeArea;
}

interface UseDrawerGestureConfig {
  drawerRef: React.RefObject<HTMLDivElement | null>;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  onSnapChange: (snap: SnapPoint) => void;
  onDragEnd?: (hasMoved: boolean) => void;
  onDragStart?: () => void;
}

// Snap positions as translateY values (drawer is 90vh tall):
// peek: translateY(calc(90vh - 48px - env(safe-area-inset-bottom, 0px)))  → shows 48px
// half: translateY(50vh)   → shows 40vh
// full: translateY(0)      → shows 90vh

export function useDrawerGesture({ drawerRef, overlayRef, onSnapChange, onDragEnd, onDragStart }: UseDrawerGestureConfig) {
  const snapRef = useRef<SnapPoint>("peek");
  const startY = useRef(0);
  const startTranslateY = useRef(0);
  const lastY = useRef(0);
  const lastTime = useRef(0);
  const velocity = useRef(0);
  const hasMoved = useRef(false);

  const getTranslateYForSnap = useCallback((snap: SnapPoint): number => {
    const vh = window.innerHeight;
    const drawerH = vh * 0.9;
    switch (snap) {
      case "peek": return drawerH - getDockHeight(); // safe-area-aware via CSS var
      case "half": return vh * 0.5;
      case "full": return 0;
    }
  }, []);

  const animateTo = useCallback((snap: SnapPoint, instant = false) => {
    const el = drawerRef.current;
    const overlay = overlayRef.current;
    if (!el) return;
    const y = getTranslateYForSnap(snap);
    el.style.transition = instant ? "none" : "transform 300ms cubic-bezier(0.25, 1, 0.5, 1)";
    el.style.transform = `translateY(${y}px)`;
    // Update overlay opacity
    if (overlay) {
      overlay.style.transition = "background 300ms ease-out";
      if (snap === "peek") {
        overlay.style.background = "rgba(0,0,0,0)";
        overlay.style.pointerEvents = "none";
      } else {
        overlay.style.background = "rgba(0,0,0,0.4)";
        overlay.style.pointerEvents = "auto";
      }
    }
    // Telegram swipe API
    const tg = (window as any).Telegram?.WebApp;
    if (snap === "peek") {
      tg?.enableVerticalSwipes?.();
    } else {
      tg?.disableVerticalSwipes?.();
    }
    snapRef.current = snap;
    onSnapChange(snap);
  }, [drawerRef, overlayRef, getTranslateYForSnap, onSnapChange]);

  const getCurrentTranslateY = useCallback((): number => {
    const el = drawerRef.current;
    if (!el) return getTranslateYForSnap("peek");
    const style = window.getComputedStyle(el);
    const transform = style.transform;
    if (!transform || transform === "none") return getTranslateYForSnap("peek");
    try {
      const matrix = new DOMMatrix(transform);
      return isNaN(matrix.m42) ? getTranslateYForSnap("peek") : matrix.m42;
    } catch {
      return getTranslateYForSnap("peek");
    }
  }, [drawerRef, getTranslateYForSnap]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    onDragStart?.();
    // Disable Telegram vertical swipe dismissal as soon as a drag begins
    const tg = (window as any).Telegram?.WebApp;
    tg?.disableVerticalSwipes?.();
    const touch = e.touches[0];
    startY.current = touch.clientY;
    lastY.current = touch.clientY;
    lastTime.current = Date.now();
    velocity.current = 0;
    hasMoved.current = false;
    startTranslateY.current = getCurrentTranslateY();
    const el = drawerRef.current;
    if (el) {
      el.style.transition = "none";
    }
  }, [drawerRef, getCurrentTranslateY, onDragStart]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    const touch = e.touches[0];
    const dy = touch.clientY - startY.current;
    const now = Date.now();
    const dt = now - lastTime.current;
    if (dt > 0) {
      velocity.current = (touch.clientY - lastY.current) / dt; // px/ms, positive = down
    }
    lastY.current = touch.clientY;
    lastTime.current = now;
    if (Math.abs(touch.clientY - startY.current) > 5) {
      hasMoved.current = true;
    }

    const el = drawerRef.current;
    if (!el) return;

    const vh = window.innerHeight;
    const drawerH = vh * 0.9;
    let targetY = startTranslateY.current + dy;

    // Rubber-band at edges
    const minY = 0; // full
    const maxY = drawerH - getDockHeight(); // peek — safe-area-aware
    if (targetY < minY) {
      targetY = minY + (targetY - minY) * 0.3;
    } else if (targetY > maxY) {
      targetY = maxY + (targetY - maxY) * 0.3;
    }

    el.style.transform = `translateY(${targetY}px)`;

    // Update overlay in real-time during drag
    const overlay = overlayRef.current;
    if (overlay && hasMoved.current) {
      const peekY = drawerH - getDockHeight();
      // progress: 0 = at peek, 1 = at full
      const progress = Math.max(0, Math.min(1, (peekY - targetY) / peekY));
      overlay.style.transition = "none";
      overlay.style.background = `rgba(0,0,0,${0.4 * progress})`;
      overlay.style.pointerEvents = progress > 0.05 ? "auto" : "none";
    }
  }, [drawerRef, overlayRef]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!hasMoved.current) {
      // Tap, not drag — re-enable Telegram swipes if we're at peek
      if (snapRef.current === "peek") {
        const tg = (window as any).Telegram?.WebApp;
        tg?.enableVerticalSwipes?.();
      }
      return;
    }
    e.preventDefault(); // prevent browser from synthesizing a click after a drag gesture
    e.stopPropagation();
    const vh = window.innerHeight;
    const drawerH = vh * 0.9;
    const currentY = getCurrentTranslateY();
    const v = velocity.current; // px/ms, positive = downward

    const peekY = drawerH - getDockHeight();
    const halfY = vh * 0.5;
    const fullY = 0;

    let target: SnapPoint;

    // Velocity-based flick detection (> 0.5px/ms)
    if (v > 0.5) {
      // Fast flick down
      if (snapRef.current === "full") target = "half";
      else target = "peek";
    } else if (v < -0.5) {
      // Fast flick up
      if (snapRef.current === "peek") target = "half";
      else target = "full";
    } else {
      // Position-based snap — nearest point
      const distToPeek = Math.abs(currentY - peekY);
      const distToHalf = Math.abs(currentY - halfY);
      const distToFull = Math.abs(currentY - fullY);
      const min = Math.min(distToPeek, distToHalf, distToFull);
      if (min === distToFull) target = "full";
      else if (min === distToHalf) target = "half";
      else target = "peek";
    }

    onDragEnd?.(hasMoved.current);
    animateTo(target);
  }, [getCurrentTranslateY, animateTo, onDragEnd]);

  const onTouchCancel = useCallback(() => {
    const tg = (window as any).Telegram?.WebApp;
    // Only re-enable vertical swipes if we're at peek — don't re-enable while expanded overlay is showing
    if (snapRef.current === "peek") {
      tg?.enableVerticalSwipes?.();
    }
    // Snap back to current snap point instantly — no transition
    const el = drawerRef.current;
    if (el) {
      const y = getTranslateYForSnap(snapRef.current);
      el.style.transition = "none";
      el.style.transform = `translateY(${y}px)`;
    }
    // Reset overlay if cancelled while at peek — otherwise it freezes at partial opacity
    if (snapRef.current === "peek" && overlayRef.current) {
      overlayRef.current.style.transition = "none";
      overlayRef.current.style.background = "rgba(0,0,0,0)";
      overlayRef.current.style.pointerEvents = "none";
    }
  }, [drawerRef, overlayRef, getTranslateYForSnap]);

  // Re-enable Telegram vertical swipes on unmount
  useEffect(() => {
    return () => {
      const tg = (window as any).Telegram?.WebApp;
      tg?.enableVerticalSwipes?.();
    };
  }, []);

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, animateTo, snapRef };
}
