import React, { Children, isValidElement, useState, useCallback, useMemo, useRef, type ReactNode } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { remarkAlert } from "remark-github-blockquote-alert";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import "highlight.js/styles/tokyo-night-dark.css";
import { MermaidDiagram } from "./MermaidDiagram";
import { rehypeCollapsibleSections } from "./markdown/rehype-collapsible-sections";
import { makeHeadingComponent, type HeadingEntry } from "./markdown/CollapsibleHeading";

interface MarkdownViewerProps {
  content: string;
  fileName: string;
}

export const markdownRemarkPlugins = [remarkGfm, remarkBreaks, remarkAlert];

// rehype-highlight runs first so code blocks get syntax spans before slug/section processing.
// rehype-slug is pinned to major 6 in package.json. Heading IDs are a contract
// for deep links, TOC state, and collapsible headings.
// rehypeCollapsibleSections must run AFTER rehypeSlug so slug IDs exist.
export const markdownRehypePlugins = [
  [rehypeHighlight, { detect: false, plainText: ["mermaid"] }] as [typeof rehypeHighlight, Parameters<typeof rehypeHighlight>[0]],
  rehypeSlug,
  rehypeCollapsibleSections,
];

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

function CodeBlock({ className, children, node: _node, ...props }: React.ComponentPropsWithoutRef<'code'> & ExtraProps) {
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

function ScrollableTable({ children, node: _node, ...props }: React.ComponentPropsWithoutRef<'table'> & ExtraProps) {
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

/** Stop horizontal touch events from bubbling to the app-level tab-swipe handler. */
const stopTouchPropagation = (e: React.TouchEvent) => e.stopPropagation();

function PreBlock({ children, node: _node, ...props }: React.ComponentPropsWithoutRef<'pre'> & ExtraProps) {
  const childArray = Children.toArray(children);

  if (childArray.length === 1 && isMermaidCodeChild(childArray[0])) {
    return <>{children}</>;
  }

  return (
    <pre
      {...props}
      onTouchMove={stopTouchPropagation}
    >
      {children}
    </pre>
  );
}

function isExternalUrl(href: string | undefined): boolean {
  if (!href) return false;
  try {
    const url = new URL(href, window.location.origin);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin !== window.location.origin;
  } catch {
    return false;
  }
}

function MarkdownLink({ href, children, node: _node, ...props }: React.ComponentPropsWithoutRef<'a'> & ExtraProps) {
  if (!isExternalUrl(href)) {
    return <a href={href} {...props}>{children}</a>;
  }

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const tg = window.Telegram?.WebApp;
      if (tg && typeof (tg as any).openLink === "function") {
        (tg as any).openLink(href);
        return;
      }
    } catch { /* fallback */ }
    window.open(href!, "_blank", "noopener,noreferrer");
  };

  return (
    <a href={href} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}

const baseComponents: Partial<Components> = {
  code: CodeBlock,
  table: ScrollableTable,
  pre: PreBlock,
  a: MarkdownLink,
};

/** @deprecated Use baseComponents internally; kept for test compatibility */
export const markdownComponents: Components = baseComponents as Components;

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

  // Collect heading entries as heading components render (Finding 1 fix).
  // This replaces the fragile regex parser — slugs now come directly from
  // rehype-slug's id prop, guaranteeing parity.
  const headingsRef = useRef<HeadingEntry[]>([]);
  const firstH1SlugRef = useRef<string | null>(null);

  // Reset collected headings at the start of each render pass.
  // Reading/writing refs during render is safe here because:
  //  - we reset at the top of the render (before children mount)
  //  - heading components append during the same synchronous render pass
  //  - section components read the ref during the same render pass
  // This is a well-known "accumulator ref" pattern in React.
  headingsRef.current = [];
  firstH1SlugRef.current = null;

  const registerHeading = useCallback((entry: HeadingEntry) => {
    headingsRef.current.push(entry);
    if (entry.level === 1 && firstH1SlugRef.current === null) {
      firstH1SlugRef.current = entry.slug;
    }
  }, []);

  const toggleFold = useCallback((id: string) => {
    setFoldedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Build components with fold controls. Recreated when fold state changes,
  // which is acceptable — react-markdown must re-render on toggle anyway.
  // Heading components are created via makeHeadingComponent at module-level
  // factory (Finding 2 fix) — useMemo ensures stable component references
  // between renders when fold state hasn't changed.
  const components = useMemo<Components>(() => {
    const hTags = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
    const headingComponents: Partial<Components> = {};

    for (const tag of hTags) {
      headingComponents[tag] = makeHeadingComponent(tag, {
        foldedIds,
        toggleFold,
        firstH1SlugRef,
        registerHeading,
      });
    }

    return {
      ...baseComponents,
      ...headingComponents,
      section: ({ node: _node, children, ...props }: React.ComponentPropsWithoutRef<'section'> & ExtraProps & { "data-fold-slug"?: string }) => {
        const slug = props["data-fold-slug"] as string | undefined;
        if (!slug) return <section {...props}>{children}</section>;
        // Compute effective-hidden inline using collected headings.
        // By the time a section renders, all preceding heading components
        // have already called registerHeading (synchronous render order).
        const hidden = computeEffectiveHidden(headingsRef.current, foldedIds).has(slug);
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
  }, [foldedIds, toggleFold, registerHeading]);

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
          color: var(--color-fg);
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
          border-bottom: 1px solid var(--color-border);
          color: var(--color-fg);
        }
        .md-content h2 {
          font-size: 18px;
          font-weight: 600;
          margin: 20px 0 8px;
          padding-bottom: 6px;
          border-bottom: 1px solid var(--color-separator);
          color: var(--color-accent-blue);
        }
        .md-content h3 {
          font-size: 15px;
          font-weight: 600;
          margin: 16px 0 6px;
          color: var(--color-accent-purple);
        }
        .md-content p {
          margin: 8px 0;
        }
        .md-content a {
          color: var(--color-accent-cyan);
          text-decoration: none;
        }
        .md-content a:hover {
          text-decoration: underline;
        }
        .md-content code {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 12px;
          background: var(--color-surface);
          padding: 2px 6px;
          border-radius: 4px;
          color: var(--color-accent-green);
        }
        .md-content pre {
          background: var(--color-bg);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          padding: 12px 16px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-x pan-y;
          margin: 12px 0;
        }
        .md-content pre code {
          background: none;
          padding: 0;
          color: var(--color-fg);
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
          border-bottom: 2px solid var(--color-border);
          color: var(--color-accent-blue);
          font-weight: 600;
        }
        .md-content td {
          padding: 6px 12px;
          border-bottom: 1px solid var(--color-separator);
        }
        .md-content ul, .md-content ol {
          padding-left: 20px;
          margin: 8px 0;
        }
        .md-content li {
          margin: 4px 0;
        }
        .md-content blockquote {
          border-left: 3px solid var(--color-accent-blue);
          margin: 12px 0;
          padding: 4px 16px;
          color: var(--color-fg-muted);
          background: var(--color-bg);
          border-radius: 0 4px 4px 0;
        }
        /* GitHub-style alert admonitions */
        .md-content .markdown-alert {
          border-left-width: 3px;
          border-left-style: solid;
          border-radius: 0 4px 4px 0;
          margin: 12px 0;
          padding: 8px 16px;
          background: var(--color-bg);
        }
        .md-content .markdown-alert .markdown-alert-title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
          font-size: 13px;
          margin-bottom: 4px;
        }
        .md-content .markdown-alert .markdown-alert-title svg.octicon {
          width: 16px;
          height: 16px;
          fill: currentColor;
        }
        .md-content .markdown-alert-note {
          border-left-color: #7aa2f7;
        }
        .md-content .markdown-alert-note .markdown-alert-title {
          color: #7aa2f7;
        }
        .md-content .markdown-alert-tip {
          border-left-color: #9ece6a;
        }
        .md-content .markdown-alert-tip .markdown-alert-title {
          color: #9ece6a;
        }
        .md-content .markdown-alert-important {
          border-left-color: #bb9af7;
        }
        .md-content .markdown-alert-important .markdown-alert-title {
          color: #bb9af7;
        }
        .md-content .markdown-alert-warning {
          border-left-color: #e0af68;
        }
        .md-content .markdown-alert-warning .markdown-alert-title {
          color: #e0af68;
        }
        .md-content .markdown-alert-caution {
          border-left-color: #f7768e;
        }
        .md-content .markdown-alert-caution .markdown-alert-title {
          color: #f7768e;
        }
        .md-content hr {
          border: none;
          border-top: 1px solid var(--color-border);
          margin: 16px 0;
        }
        .md-content strong {
          color: var(--color-accent-yellow);
          font-weight: 600;
        }
        .md-content img {
          display: block;
          max-width: 100%;
          height: auto;
          border-radius: 8px;
          margin: 0.5em 0;
        }
        .md-content .mermaid-mount {
          margin: 12px 0;
        }
        .md-content .mermaid-container {
          background: var(--color-bg);
          border: 1px solid var(--color-border);
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
          background: var(--color-bg);
          border: 1px dashed var(--color-border);
          border-radius: 6px;
          padding: 24px 16px;
          text-align: center;
          color: var(--color-muted);
          font-size: 13px;
          font-style: italic;
          margin: 12px 0;
        }
        .md-content .mermaid-error {
          background: var(--color-bg);
          border: 1px solid var(--color-accent-red);
          border-radius: 6px;
          padding: 12px 16px;
          margin: 12px 0;
        }
        .md-content .mermaid-error-label {
          color: var(--color-accent-red);
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
        }
        .md-content .cpc-fold-btn {
          all: unset;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 3px;
          width: 100%;
        }
        .md-content .cpc-fold-label {
          flex: 1 1 auto;
          min-width: 0;
        }
        .md-content .cpc-fold-btn:focus-visible {
          outline: 2px solid var(--color-accent-blue);
          outline-offset: 1px;
        }
        .md-content .cpc-toggle-chevron {
          color: var(--color-muted);
          font-size: 10px;
          transition: transform 0.2s ease;
        }
        .md-content .cpc-fold-btn:hover .cpc-toggle-chevron {
          color: var(--color-accent-blue);
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
