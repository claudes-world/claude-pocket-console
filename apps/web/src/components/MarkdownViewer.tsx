import React, { Children, isValidElement, useState, useCallback, useMemo, useRef, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeSlug from "rehype-slug";
import { MermaidDiagram } from "./MermaidDiagram";
import { rehypeCollapsibleSections } from "./markdown/rehype-collapsible-sections";
import { makeHeadingComponent } from "./markdown/CollapsibleHeading";

interface MarkdownViewerProps {
  content: string;
  fileName: string;
}

export const markdownRemarkPlugins = [remarkGfm, remarkBreaks];

// rehype-slug is pinned to major 6 in package.json. Heading IDs are a contract
// for deep links, TOC state, and collapsible headings.
// rehypeCollapsibleSections must run AFTER rehypeSlug so slug IDs exist.
export const markdownRehypePlugins = [rehypeSlug, rehypeCollapsibleSections];

function getLanguage(className?: string): string {
  return (
    className
      ?.split(/\s+/)
      .find((part) => part.startsWith("language-"))
      ?.replace("language-", "") ?? ""
  );
}

function getTextContent(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }

      return "";
    })
    .join("");
}

function CodeBlock({ className, children, node: _node, ...props }: React.ComponentPropsWithoutRef<'code'> & { node?: any; className?: string }) {
  const language = getLanguage(className);

  if (language === "mermaid") {
    return (
      <div className="mermaid-mount">
        <MermaidDiagram source={getTextContent(children).trim()} />
      </div>
    );
  }

  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

function ScrollableTable({ children, node: _node, ...props }: React.ComponentPropsWithoutRef<'table'> & { node?: any }) {
  return (
    <div className="md-table-scroll">
      <table {...props}>{children}</table>
    </div>
  );
}

function isMermaidCodeChild(child: ReactNode): boolean {
  return (
    isValidElement<{ className?: string }>(child) &&
    getLanguage(child.props.className) === "mermaid"
  );
}

function PreBlock({ children, node: _node, ...props }: React.ComponentPropsWithoutRef<'pre'> & { node?: any }) {
  const childArray = Children.toArray(children);

  if (childArray.length === 1 && isMermaidCodeChild(childArray[0])) {
    return <>{children}</>;
  }

  return <pre {...props}>{children}</pre>;
}

const baseComponents: Partial<Components> = {
  code: CodeBlock,
  table: ScrollableTable,
  pre: PreBlock,
};

/** @deprecated Use baseComponents internally; kept for test compatibility */
export const markdownComponents: Components = baseComponents as Components;

// Heading tree for effective-hidden computation. Regex-based v1; strips fenced
// code blocks to avoid false matches. A remark-parse AST walk would be more
// robust but adds complexity for minimal gain here.
interface HeadingEntry {
  slug: string;
  level: number;
}

function parseHeadings(content: string): HeadingEntry[] {
  // Strip fenced code blocks to avoid false heading matches
  const stripped = content.replace(/```[\s\S]*?```/g, "");
  const headings: HeadingEntry[] = [];
  const re = /^(#{1,6})\s+(.+)$/gm;
  let match;
  // Track slug collisions the same way rehype-slug does
  const slugCounts = new Map<string, number>();

  while ((match = re.exec(stripped)) !== null) {
    const level = match[1].length;
    const text = match[2]
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase();
    const count = slugCounts.get(text) ?? 0;
    const slug = count === 0 ? text : `${text}-${count}`;
    slugCounts.set(text, count + 1);
    headings.push({ slug, level });
  }
  return headings;
}

function computeEffectiveHidden(
  headings: HeadingEntry[],
  foldedIds: Set<string>,
): Set<string> {
  if (foldedIds.size === 0) return foldedIds; // fast path: nothing folded

  const hidden = new Set<string>();
  // Stack tracks ancestor headings; each entry is { level, folded }
  const ancestors: { level: number; folded: boolean }[] = [];

  for (const { slug, level } of headings) {
    // Pop ancestors that are not parents of this level
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].level >= level) {
      ancestors.pop();
    }

    const anyAncestorFolded = ancestors.some((a) => a.folded);
    const selfFolded = foldedIds.has(slug);

    if (anyAncestorFolded || selfFolded) {
      hidden.add(slug);
    }

    ancestors.push({ level, folded: selfFolded });
  }

  return hidden;
}

