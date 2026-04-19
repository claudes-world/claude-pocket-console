import { useState, useEffect } from "react";

const DEFAULT_MESSAGES = [
  "CPC v1.12 · Navigation Redesign v2",
  "● Connected · All systems nominal",
  "Swipe up for actions · Tap ⋯ for app switcher",
];

interface MessageTickerProps {
  connected?: boolean;
  extraMessages?: string[];
}

export function MessageTicker({ connected, extraMessages }: MessageTickerProps) {
  const messages = [
    connected !== undefined
      ? `● ${connected ? "Connected" : "Offline"} · CPC v1.12`
      : "CPC v1.12",
    ...DEFAULT_MESSAGES.slice(1),
    ...(extraMessages ?? []),
  ];

  const [currentIdx, setCurrentIdx] = useState(0);

  useEffect(() => {
    setCurrentIdx(0);
    const timer = setInterval(() => {
      setCurrentIdx((prev) => (prev + 1) % messages.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [messages.length]);

  return (
    <div className="message-ticker" aria-live="polite">
      <div className="message-ticker-inner" key={currentIdx}>
        {messages[currentIdx]}
      </div>
    </div>
  );
}
