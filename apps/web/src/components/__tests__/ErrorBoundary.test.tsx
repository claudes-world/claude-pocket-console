import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "../ErrorBoundary";

// Suppress console.error from ErrorBoundary.componentDidCatch and React's
// own error-boundary logging — they're expected in these tests.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Mock the debug capture module so pushDebug doesn't need a real install
vi.mock("../../debug/capture", () => ({
  pushDebug: vi.fn(),
}));

// A component that always throws on render
function ThrowingChild({ message }: { message: string }): never {
  throw new Error(message);
}

// A component that renders normally
function GoodChild() {
  return <div data-testid="good-child">All good</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary>
        <GoodChild />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("good-child")).toBeInTheDocument();
    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("renders fallback UI when a child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="Kaboom!" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Claude Pocket Console crashed")).toBeInTheDocument();
  });

  it("shows the error message in technical details", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="test error details" />
      </ErrorBoundary>,
    );
    // The details section contains the formatted error
    const details = screen.getByText(/test error details/);
    expect(details).toBeInTheDocument();
  });

  it("renders 'Reload app', 'Try again', and 'Copy details' buttons", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="crash" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Reload app")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
    expect(screen.getByText("Copy details")).toBeInTheDocument();
  });

  it("recovers when 'Try again' is clicked and child no longer throws", () => {
    let shouldThrow = true;
    function MaybeThrow() {
      if (shouldThrow) throw new Error("initial crash");
      return <div data-testid="recovered">Recovered!</div>;
    }

    render(
      <ErrorBoundary>
        <MaybeThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Fix the child, then retry
    shouldThrow = false;
    fireEvent.click(screen.getByText("Try again"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("recovered")).toBeInTheDocument();
  });

  it("calls window.location.reload when 'Reload app' is clicked", () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadMock },
      writable: true,
    });

    render(
      <ErrorBoundary>
        <ThrowingChild message="crash" />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByText("Reload app"));
    expect(reloadMock).toHaveBeenCalledOnce();
  });

  it("uses level='tab' to set minHeight to 100% instead of 100dvh", () => {
    render(
      <ErrorBoundary level="tab">
        <ThrowingChild message="tab crash" />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.style.minHeight).toBe("100%");
  });

  it("uses level='root' (default) to set minHeight to 100dvh", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="root crash" />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.style.minHeight).toBe("100dvh");
  });

  it("passes the name prop into console.error label", () => {
    const consoleSpy = vi.mocked(console.error);

    render(
      <ErrorBoundary name="TestPanel">
        <ThrowingChild message="named crash" />
      </ErrorBoundary>,
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      "[ErrorBoundary:TestPanel]",
      expect.any(Error),
      expect.anything(),
    );
  });

  it("calls pushDebug from the capture module on error", async () => {
    const { pushDebug } = await import("../../debug/capture");

    render(
      <ErrorBoundary name="DebugTest">
        <ThrowingChild message="debug bridge test" />
      </ErrorBoundary>,
    );

    expect(pushDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        message: "debug bridge test",
        source: "ErrorBoundary:DebugTest",
      }),
    );
  });
});
