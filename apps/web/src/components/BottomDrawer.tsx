import { createPortal } from "react-dom";
import "./BottomDrawer.css";

interface BottomDrawerProps {
  children: React.ReactNode;
}

export function BottomDrawer({ children }: BottomDrawerProps) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="bottom-drawer">
      {children}
    </div>,
    document.body
  );
}
