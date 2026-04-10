import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const marked = new Marked({ gfm: true, breaks: true });

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "markdown-fixtures");

const fixtures = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((f) => ({
    name: f.replace(".md", ""),
    content: readFileSync(join(FIXTURE_DIR, f), "utf-8"),
  }));

describe("Markdown parity baseline (marked)", () => {
  for (const fixture of fixtures) {
    it(`renders ${fixture.name} through marked`, () => {
      const html = marked.parse(fixture.content);
      expect(html).toMatchSnapshot();
    });
  }
});
