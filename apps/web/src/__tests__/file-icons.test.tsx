import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getFileIcon } from "../components/file-icons";

/**
 * Unit tests for getFileIcon() — the helper introduced by Search UX C2 (#107).
 *
 * The helper returns a ReactNode (an inline SVG). We snapshot the rendered
 * markup via react-dom/server's renderToStaticMarkup so the assertions can
 * inspect concrete attributes (stroke colors, badge labels, path d-values)
 * without needing @testing-library/react or a DOM mount.
 *
 * The icon palette is defined in apps/web/src/components/file-icons.tsx and
 * mirrored here as constants — these tests will fail loudly if a future PR
 * silently changes the colors, which keeps the visual contract stable.
 */

const COLOR_TS = "#7aa2f7"; // BadgeIcon color for TS/TSX
const COLOR_JS = "#e0af68"; // BadgeIcon color for JS/JSX (and HTML stroke)
const COLOR_MD = "#7dcfff"; // MdIcon stroke (also CSS stroke)
const COLOR_SH = "#9ece6a"; // ShIcon stroke
const COLOR_PY = "#7aa2f7"; // PyIcon stroke (same hex as TS badge but on a stroke svg, not a rect fill)
const COLOR_IMG = "#bb9af7"; // ImageIcon stroke
const COLOR_TXT = "#c0caf5"; // TxtIcon stroke + DocIcon default color
const COLOR_FOLDER = "#7aa2f7"; // FolderIcon stroke

function render(node: ReturnType<typeof getFileIcon>): string {
  // getFileIcon returns ReactNode, never null/undefined for any code path,
  // so a non-null assertion here keeps the call sites concise. If a future
  // refactor adds a nullable branch, the renderToStaticMarkup type will
  // surface the regression.
  return renderToStaticMarkup(node as React.ReactElement);
}

