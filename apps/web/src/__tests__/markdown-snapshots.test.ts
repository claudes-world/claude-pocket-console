import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import {
  markdownComponents,
  markdownRehypePlugins,
  markdownRemarkPlugins,
} from "../components/MarkdownViewer";

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
const FIXTURE_DIR = resolve(__dirname, "../__fixtures__/markdown");

describe("MarkdownViewer (react-markdown baseline)", () => {
  const fixtures = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

  for (const fixture of fixtures) {
    it(`renders ${fixture} consistently`, () => {
      const content = readFileSync(resolve(FIXTURE_DIR, fixture), "utf-8");
      expect(renderMarkdown(content)).toMatchSnapshot();
    });
  }
});
