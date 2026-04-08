import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

// Use the same marked parser options as MarkdownViewer.tsx, but snapshot only
// the raw HTML emitted by marked.parse(). This is intentionally a parser-level
// baseline and does not cover any MarkdownViewer post-processing that happens
// after parsing (for example, React-rendered replacements such as mermaid).
// When the react-markdown migration lands, a follow-up test can render the
// same fixtures through the component and compare the resulting DOM output.
const marked = new Marked({ gfm: true, breaks: true });

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, "../__fixtures__/markdown");

describe("MarkdownViewer (marked baseline)", () => {
  const fixtures = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

  for (const fixture of fixtures) {
    it(`renders ${fixture} consistently`, () => {
      const content = readFileSync(resolve(FIXTURE_DIR, fixture), "utf-8");
      const html = marked.parse(content);
      expect(html).toMatchSnapshot();
    });
  }
});
