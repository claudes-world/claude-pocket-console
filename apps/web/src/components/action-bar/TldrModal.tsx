import { useEffect, useRef, useState } from "react";
import { BottomSheet } from "../BottomSheet";
import { summarizeMarkdown } from "./api";
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
      if (abortRef.current === null) inFlightRef.current = false;
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
      <div style={{ fontSize: 12, color: "#a9b1d6", marginBottom: 12 }}>{viewingFile.name}</div>
      {loading && (
        <>
          {/* Loading animation for the 15-20s LLM generation window.
              Pure CSS keyframes (no new deps). Three signals so the UI
              never looks frozen: (1) a rotating teal spinner, (2) a
              pulsing "Generating summary…" label, and (3) three
              bouncing dots. Tokyo Night palette: bg #1a1b26, text
              #c0caf5, accent #7dcfff. */}
          <style>{`
            @keyframes tldr-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            @keyframes tldr-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
            @keyframes tldr-bounce {
              0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
              40%           { transform: translateY(-4px); opacity: 1; }
            }
            @media (prefers-reduced-motion: reduce) {
              [data-tldr-spinner], [data-tldr-label], [data-tldr-dot] {
                animation: none !important;
              }
              [data-tldr-spinner] { border-top-color: #7dcfff; }
              [data-tldr-label]   { opacity: 1; }
              [data-tldr-dot]     { opacity: 0.9; }
            }
          `}</style>
          <div
            role="status"
            aria-live="polite"
            aria-label="Generating summary"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              padding: "28px 16px",
              minHeight: 140,
            }}
          >
            <div
              data-tldr-spinner=""
              aria-hidden="true"
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                border: "3px solid #2a2b3d",
                borderTopColor: "#7dcfff",
                animation: "tldr-spin 0.9s linear infinite",
              }}
            />
            <div
              data-tldr-label=""
              style={{
                fontSize: 13,
                color: "#c0caf5",
                animation: "tldr-pulse 1.6s ease-in-out infinite",
              }}
            >
              Generating summary…
            </div>
            <div aria-hidden="true" style={{ display: "flex", gap: 5 }}>
              {[0, 0.15, 0.3].map((delay) => (
                <span
                  key={delay}
                  data-tldr-dot=""
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#7dcfff",
                    animation: `tldr-bounce 1.2s ease-in-out ${delay}s infinite`,
                  }}
                />
              ))}
            </div>
            <div style={{ fontSize: 11, color: "#a9b1d6" }}>
              typically 15-20 seconds
            </div>
          </div>
        </>
      )}
      {!loading && error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#f7768e", padding: "8px 10px", background: "#2a1a22", border: "1px solid #4a2d3a", borderRadius: 6 }}>{error}</div>
          <button disabled={loading} onClick={() => void generateTldr(viewingFile.path)} style={{ ...btnStyle, padding: "10px 14px", background: "#1a3a3a", color: "#7dcfff", border: "1px solid #2d5a5a" }}>Retry</button>
        </div>
      )}
      {!loading && !error && summary && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 10, color: "#565f89" }}>{cached ? "cached" : `fresh (${ms}ms)`}</div>
          <div style={{ background: "#16171f", border: "1px solid #2a2b3d", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#c0caf5", maxHeight: "45vh", overflowY: "auto" }}>
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
            <button onClick={copyTldr} style={{ ...btnStyle, padding: "10px 14px", background: "#1a3a3a", color: "#7dcfff", border: "1px solid #2d5a5a" }}>{copied ? "Copied" : "Copy"}</button>
            <button disabled={loading} onClick={() => void generateTldr(viewingFile.path, true)} style={{ ...btnStyle, padding: "10px 14px" }}>Regenerate</button>
          </div>
          {copyError && <div style={{ fontSize: 11, color: "#f7768e", marginTop: 4 }}>{copyError}</div>}
        </div>
      )}
    </BottomSheet>
  );
}
