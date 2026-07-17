import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BAND_MIN_CONTENT_INSET, VersionBadge } from "../VersionBadge";

/**
 * VersionBadge (WORLD-416 §3.1): band badge inside the Telegram fullscreen
 * chrome vs the pre-v2 in-flow fallback row, switched at the 24px content
 * safe-area threshold.
 */

const baseProps = {
  branch: "dev",
  version: "v1.17.0",
  deviceInset: 47,
  isDev: false,
  fallbackVisible: true,
};

describe("VersionBadge", () => {
  it("renders the chrome-band badge at contentInset >= 24, out of flow and inert", () => {
    render(<VersionBadge {...baseProps} contentInset={BAND_MIN_CONTENT_INSET} />);
    const band = screen.getByTestId("version-badge-band");
    expect(band.style.position).toBe("absolute");
    expect(band.style.top).toBe("47px");
    expect(band.style.height).toBe("24px");
    // Taps in the band must reach Telegram's native pills, never the badge.
    expect(band.style.pointerEvents).toBe("none");
    expect(band.textContent).toContain("CPC");
    expect(band.textContent).toContain("dev");
    expect(band.textContent).toContain("v1.17.0");
    expect(screen.queryByTestId("version-badge-row")).toBeNull();
  });

  it("renders the in-flow fallback row below the threshold", () => {
    render(<VersionBadge {...baseProps} contentInset={BAND_MIN_CONTENT_INSET - 1} />);
    const row = screen.getByTestId("version-badge-row");
    expect(row.textContent).toContain("Claude Pocket Console: dev");
    expect(row.textContent).toContain("v1.17.0");
    expect(screen.queryByTestId("version-badge-band")).toBeNull();
  });

  it("suppresses the fallback row off the terminal tab, but never the band", () => {
    const { rerender } = render(
      <VersionBadge {...baseProps} contentInset={0} fallbackVisible={false} />,
    );
    expect(screen.queryByTestId("version-badge-row")).toBeNull();
    rerender(<VersionBadge {...baseProps} contentInset={46} fallbackVisible={false} />);
    expect(screen.getByTestId("version-badge-band")).toBeTruthy();
  });

  it("waits for the branch before rendering the fallback row, like the pre-v2 row", () => {
    render(<VersionBadge {...baseProps} branch={null} contentInset={0} />);
    expect(screen.queryByTestId("version-badge-row")).toBeNull();
  });

  it("marks dev deployments with the ▲ dev prefix in the band", () => {
    render(<VersionBadge {...baseProps} isDev contentInset={46} />);
    expect(screen.getByTestId("version-badge-band").textContent).toMatch(/▲ dev/);
  });
});
