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

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
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
          level={this.props.level ?? "root"}
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
  level: ErrorBoundaryLevel;
  onRetry: () => void;
  onReload: () => void;
}

function ErrorFallback({ error, level, onRetry, onReload }: ErrorFallbackProps) {
  // Tokyo Night palette to match the rest of CPC.
  // bg var(--color-bg), fg var(--color-fg), error accent var(--color-accent-red), muted var(--color-muted), action blue var(--color-accent-blue)
  return (
    <div
      role="alert"
      style={{
        minHeight: level === "tab" ? "100%" : "100dvh",
        width: "100%",
        background: "var(--color-bg)",
        color: "var(--color-fg)",
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
          color: "var(--color-accent-red)",
          margin: 0,
          textAlign: "center",
        }}
      >
        Claude Pocket Console crashed
      </h1>
      <p
        style={{
          fontSize: 14,
          color: "var(--color-fg-muted)",
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
            background: "var(--color-accent-blue)",
            color: "var(--color-bg)",
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
            color: "var(--color-accent-blue)",
            border: "1px solid var(--color-accent-blue)",
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
            color: "var(--color-muted)",
            border: "1px solid var(--color-border-alt)",
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
          background: "var(--color-bg-alt)",
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          padding: 12,
        }}
      >
        <summary
          style={{
            color: "var(--color-accent-green)",
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
            color: "var(--color-fg)",
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