describe("getFileIcon", () => {
  describe("folders", () => {
    it("returns the folder icon when isFolder=true regardless of name", () => {
      const html = render(getFileIcon("anything-at-all", true));
      expect(html).toContain("<svg");
      expect(html).toContain(`stroke="${COLOR_FOLDER}"`);
      // FolderIcon's defining path starts with `M1.5 4` — see file-icons.tsx
      expect(html).toContain("M1.5 4");
    });

    it("returns the folder icon even when the folder name has a known extension", () => {
      // Real-world: git worktrees and dotfiles can produce folders named "foo.json".
      const html = render(getFileIcon("foo.json", true));
      expect(html).toContain(`stroke="${COLOR_FOLDER}"`);
      expect(html).toContain("M1.5 4");
      // It should NOT be the JsonIcon (which has a distinctive curly-brace path).
      expect(html).not.toContain("M6 2.5c-2 0-2 1.5-2 3");
    });
  });

  describe("JSON", () => {
    it("returns the JSON-specific icon for foo.json", () => {
      const html = render(getFileIcon("foo.json", false));
      expect(html).toContain(`stroke="#e0af68"`); // JsonIcon stroke
      // The two curly-brace paths from JsonIcon are unique to that icon.
      expect(html).toContain("M6 2.5c-2 0-2 1.5-2 3");
      expect(html).toContain("M10 2.5c2 0 2 1.5 2 3");
    });

    it("treats uppercase .JSON the same as .json (case-insensitive)", () => {
      const upper = render(getFileIcon("foo.JSON", false));
      const lower = render(getFileIcon("foo.json", false));
      expect(upper).toBe(lower);
    });
  });

  describe("TypeScript / JavaScript badges", () => {
    it("returns the TS badge for .ts", () => {
      const html = render(getFileIcon("foo.ts", false));
      expect(html).toContain(`fill="${COLOR_TS}"`);
      expect(html).toContain(">TS<");
    });

    it("returns the same TS badge for .tsx", () => {
      const tsHtml = render(getFileIcon("foo.ts", false));
      const tsxHtml = render(getFileIcon("foo.tsx", false));
      expect(tsxHtml).toBe(tsHtml);
    });

    it("returns the JS badge for .js", () => {
      const html = render(getFileIcon("foo.js", false));
      expect(html).toContain(`fill="${COLOR_JS}"`);
      expect(html).toContain(">JS<");
    });

    it("returns the same JS badge for .jsx", () => {
      const jsHtml = render(getFileIcon("foo.js", false));
      const jsxHtml = render(getFileIcon("foo.jsx", false));
      expect(jsxHtml).toBe(jsHtml);
    });

    it("does NOT cross-wire TS and JS badges", () => {
      const ts = render(getFileIcon("foo.ts", false));
      const js = render(getFileIcon("foo.js", false));
      expect(ts).not.toBe(js);
    });
  });

  describe("Markdown", () => {
    it("returns the MD icon for README.md", () => {
      const html = render(getFileIcon("README.md", false));
      expect(html).toContain(`stroke="${COLOR_MD}"`);
      // MdIcon's M-curve path is unique to it.
      expect(html).toContain("M4 11V5l2 3 2-3v6");
    });

    it("returns the MD icon for uppercase FOO.MD (case-insensitive)", () => {
      const upper = render(getFileIcon("FOO.MD", false));
      const lower = render(getFileIcon("foo.md", false));
      expect(upper).toBe(lower);
    });

    it("returns the MD icon for the .markdown alias", () => {
      const md = render(getFileIcon("doc.md", false));
      const markdown = render(getFileIcon("doc.markdown", false));
      expect(markdown).toBe(md);
    });
  });

  describe("Shell scripts", () => {
    it("returns the shell icon for script.sh", () => {
      const html = render(getFileIcon("script.sh", false));
      expect(html).toContain(`stroke="${COLOR_SH}"`);
      // ShIcon's prompt-arrow `M4 6l2 2-2 2` is unique to it.
      expect(html).toContain("M4 6l2 2-2 2");
    });

    it("treats .bash and .zsh the same as .sh", () => {
      const sh = render(getFileIcon("a.sh", false));
      expect(render(getFileIcon("a.bash", false))).toBe(sh);
      expect(render(getFileIcon("a.zsh", false))).toBe(sh);
    });
  });

  describe("dotfiles and unknown extensions", () => {
    it("returns the default doc icon for .env (dotfile = no extension)", () => {
      const html = render(getFileIcon(".env", false));
      // DocIcon uses the txt color #c0caf5 as its default, with the doc outline path.
      expect(html).toContain(`stroke="${COLOR_TXT}"`);
      expect(html).toContain("M3.5 1.5h6l3 3v10h-9z");
      // No badge text — DocIcon has no <text> element.
      expect(html).not.toContain("<text");
    });

    it("returns the default doc icon for unknown.xyz", () => {
      const env = render(getFileIcon(".env", false));
      const xyz = render(getFileIcon("unknown.xyz", false));
      expect(xyz).toBe(env);
    });

    it("returns the default doc icon for a name with no extension at all", () => {
      const env = render(getFileIcon(".env", false));
      const noext = render(getFileIcon("Makefile", false));
      expect(noext).toBe(env);
    });
  });

  describe("multi-dot extensions", () => {
    it("uses only the trailing extension for archive.tar.gz", () => {
      // getExtension() takes the substring after the LAST dot, so .tar.gz is
      // treated as `.gz`. `gz` is not in the switch, so it falls through to
      // the default DocIcon. Lock the current behavior in so a future
      // multi-extension refactor has to update this test deliberately.
      const tarGz = render(getFileIcon("archive.tar.gz", false));
      const fallback = render(getFileIcon("unknown.xyz", false));
      expect(tarGz).toBe(fallback);
    });
  });

  describe("python", () => {
    it("returns the python icon for .py", () => {
      const html = render(getFileIcon("script.py", false));
      expect(html).toContain(`stroke="${COLOR_PY}"`);
      // PyIcon's interlocking-curve path is unique to it.
      expect(html).toContain("M8 2c-2.5 0-3 1-3 2v2h4");
    });
  });

  describe("images", () => {
    it.each(["foo.png", "foo.jpg", "foo.jpeg", "foo.gif", "foo.webp", "foo.svg"])(
      "returns the image icon for %s",
      (name) => {
        const html = render(getFileIcon(name, false));
        expect(html).toContain(`stroke="${COLOR_IMG}"`);
      },
    );
  });

  describe("text/log", () => {
    it("returns the txt icon for foo.txt and foo.log", () => {
      const txt = render(getFileIcon("foo.txt", false));
      const log = render(getFileIcon("foo.log", false));
      expect(txt).toBe(log);
      // TxtIcon has the same color as DocIcon's default but adds three
      // horizontal lines (M5.5 8h5 / M5.5 10h5 / M5.5 12h3).
      expect(txt).toContain("M5.5 8h5");
      expect(txt).toContain("M5.5 12h3");
    });
  });
});