export function MarkdownViewer({ content, fileName: _fileName }: MarkdownViewerProps) {
  const [foldedIds, setFoldedIds] = useState<Set<string>>(new Set());
  const firstH1Ref = useRef<string | null>(null);

  const toggleFold = useCallback((id: string) => {
    setFoldedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const headings = useMemo(() => parseHeadings(content), [content]);

  // Determine the first H1 slug to exclude it from collapsibility
  const firstH1Slug = useMemo(() => {
    const first = headings.find((h) => h.level === 1);
    return first?.slug ?? null;
  }, [headings]);
  firstH1Ref.current = firstH1Slug;

  const effectiveHidden = useMemo(
    () => computeEffectiveHidden(headings, foldedIds),
    [headings, foldedIds],
  );

  // Build components with fold controls. Recreated when fold state changes,
  // which is acceptable — react-markdown must re-render on toggle anyway.
  const components = useMemo<Components>(() => {
    const controls = { foldedIds, toggleFold, isFirstH1: false };

    const h = (tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
      makeHeadingComponent(tag, controls);

    return {
      ...baseComponents,
      h1: (props: any) => {
        const slug = typeof props.id === "string" ? props.id : "";
        const Comp = makeHeadingComponent("h1", {
          foldedIds, toggleFold, isFirstH1: slug === firstH1Ref.current,
        });
        return <Comp {...props} />;
      },
      h2: h("h2"),
      h3: h("h3"),
      h4: h("h4"),
      h5: h("h5"),
      h6: h("h6"),
      section: ({ node: _node, children, ...props }: any) => {
        const slug = props["data-fold-slug"] as string | undefined;
        if (!slug) return <section {...props}>{children}</section>;
        const hidden = effectiveHidden.has(slug);
        return (
          <section
            {...props}
            className={
              [props.className, hidden ? "cpc-folded" : ""]
                .filter(Boolean)
                .join(" ")
            }
            aria-hidden={hidden || undefined}
          >
            {children}
          </section>
        );
      },
    };
  }, [foldedIds, toggleFold, effectiveHidden]);

  return (
    <div
      className="md-viewer-scroll"
      style={{
        padding: "16px 16px",
        overflowY: "auto",
        overflowX: "hidden",
        height: "100%",
        width: "100%",
        maxWidth: "100%",
      }}
    >
      <style>{`
        .md-content {
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 14px;
          line-height: 1.7;
          color: #c0caf5;
          overflow-wrap: break-word;
          word-break: break-word;
          max-width: 100%;
        }
        .md-content * {
          max-width: 100%;
          box-sizing: border-box;
        }
        .md-content h1 {
          font-size: 22px;
          font-weight: 700;
          margin: 0 0 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid #2a2b3d;
          color: #c0caf5;
        }
        .md-content h2 {
          font-size: 18px;
          font-weight: 600;
          margin: 20px 0 8px;
          padding-bottom: 6px;
          border-bottom: 1px solid #1e1f2e;
          color: #7aa2f7;
        }
        .md-content h3 {
          font-size: 15px;
          font-weight: 600;
          margin: 16px 0 6px;
          color: #bb9af7;
        }
        .md-content p {
          margin: 8px 0;
        }
        .md-content a {
          color: #7dcfff;
          text-decoration: none;
        }
        .md-content a:hover {
          text-decoration: underline;
        }
        .md-content code {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 12px;
          background: #24283b;
          padding: 2px 6px;
          border-radius: 4px;
          color: #9ece6a;
        }
        .md-content pre {
          background: #1a1b26;
          border: 1px solid #2a2b3d;
          border-radius: 6px;
          padding: 12px 16px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          margin: 12px 0;
        }
        .md-content pre code {
          background: none;
          padding: 0;
          color: #c0caf5;
          display: block;
          width: max-content;
          min-width: 100%;
          overflow-wrap: normal;
          word-break: normal;
          white-space: pre;
          max-width: none;
        }
        .md-content .md-table-scroll {
          width: 100%;
          max-width: 100%;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          margin: 12px 0;
        }
        .md-content table {
          width: max-content;
          min-width: 100%;
          border-collapse: collapse;
          margin: 0;
          font-size: 13px;
        }
        .md-content th {
          text-align: left;
          padding: 8px 12px;
          border-bottom: 2px solid #2a2b3d;
          color: #7aa2f7;
          font-weight: 600;
        }
        .md-content td {
          padding: 6px 12px;
          border-bottom: 1px solid #1e1f2e;
        }
        .md-content ul, .md-content ol {
          padding-left: 20px;
          margin: 8px 0;
        }
        .md-content li {
          margin: 4px 0;
        }
        .md-content blockquote {
          border-left: 3px solid #7aa2f7;
          margin: 12px 0;
          padding: 4px 16px;
          color: #a9b1d6;
          background: #1a1b26;
          border-radius: 0 4px 4px 0;
        }
        .md-content hr {
          border: none;
          border-top: 1px solid #2a2b3d;
          margin: 16px 0;
        }
        .md-content strong {
          color: #e0af68;
          font-weight: 600;
        }
        .md-content img {
          max-width: 100%;
          border-radius: 4px;
        }
        .md-content .mermaid-mount {
          margin: 12px 0;
        }
        .md-content .mermaid-container {
          background: #1a1b26;
          border: 1px solid #2a2b3d;
          border-radius: 6px;
          padding: 16px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          max-width: 100%;
          display: flex;
          justify-content: center;
        }
        .md-content .mermaid-container svg {
          max-width: 100%;
          height: auto;
        }
        .md-content .mermaid-loading {
          background: #1a1b26;
          border: 1px dashed #2a2b3d;
          border-radius: 6px;
          padding: 24px 16px;
          text-align: center;
          color: #565f89;
          font-size: 13px;
          font-style: italic;
          margin: 12px 0;
        }
        .md-content .mermaid-error {
          background: #1a1b26;
          border: 1px solid #f7768e;
          border-radius: 6px;
          padding: 12px 16px;
          margin: 12px 0;
        }
        .md-content .mermaid-error-label {
          color: #f7768e;
          font-size: 12px;
          font-weight: 600;
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .md-content .mermaid-error pre {
          margin: 0;
        }
        /* Collapsible headings */
        .md-content .cpc-collapsible-heading {
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          user-select: none;
        }
        .md-content .cpc-toggle-chevron {
          flex: 0 0 auto;
          width: 20px;
          height: 20px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #565f89;
          font-size: 10px;
          transition: transform 0.2s ease;
          border-radius: 3px;
        }
        .md-content .cpc-collapsible-heading:hover .cpc-toggle-chevron {
          color: #7aa2f7;
          background: rgba(122, 162, 247, 0.1);
        }
        .md-content .cpc-section.cpc-folded {
          display: none;
        }
      `}</style>
      <div className="md-content">
        <ReactMarkdown
          remarkPlugins={markdownRemarkPlugins}
          rehypePlugins={markdownRehypePlugins}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
