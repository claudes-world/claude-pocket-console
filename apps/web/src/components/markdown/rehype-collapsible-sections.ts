/**
 * rehype plugin that wraps each top-level heading's body content in a
 * <section class="cpc-section" id="section-{slug}" data-fold-slug="{slug}">
 *
 * Must run AFTER rehype-slug so heading IDs are already assigned.
 *
 * Only processes top-level children of the root node. Headings inside
 * blockquotes, list items, or other containers are not wrapped — this is
 * a documented v1 limitation.
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

export function rehypeCollapsibleSections() {
  return (tree: HastRoot) => {
    const children = tree.children;
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

        // Mark the heading as having a foldable section
        if (slug && body.length > 0) {
          node.properties = {
            ...node.properties,
            "data-has-section": "true",
          };
          out.push(node);
          out.push({
            type: "element",
            tagName: "section",
            properties: {
              className: ["cpc-section"],
              id: `section-${slug}`,
              "data-fold-slug": slug,
            },
            children: body,
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

    tree.children = out;
  };
}
