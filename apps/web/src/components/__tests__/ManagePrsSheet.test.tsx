import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ManagePrsSheet } from "../ManagePrsSheet";
import type { PrViewPrefs } from "../../lib/prViewPrefs";

const initialPrefs: PrViewPrefs = {
  orgOrder: [],
  repoOrder: {},
  hiddenOrgs: [],
  hiddenRepos: [],
  collapsedRepos: [],
};

function Harness({ onChange = () => {} }: { onChange?: (prefs: PrViewPrefs) => void }) {
  const [prefs, setPrefs] = useState(initialPrefs);
  return (
    <ManagePrsSheet
      orgRepos={{
        alpha: ["alpha/one", "alpha/two"],
        beta: ["beta/one"],
      }}
      prefs={prefs}
      onChange={(next) => {
        onChange(next);
        setPrefs(next);
      }}
      onClose={() => {}}
    />
  );
}

describe("ManagePrsSheet", () => {
  it("toggles visibility and renders hidden rows dimmed", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide repo alpha/two" }));

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ hiddenRepos: ["alpha/two"] }));
    expect(screen.getByRole("button", { name: "Show repo alpha/two" })).toBeInTheDocument();
    expect(screen.getByText("two").parentElement).toHaveStyle({ opacity: "0.5" });
  });

  it("moves orgs and repos with arrow buttons", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Move org beta up" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ orgOrder: ["beta", "alpha"] }));

    fireEvent.click(screen.getByRole("button", { name: "Move repo alpha/two up" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      repoOrder: { alpha: ["alpha/two", "alpha/one"] },
    }));
  });
});
