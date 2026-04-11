import React, { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeSlug from "rehype-slug";
import { MermaidDiagram } from "./MermaidDiagram";

interface MarkdownViewerProps {
  content: string;
  fileName: string;
}

export const markdownRemarkPlugins = [remarkGfm, remarkBreaks];

// rehype-slug is pinned to major 6 in package.json. Heading IDs are a contract
// for deep links, TOC state, and collapsible headings.
export const markdownRehypePlugins = [rehypeSlug];

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

export const markdownComponents: Components = {
  code: CodeBlock,
  table: ScrollableTable,
  pre: PreBlock,
};

export function MarkdownViewer({ content, fileName: _fileName }: MarkdownViewerProps) {
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
      `}</style>
      <div className="md-content">
        <ReactMarkdown
          remarkPlugins={markdownRemarkPlugins}
          rehypePlugins={markdownRehypePlugins}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
