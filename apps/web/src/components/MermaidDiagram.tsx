import { useEffect, useId, useRef, useState } from "react";

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
          primaryColor: "#7aa2f7",
          background: "#1a1b26",
          textColor: "#c0caf5",
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
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
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
      isMountedRef.current = false;
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
