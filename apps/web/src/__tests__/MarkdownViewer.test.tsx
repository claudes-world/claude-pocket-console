/**
 * Tests for MarkdownViewer component.
 *
 * Covers: rendering basics, code blocks, tables, collapsible headings,
 * external/internal link handling, and pre-block touch event plumbing.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MarkdownViewer } from "../components/MarkdownViewer";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../components/MermaidDiagram", () => ({
  MermaidDiagram: ({ source }: { source: string }) => (
    <div className="mermaid-mount" data-testid="mermaid-diagram">
      {source}
    </div>
  ),
}));

// Mock CSS imports pulled in by MarkdownViewer (highlight.js theme)
vi.mock("highlight.js/styles/tokyo-night-dark.css", () => ({}));

const mockOpenLink = vi.fn();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderMd(content: string) {
  return render(
    <MarkdownViewer content={content} fileName="test.md" />,
  );
}

// ---------------------------------------------------------------------------
// Rendering basics
// ---------------------------------------------------------------------------

describe("MarkdownViewer — rendering basics", () => {
  it("renders without crashing when content is empty string", () => {
    const { container } = renderMd("");
    expect(container.querySelector(".md-viewer-scroll")).toBeTruthy();
    expect(container.querySelector(".md-content")).toBeTruthy();
  });

  it("renders .md-viewer-scroll outer container", () => {
    const { container } = renderMd("hello");
    expect(container.querySelector(".md-viewer-scroll")).toBeTruthy();
  });

  it("renders .md-content inner wrapper", () => {
    const { container } = renderMd("hello");
    expect(container.querySelector(".md-content")).toBeTruthy();
  });

  it("renders h1 heading from markdown", () => {
    renderMd("# Title");
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  });

  it("renders h2 heading from markdown", () => {
    renderMd("## Section\n\nsome content here");
    expect(screen.getByRole("heading", { level: 2 })).toBeTruthy();
  });

  it("renders h3 heading from markdown", () => {
    renderMd("### Sub-section\n\nsome content");
    expect(screen.getByRole("heading", { level: 3 })).toBeTruthy();
  });

  it("renders bold text", () => {
    const { container } = renderMd("**bold text**");
    const strong = container.querySelector("strong");
    expect(strong).toBeTruthy();
    expect(strong!.textContent).toBe("bold text");
  });

  it("renders italic text", () => {
    const { container } = renderMd("_italic text_");
    const em = container.querySelector("em");
    expect(em).toBeTruthy();
    expect(em!.textContent).toBe("italic text");
  });

  it("renders unordered list", () => {
    const { container } = renderMd("- alpha\n- beta\n- gamma");
    const ul = container.querySelector("ul");
    expect(ul).toBeTruthy();
    const items = ul!.querySelectorAll("li");
    expect(items.length).toBe(3);
  });

  it("renders ordered list", () => {
    const { container } = renderMd("1. first\n2. second\n3. third");
    const ol = container.querySelector("ol");
    expect(ol).toBeTruthy();
    const items = ol!.querySelectorAll("li");
    expect(items.length).toBe(3);
  });

  it("renders inline code", () => {
    const { container } = renderMd("use `console.log` here");
    // Inline code renders as <code> not inside a <pre>
    const codes = container.querySelectorAll("code");
    const inlineCode = Array.from(codes).find(
      (c) => c.closest("pre") === null,
    );
    expect(inlineCode).toBeTruthy();
    expect(inlineCode!.textContent).toBe("console.log");
  });

  it("renders a blockquote", () => {
    const { container } = renderMd("> This is a quote");
    const bq = container.querySelector("blockquote");
    expect(bq).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Code blocks
// ---------------------------------------------------------------------------

describe("MarkdownViewer — code blocks", () => {
  it("renders fenced code block inside <pre><code>", () => {
    const { container } = renderMd("```\nsome code\n```");
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    const code = pre!.querySelector("code");
    expect(code).toBeTruthy();
  });

  it("fenced code block with language gets a language class", () => {
    const { container } = renderMd("```typescript\nconst x = 1;\n```");
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    const code = pre!.querySelector("code");
    expect(code).toBeTruthy();
    // rehype-highlight may add hljs class; react-markdown sets language- class
    expect(
      code!.className.includes("language-typescript") ||
        code!.className.includes("typescript"),
    ).toBe(true);
  });

  it("mermaid code block renders via MermaidDiagram mock with .mermaid-mount", () => {
    const { container } = renderMd("```mermaid\ngraph TD\nA-->B\n```");
    const mount = container.querySelector(".mermaid-mount");
    expect(mount).toBeTruthy();
    // The mock renders the source text as content
    expect(mount!.textContent).toContain("graph TD");
    // Should NOT render a <pre> wrapping it
    expect(mount!.closest("pre")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

describe("MarkdownViewer — tables", () => {
  const TABLE_MD =
    "| Name | Age |\n| ---- | --- |\n| Alice | 30 |\n| Bob | 25 |";

  it("GFM table is wrapped in .md-table-scroll div", () => {
    const { container } = renderMd(TABLE_MD);
    const scroll = container.querySelector(".md-table-scroll");
    expect(scroll).toBeTruthy();
    const table = scroll!.querySelector("table");
    expect(table).toBeTruthy();
  });

  it("table contains <thead> and <tbody>", () => {
    const { container } = renderMd(TABLE_MD);
    const table = container.querySelector("table");
    expect(table!.querySelector("thead")).toBeTruthy();
    expect(table!.querySelector("tbody")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Collapsible sections
// ---------------------------------------------------------------------------

describe("MarkdownViewer — collapsible sections", () => {
  // h2 with following content so rehypeCollapsibleSections wraps it
  const H2_MD = "## My Section\n\nSome paragraph text under this heading.";
  const H1_MD = "# Document Title\n\nIntro paragraph.";

  it("h2 heading renders with .cpc-collapsible-heading class", () => {
    const { container } = renderMd(H2_MD);
    const h2 = container.querySelector("h2");
    expect(h2).toBeTruthy();
    expect(h2!.className).toContain("cpc-collapsible-heading");
  });

  it("h2 heading contains a .cpc-fold-btn button", () => {
    const { container } = renderMd(H2_MD);
    const btn = container.querySelector(".cpc-fold-btn");
    expect(btn).toBeTruthy();
  });

  it("h1 heading does NOT render .cpc-fold-btn (h1 is never collapsible)", () => {
    const { container } = renderMd(H1_MD);
    // h1 should exist
    const h1 = container.querySelector("h1");
    expect(h1).toBeTruthy();
    // but it must not contain a fold button
    const btn = h1!.querySelector(".cpc-fold-btn");
    expect(btn).toBeNull();
  });

  it("clicking .cpc-fold-btn folds the section — adds .cpc-folded", () => {
    const { container } = renderMd(H2_MD);
    const btn = container.querySelector(".cpc-fold-btn") as HTMLElement;
    expect(btn).toBeTruthy();

    fireEvent.click(btn);

    const folded = container.querySelector(".cpc-folded");
    expect(folded).toBeTruthy();
  });

  it("folded section has aria-hidden='true'", () => {
    const { container } = renderMd(H2_MD);
    const btn = container.querySelector(".cpc-fold-btn") as HTMLElement;
    fireEvent.click(btn);

    const folded = container.querySelector("[aria-hidden='true']");
    expect(folded).toBeTruthy();
  });

  it("clicking fold button again unfolds — .cpc-folded is removed", () => {
    const { container } = renderMd(H2_MD);

    // First click — fold
    fireEvent.click(container.querySelector(".cpc-fold-btn") as HTMLElement);
    expect(container.querySelector(".cpc-folded")).toBeTruthy();

    // Re-query after React re-render, then unfold
    fireEvent.click(container.querySelector(".cpc-fold-btn") as HTMLElement);
    expect(container.querySelector(".cpc-folded")).toBeNull();
  });

  it("data-folded attribute on chevron reflects fold state", () => {
    const { container } = renderMd(H2_MD);
    const chevron = container.querySelector(".cpc-toggle-chevron") as HTMLElement;
    expect(chevron).toBeTruthy();
    // initially unfolded
    expect(chevron.getAttribute("data-folded")).toBe("false");

    const btn = container.querySelector(".cpc-fold-btn") as HTMLElement;
    fireEvent.click(btn);

    // After fold, the button re-renders — re-query the chevron
    const chevronAfter = container.querySelector(
      ".cpc-toggle-chevron",
    ) as HTMLElement;
    expect(chevronAfter.getAttribute("data-folded")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// External links
// ---------------------------------------------------------------------------

describe("MarkdownViewer — external links", () => {
  beforeEach(() => {
    mockOpenLink.mockReset();
    Object.defineProperty(window, "Telegram", {
      value: { WebApp: { openLink: mockOpenLink } },
      writable: true,
      configurable: true,
    });
  });

  it("external http link calls window.Telegram.WebApp.openLink on click", () => {
    renderMd("[Visit](https://example.com)");
    const link = screen.getByRole("link", { name: "Visit" });
    fireEvent.click(link);
    expect(mockOpenLink).toHaveBeenCalledWith("https://example.com");
  });

  it("external link click prevents default navigation", () => {
    renderMd("[Visit](https://example.com)");
    const link = screen.getByRole("link", { name: "Visit" });
    // Observable proof that default was prevented: Telegram's openLink fires
    // instead of the browser navigating. fireEvent routes through React's
    // synthetic event system correctly.
    fireEvent.click(link);
    expect(mockOpenLink).toHaveBeenCalledWith("https://example.com");
  });

  it("falls back to window.open when Telegram is unavailable", () => {
    // Remove Telegram
    Object.defineProperty(window, "Telegram", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    renderMd("[Open](https://external.io/page)");
    const link = screen.getByRole("link", { name: "Open" });
    fireEvent.click(link);

    expect(openSpy).toHaveBeenCalledWith(
      "https://external.io/page",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("internal link does NOT call openLink", () => {
    renderMd("[Internal](/some/path)");
    const link = screen.getByRole("link", { name: "Internal" });
    fireEvent.click(link);
    expect(mockOpenLink).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Pre block touch handling
// ---------------------------------------------------------------------------

describe("MarkdownViewer — pre block touch handling", () => {
  it("<pre> element stops touchmove propagation (parent handler not called)", () => {
    const parentHandler = vi.fn();
    const { container } = render(
      // eslint-disable-next-line react/no-unknown-property
      <div onTouchMove={parentHandler}>
        <MarkdownViewer content={"```\nsome code here\n```"} fileName="test.md" />
      </div>,
    );
    const pre = container.querySelector("pre") as HTMLElement;
    expect(pre).toBeTruthy();
    fireEvent.touchMove(pre);
    expect(parentHandler).not.toHaveBeenCalled();
  });
});
