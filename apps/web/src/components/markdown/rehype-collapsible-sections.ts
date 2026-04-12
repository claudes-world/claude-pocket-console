/**
 * rehype plugin that wraps each heading's body content in a collapsible
 * <section class="cpc-section" id="section-{slug}" data-fold-slug="{slug}">
 *
 * Must run AFTER rehype-slug so heading IDs are already assigned.
 *
 * The plugin recursively processes heading bodies so that nested headings
 * (e.g. H2 inside an H1 section, H3 inside an H2 section) each get their
 * own collapsible <section> wrapper. This fixes the v1 bug where only the
 * first heading level was processed — all lower-level headings ended up
 * buried inside the top-level section and were never individually wrapped.
 */
// Inline hast-compatible types to avoid needing @types/hast as a direct dep.
// These match the subset used by rehype plugins.
interface HastProperties {
  id?: string;
  className?: string[];
  [key: string]: unknown;
}

interface HastElement {
  type: "element";
  tagName: string;
  properties: HastProperties;
  children: HastNode[];
}

interface HastText {
  type: "text";
  value: string;
}

type HastNode = HastElement | HastText | { type: string; [key: string]: unknown };

interface HastRoot {
  type: "root";
  children: HastNode[];
}

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function isHeading(node: HastNode): node is HastElement {
  return node.type === "element" && HEADING_TAGS.has((node as HastElement).tagName);
}

function headingLevel(node: HastElement): number {
  return Number(node.tagName[1]);
}

/**
 * Returns true if the body slice has meaningful content — at least one
 * element node or a non-whitespace text node. Whitespace-only text nodes
 * (e.g. newlines between consecutive headings) are not considered content.
 */
function hasContent(nodes: HastNode[]): boolean {
  return nodes.some((n) => {
    if (n.type === "element") return true;
    if (n.type === "text" && (n as HastText).value.trim() !== "") return true;
    return false;
  });
}

/**
 * Recursively process a list of sibling nodes, wrapping each heading's
 * body content in a <section>. Nested headings within a section body
 * are processed by recursive calls.
 */
function wrapSections(children: HastNode[]): HastNode[] {
  const out: HastNode[] = [];
  let i = 0;

  while (i < children.length) {
    const node = children[i];

    if (isHeading(node)) {
      const level = headingLevel(node);
      const slug = (node.properties?.id as string) ?? "";

      // Find end of this section: next sibling heading with level <= this one
      let j = i + 1;
      while (j < children.length) {
        const next = children[j];
        if (isHeading(next) && headingLevel(next) <= level) break;
        j++;
      }

      const body = children.slice(i + 1, j);

      if (slug && body.length > 0 && hasContent(body)) {
        // Mark the heading as having a foldable section
        node.properties = {
          ...node.properties,
          "data-has-section": "true",
        };
        out.push(node);

        // Recursively process body for nested headings
        const processedBody = wrapSections(body);

        out.push({
          type: "element",
          tagName: "section",
          properties: {
            className: ["cpc-section"],
            id: `section-${slug}`,
            "data-fold-slug": slug,
          },
          children: processedBody,
        } as HastElement);
      } else {
        out.push(node);
      }
      i = j;
    } else {
      out.push(node);
      i++;
    }
  }

  return out;
}

export function rehypeCollapsibleSections() {
  return (tree: HastRoot) => {
    tree.children = wrapSections(tree.children);
  };
}
