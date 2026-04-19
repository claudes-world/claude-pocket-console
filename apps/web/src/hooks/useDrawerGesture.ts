import { useRef, useCallback } from "react";

export type SnapPoint = "peek" | "half" | "full";

/** Read --dock-height CSS variable so JS peek position matches CSS exactly (safe-area-aware). */
function getDockHeight(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--dock-height").trim();
  return parseFloat(raw) || 48;
}

interface UseDrawerGestureConfig {
  drawerRef: React.RefObject<HTMLDivElement | null>;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  onSnapChange: (snap: SnapPoint) => void;
  onDragEnd?: () => void;
}

// Snap positions as translateY values (drawer is 90vh tall):
// peek: translateY(calc(90vh - 48px - env(safe-area-inset-bottom, 0px)))  → shows 48px
// half: translateY(50vh)   → shows 40vh
// full: translateY(0)      → shows 90vh

export function useDrawerGesture({ drawerRef, overlayRef, onSnapChange, onDragEnd }: UseDrawerGestureConfig) {
  const snapRef = useRef<SnapPoint>("peek");
  const startY = useRef(0);
  const startTranslateY = useRef(0);
  const lastY = useRef(0);
  const lastTime = useRef(0);
  const velocity = useRef(0);

  const getTranslateYForSnap = useCallback((snap: SnapPoint): number => {
    const vh = window.innerHeight;
    const drawerH = vh * 0.9;
    switch (snap) {
      case "peek": return drawerH - getDockHeight(); // safe-area-aware via CSS var
      case "half": return vh * 0.5;
      case "full": return 0;
    }
  }, []);

  const animateTo = useCallback((snap: SnapPoint) => {
    const el = drawerRef.current;
    const overlay = overlayRef.current;
    if (!el) return;
    const y = getTranslateYForSnap(snap);
    el.style.transition = "transform 300ms cubic-bezier(0.25, 1, 0.5, 1)";
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
    // Disable Telegram vertical swipe dismissal as soon as a drag begins
    const tg = (window as any).Telegram?.WebApp;
    tg?.disableVerticalSwipes?.();
    const touch = e.touches[0];
    startY.current = touch.clientY;
    lastY.current = touch.clientY;
    lastTime.current = Date.now();
    velocity.current = 0;
    startTranslateY.current = getCurrentTranslateY();
    const el = drawerRef.current;
    if (el) {
      el.style.transition = "none";
    }
  }, [drawerRef, getCurrentTranslateY]);

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
  }, [drawerRef]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
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

    onDragEnd?.();
    animateTo(target);
  }, [getCurrentTranslateY, animateTo, onDragEnd]);

  return { onTouchStart, onTouchMove, onTouchEnd, animateTo, snapRef };
}
