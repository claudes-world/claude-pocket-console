import { useEffect, useId, useState } from "react";

interface MermaidDiagramProps {
  source: string;
}

// Module-level singleton so every diagram shares one mermaid instance and
// initialization only runs once. We store the promise itself so concurrent
// callers await the same init.
type MermaidModule = typeof import("mermaid").default;
let mermaidPromise: Promise<MermaidModule> | null = null;

function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "strict",
        themeVariables: {
          // Tokyo Night palette mapped to mermaid's documented theme variable
          // names. Previously used `background` and `textColor` which are NOT
          // recognized by mermaid and were silently ignored — verified against
          // mermaid 11 docs. The correct keys are `mainBkg` for background
          // surfaces and `primaryTextColor` for text on primary nodes.
          primaryColor: "#7aa2f7",
          primaryTextColor: "#c0caf5",
          primaryBorderColor: "#2a2b3d",
          mainBkg: "#1a1b26",
          nodeBorder: "#2a2b3d",
          lineColor: "#565f89",
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

export function MermaidDiagram({ source }: MermaidDiagramProps) {
  // useId returns a string containing colons, which are not valid in CSS
  // selectors and cause mermaid.render to throw. Sanitize it.
  const rawId = useId();
  const id = `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mermaid = await loadMermaid();
        if (cancelled) return;
        const { svg: rendered } = await mermaid.render(id, source);
        if (cancelled) return;
        setSvg(rendered);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Failed to render diagram";
        setError(message);
        setSvg(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, source]);

  if (error) {
    return (
      <div className="mermaid-error">
        <div className="mermaid-error-label">Mermaid render error</div>
        <pre>{source}</pre>
      </div>
    );
  }

  if (!svg) {
    return <div className="mermaid-loading">Loading diagram…</div>;
  }

  return (
    <div
      className="mermaid-container"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
