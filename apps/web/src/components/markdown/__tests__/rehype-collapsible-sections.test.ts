import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeSlug from "rehype-slug";
import { rehypeCollapsibleSections } from "../rehype-collapsible-sections";

/**
 * Helper: render markdown through react-markdown with rehype-slug +
 * rehypeCollapsibleSections, return the static HTML string.
 */
function render(md: string): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, {
      rehypePlugins: [rehypeSlug, rehypeCollapsibleSections],
      children: md,
    }),
  );
}

describe("rehypeCollapsibleSections — recursive nesting", () => {
  it("wraps H1 body and nested H2 sections independently", () => {
    const md = [
      "# Title",
      "",
      "Intro paragraph.",
      "",
      "## Section A",
      "",
      "Content A.",
      "",
      "## Section B",
      "",
      "Content B.",
    ].join("\n");

    const html = render(md);

    // H1 should have data-has-section
    expect(html).toContain('data-has-section="true"');
    expect(html).toContain('id="title"');

    // H1's section should exist
    expect(html).toContain('data-fold-slug="title"');

    // H2 sections should each have their own section wrappers INSIDE the H1 section
    expect(html).toContain('data-fold-slug="section-a"');
    expect(html).toContain('data-fold-slug="section-b"');

    // Both H2 headings should be marked as having sections
    expect(html).toMatch(/id="section-a"[^>]*data-has-section="true"/);
    expect(html).toMatch(/id="section-b"[^>]*data-has-section="true"/);
  });

  it("handles nested H2 -> H3 -> H4 hierarchy", () => {
    const md = [
      "## Top",
      "",
      "Top content.",
      "",
      "### Mid",
      "",
      "Mid content.",
      "",
      "#### Deep",
      "",
      "Deep content.",
    ].join("\n");

    const html = render(md);

    // All three levels should have sections
    expect(html).toContain('data-fold-slug="top"');
    expect(html).toContain('data-fold-slug="mid"');
    expect(html).toContain('data-fold-slug="deep"');

    // Verify nesting: H3 section is inside H2 section, H4 section is inside H3 section
    const topSectionStart = html.indexOf('data-fold-slug="top"');
    const midSectionStart = html.indexOf('data-fold-slug="mid"');
    const deepSectionStart = html.indexOf('data-fold-slug="deep"');

    expect(topSectionStart).toBeLessThan(midSectionStart);
    expect(midSectionStart).toBeLessThan(deepSectionStart);
  });

  it("handles document with no H1 — H2s get their own sections", () => {
    const md = [
      "## First",
      "",
      "Content first.",
      "",
      "## Second",
      "",
      "Content second.",
    ].join("\n");

    const html = render(md);

    // Both H2s should have sections
    expect(html).toContain('data-fold-slug="first"');
    expect(html).toContain('data-fold-slug="second"');

    // Each H2 should be marked as having a section
    expect(html).toMatch(/id="first"[^>]*data-has-section="true"/);
    expect(html).toMatch(/id="second"[^>]*data-has-section="true"/);
  });

  it("does NOT wrap heading with no content below it", () => {
    const md = [
      "## Has Content",
      "",
      "Some content.",
      "",
      "## Empty Section",
      "",
      "## Also Has Content",
      "",
      "More content.",
    ].join("\n");

    const html = render(md);

    // "Has Content" and "Also Has Content" should have sections
    expect(html).toContain('data-fold-slug="has-content"');
    expect(html).toContain('data-fold-slug="also-has-content"');

    // "Empty Section" should NOT have a section (no content before next same-level heading)
    expect(html).not.toContain('data-fold-slug="empty-section"');
    // But it still has an id from rehype-slug
    expect(html).toContain('id="empty-section"');
  });

  it("produces correct nesting structure for H1 > H2 > H3", () => {
    const md = [
      "# Doc Title",
      "",
      "Intro.",
      "",
      "## Chapter 1",
      "",
      "Chapter content.",
      "",
      "### Section 1.1",
      "",
      "Section content.",
      "",
      "## Chapter 2",
      "",
      "Chapter 2 content.",
    ].join("\n");

    const html = render(md);

    // Verify all headings have sections
    expect(html).toContain('data-fold-slug="doc-title"');
    expect(html).toContain('data-fold-slug="chapter-1"');
    expect(html).toContain('data-fold-slug="section-11"');
    expect(html).toContain('data-fold-slug="chapter-2"');
  });

  it("handles plain text before any heading", () => {
    const md = [
      "Some text before headings.",
      "",
      "## First Heading",
      "",
      "Content.",
    ].join("\n");

    const html = render(md);

    // The pre-heading text should pass through
    expect(html).toContain("Some text before headings.");
    // The heading should still get its section
    expect(html).toContain('data-fold-slug="first-heading"');
  });

  it("handles a single heading with content", () => {
    const md = [
      "## Only Heading",
      "",
      "Only content.",
    ].join("\n");

    const html = render(md);

    expect(html).toContain('data-fold-slug="only-heading"');
    expect(html).toContain("Only content.");
  });

  it("handles multiple H1s as separate top-level sections", () => {
    const md = [
      "# First Title",
      "",
      "First content.",
      "",
      "# Second Title",
      "",
      "Second content.",
    ].join("\n");

    const html = render(md);

    // Both H1s should have their own sections
    expect(html).toContain('data-fold-slug="first-title"');
    expect(html).toContain('data-fold-slug="second-title"');
  });

  it("does not wrap a heading that is immediately followed by same-level heading", () => {
    const md = [
      "## A",
      "## B",
      "",
      "Content under B.",
    ].join("\n");

    const html = render(md);

    // A has no content before B, so no section
    expect(html).not.toContain('data-fold-slug="a"');
    // B has content, so it gets a section
    expect(html).toContain('data-fold-slug="b"');
  });
});
