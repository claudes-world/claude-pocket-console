import { useMemo } from "react";
import { marked } from "marked";

interface MarkdownViewerProps {
  content: string;
  fileName: string;
}

// Configure marked for safe rendering
marked.setOptions({
  gfm: true,
  breaks: true,
});

export function MarkdownViewer({ content, fileName }: MarkdownViewerProps) {
  const html = useMemo(() => {
    return marked.parse(content) as string;
  }, [content]);

  return (
    <div
      style={{
        padding: "16px 16px",
        overflowY: "auto",
        overflowX: "auto",
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
          margin: 12px 0;
        }
        .md-content pre code {
          background: none;
          padding: 0;
          color: #c0caf5;
        }
        .md-content table {
          display: block;
          overflow-x: auto;
          width: 100%;
          border-collapse: collapse;
          margin: 12px 0;
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
      `}</style>
      <div
        className="md-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
