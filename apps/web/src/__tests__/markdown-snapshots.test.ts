import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { marked } from "marked";

// Mirror MarkdownViewer.tsx settings exactly so these snapshots represent
// the current production rendering for the marked-based baseline. When the
// react-markdown migration lands, the follow-up PR will add a parallel test
// that renders the same fixtures through react-markdown and diffs the
// output — the diff between these snapshots and that one is the actual
// visible change the migration ships.
marked.setOptions({ gfm: true, breaks: true });

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
