import React from "react";
import { pushDebug } from "../debug/capture";

type ErrorBoundaryLevel = "root" | "tab";

interface ErrorBoundaryProps {
  /** "root" = full-screen fallback. "tab" reserved for follow-up PRs. */
  level?: ErrorBoundaryLevel;
  /** Optional label, surfaced in console logs. */
  name?: string;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  resetKey: number;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const label = this.props.name ? `:${this.props.name}` : "";
    // Visible in browser devtools and any future debug overlay.
    console.error(`[ErrorBoundary${label}]`, error, info);

    // Bridge to debug overlay capture store
    try {
      pushDebug({
        type: "error",
        message: error.message,
        detail: (error.stack || "") + "\n" + (info.componentStack || ""),
        source: `ErrorBoundary${label}`,
      });
    } catch {
      // Debug bridge must never break the boundary
    }

    // Telegram haptic buzz on crash, if the WebApp object is reachable.
    try {
      const tg = (window as unknown as {
        Telegram?: {
          WebApp?: {
            HapticFeedback?: {
              notificationOccurred?: (type: "error" | "success" | "warning") => void;
            };
          };
        };
      }).Telegram;
      tg?.WebApp?.HapticFeedback?.notificationOccurred?.("error");
    } catch {
      // ignore — haptics are best-effort
    }
  }

  reset = () => {
    this.setState((prev) => ({ error: null, resetKey: prev.resetKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={this.reset}
          onReload={() => window.location.reload()}
        />
      );
    }
    // Bumping the key forces a clean remount of the subtree on retry.
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}

interface ErrorFallbackProps {
  error: Error;
  onRetry: () => void;
  onReload: () => void;
}

function ErrorFallback({ error, onRetry, onReload }: ErrorFallbackProps) {
  // Tokyo Night palette to match the rest of CPC.
  // bg #1a1b26, fg #c0caf5, error accent #f7768e, muted #565f89, action blue #7aa2f7
  return (
    <div
      role="alert"
      style={{
        minHeight: "100dvh",
        width: "100%",
        background: "#1a1b26",
        color: "#c0caf5",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "system-ui, -apple-system, sans-serif",
        gap: 16,
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontSize: 48, lineHeight: 1 }} aria-hidden="true">
        💥
      </div>
      <h1
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: "#f7768e",
          margin: 0,
          textAlign: "center",
        }}
      >
        Claude Pocket Console crashed
      </h1>
      <p
        style={{
          fontSize: 14,
          color: "#a9b1d6",
          margin: 0,
          textAlign: "center",
          maxWidth: 360,
          lineHeight: 1.5,
        }}
      >
        Something went wrong while rendering the app. Tap reload to start fresh, or copy the
        details below to share with Liam.
      </p>

      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 8,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <button
          type="button"
          onClick={onReload}
          style={{
            background: "#7aa2f7",
            color: "#1a1b26",
            border: "none",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Reload app
        </button>
        <button
          type="button"
          onClick={onRetry}
          style={{
            background: "transparent",
            color: "#7aa2f7",
            border: "1px solid #7aa2f7",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => copyErrorDetails(error)}
          style={{
            background: "transparent",
            color: "#565f89",
            border: "1px solid #414868",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Copy details
        </button>
      </div>

      <details
        style={{
          marginTop: 16,
          width: "100%",
          maxWidth: 480,
          background: "#16161e",
          border: "1px solid #2a2b3d",
          borderRadius: 8,
          padding: 12,
        }}
      >
        <summary
          style={{
            color: "#9ece6a",
            fontSize: 12,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          Technical details
        </summary>
        <pre
          style={{
            color: "#c0caf5",
            fontSize: 11,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            marginTop: 8,
            marginBottom: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {formatErrorDetails(error)}
        </pre>
      </details>
    </div>
  );
}

function formatErrorDetails(error: Error): string {
  return [
    `${error.name}: ${error.message}`,
    "",
    error.stack ?? "(no stack trace)",
    "",
    `User Agent: ${navigator.userAgent}`,
    `Timestamp: ${new Date().toISOString()}`,
  ].join("\n");
}

function copyErrorDetails(error: Error) {
  const details = formatErrorDetails(error);

  // Try clipboard API first; fall back to execCommand for older Telegram WebViews.
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(details).catch(() => {
      legacyCopy(details);
    });
  } else {
    legacyCopy(details);
  }
}

function legacyCopy(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } catch {
    // ignore — last-ditch fallback
  }
  document.body.removeChild(textarea);
}
