import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import {
  markdownComponents,
  markdownRehypePlugins,
  markdownRemarkPlugins,
} from "../MarkdownViewer";

function renderMarkdown(content: string): string {
  return renderToStaticMarkup(
    createElement(
      "div",
      { className: "md-content" },
      createElement(
        ReactMarkdown,
        {
          remarkPlugins: markdownRemarkPlugins,
          rehypePlugins: markdownRehypePlugins,
          components: markdownComponents,
        },
        content,
      ),
    ),
  );
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "markdown-fixtures");

const fixtures = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((f) => ({
    name: f.replace(".md", ""),
    content: readFileSync(join(FIXTURE_DIR, f), "utf-8"),
  }));

describe("Markdown parity baseline (react-markdown)", () => {
  for (const fixture of fixtures) {
    it(`renders ${fixture.name} through react-markdown`, () => {
      expect(renderMarkdown(fixture.content)).toMatchSnapshot();
    });
  }
});
