import { useEffect, useRef, useState } from "react";
import { BottomSheet } from "../BottomSheet";
import { summarizeMarkdown } from "./api";
import { InProgressAnimation } from "./InProgressAnimation";
import { btnStyle } from "./types";

interface TldrModalProps {
  viewingFile: { path: string; name: string };
  onClose: () => void;
}

export function TldrModal({ viewingFile, onClose }: TldrModalProps) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [ms, setMs] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const generateTldr = async (filePath: string, force = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const requestId = ++requestIdRef.current;
    abortRef.current?.abort();
    setLoading(true);
    setError(null);
    setSummary(null);
    setCopied(false);
    setCopyError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 70_000);
    try {
      const data = await summarizeMarkdown(filePath, force, controller.signal);
      if (requestIdRef.current !== requestId) return;
      if (!data.ok) setError(data.error || "Failed to generate summary");
      else {
        setSummary(data.summary || "");
        setCached(Boolean(data.cached));
        setMs(Number(data.ms) || 0);
      }
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      setError(err instanceof DOMException && err.name === "AbortError" ? "Took too long — Claude may be slow right now" : `Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timeout);
      if (abortRef.current === controller) abortRef.current = null;
      inFlightRef.current = false;
      if (requestIdRef.current === requestId) setLoading(false);
    }
  };

  useEffect(() => {
    // React 18 StrictMode intentionally remounts components in dev, which
    // would double-fire the summarize request. Defer the call via a
    // setTimeout so the immediate StrictMode unmount can cancel the first
    // scheduling, and only the second mount's timer actually runs.
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      void generateTldr(viewingFile.path);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      inFlightRef.current = false;
    };
  }, [viewingFile.path]);

  const copyTldr = async () => {
    if (!summary) return;
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 1500);
    } catch {
      setCopyError("Copy failed — long-press the text to copy manually");
    }
  };

  const handleClose = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    inFlightRef.current = false;
    requestIdRef.current++;
    setLoading(false);
    onClose();
  };

  return (
    <BottomSheet onClose={handleClose} title="TL;DR">
      <div style={{ fontSize: 12, color: "var(--color-fg-muted)", marginBottom: 12 }}>{viewingFile.name}</div>
      {loading && (
        <InProgressAnimation
          label="Generating summary…"
          hint="typically 15-20 seconds"
          ariaLabel="Generating summary"
        />
      )}
      {!loading && error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--color-accent-red)", padding: "8px 10px", background: "#2a1a22", border: "1px solid #4a2d3a", borderRadius: 6 }}>{error}</div>
          <button onClick={() => void generateTldr(viewingFile.path)} style={{ ...btnStyle, padding: "10px 14px", background: "#1a3a3a", color: "var(--color-accent-cyan)", border: "1px solid #2d5a5a" }}>Retry</button>
        </div>
      )}
      {!loading && !error && summary && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 10, color: "var(--color-muted)" }}>{cached ? "cached" : `fresh (${ms}ms)`}</div>
          <div style={{ background: "#16171f", border: "1px solid var(--color-border)", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "var(--color-fg)", maxHeight: "45vh", overflowY: "auto" }}>
            {/*
              XSS defense: the TL;DR summary comes from an LLM whose input is
              the (potentially malicious) markdown file. A prompt-injected
              document could coerce the model into emitting raw HTML,
              <script>, or javascript: URLs which a MarkdownViewer + marked
              + dangerouslySetInnerHTML pipeline would render unsanitized.
              Render the summary as plain text inside a <pre> instead, so
              no HTML parsing happens at all. This sacrifices markdown
              rendering (bold, headings appear as literal ## and **) but
              eliminates the attack surface entirely. A planned
              react-markdown migration will let us switch back to rich
              rendering with rehype-sanitize / no rehype-raw defenses.
            */}
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontFamily: "inherit", fontSize: "inherit", lineHeight: 1.5 }}>{summary}</pre>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={copyTldr} style={{ ...btnStyle, padding: "10px 14px", background: "#1a3a3a", color: "var(--color-accent-cyan)", border: "1px solid #2d5a5a" }}>{copied ? "Copied" : "Copy"}</button>
            <button onClick={() => void generateTldr(viewingFile.path, true)} style={{ ...btnStyle, padding: "10px 14px" }}>Regenerate</button>
          </div>
          {copyError && <div style={{ fontSize: 11, color: "var(--color-accent-red)", marginTop: 4 }}>{copyError}</div>}
        </div>
      )}
    </BottomSheet>
  );
}
