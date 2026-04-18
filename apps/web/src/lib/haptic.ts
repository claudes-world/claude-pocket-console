import { getTelegramWebApp } from "./telegram";

function hf() {
  return getTelegramWebApp()?.HapticFeedback;
}

export const haptic = {
  impact(style: "light" | "medium" | "heavy" | "rigid" | "soft" = "light") {
    hf()?.impactOccurred(style);
  },
  success() {
    hf()?.notificationOccurred("success");
  },
  error() {
    hf()?.notificationOccurred("error");
  },
  warning() {
    hf()?.notificationOccurred("warning");
  },
  selection() {
    hf()?.selectionChanged();
  },
};
