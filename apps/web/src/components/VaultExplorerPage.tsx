import { useEffect, useMemo, useRef, useState } from "react";
import sampleExport from "../fixtures/vault-link-check.sample.json";
import {
  FINDING_CATEGORIES,
  findPageByPath,
  getBacklinks,
  getOutgoingEdges,
  groupVaultPages,
  mapVaultFindings,
  parseVaultIndex,
  type FindingCategory,
  type VaultEdge,
  type VaultIndex,
  type VaultPage,
} from "../lib/vault-explorer";
import { getTelegramWebApp } from "../lib/telegram";

interface VaultExplorerPageProps {
  onBack: () => void;
}

type ExplorerView = "browse" | "health";

interface PageSelection {
  path: string;
  page: VaultPage | null;
  line?: number;
}

const CATEGORY_LABELS: Record<FindingCategory, string> = {
  broken: "Broken",
  ambiguous: "Ambiguous",
  orphan: "Orphan",
  unreferenced_raw: "Unreferenced raw",
  receipt: "Receipt",
};

const CATEGORY_COLORS: Record<FindingCategory, string> = {
  broken: "var(--color-accent-red)",
  ambiguous: "var(--color-accent-yellow)",
  orphan: "var(--color-accent-purple)",
  unreferenced_raw: "var(--color-accent-cyan)",
  receipt: "var(--color-accent-orange)",
};

const sampleResult = parseVaultIndex(sampleExport);
if (!sampleResult.ok) throw new Error(`Invalid bundled vault fixture: ${sampleResult.message}`);
const SAMPLE_INDEX = sampleResult.data;

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function pageSelection(page: VaultPage, line?: number): PageSelection {
  return { path: page.path, page, ...(line === undefined ? {} : { line }) };
}

export function VaultExplorerPage({ onBack }: VaultExplorerPageProps) {
  const [index, setIndex] = useState<VaultIndex>(SAMPLE_INDEX);
  const [view, setView] = useState<ExplorerView>("browse");
  const [loadOpen, setLoadOpen] = useState(false);
  const [pastedJson, setPastedJson] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<PageSelection>(() => pageSelection(SAMPLE_INDEX.pages[0]));
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const backButton = getTelegramWebApp()?.BackButton;
    backButton?.show();
    backButton?.onClick(onBack);
    return () => {
      backButton?.offClick(onBack);
      backButton?.hide();
    };
  }, [onBack]);

  const groups = useMemo(() => groupVaultPages(index.pages), [index.pages]);
  const mappedFindings = useMemo(() => mapVaultFindings(index), [index]);

  const revealDetail = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    });
  };

  const selectPage = (page: VaultPage, line?: number) => {
    setSelection(pageSelection(page, line));
    revealDetail();
  };

  const selectReference = (path: string, line?: number) => {
    const page = findPageByPath(index.pages, path);
    setSelection({ path, page, ...(line === undefined ? {} : { line }) });
    setView("browse");
    revealDetail();
  };

  const loadValue = (value: string | unknown) => {
    const result = parseVaultIndex(value);
    if (!result.ok) {
      setLoadError(result.message);
      return false;
    }
    setIndex(result.data);
    const firstPage = result.data.pages[0] ?? null;
    setSelection(firstPage ? pageSelection(firstPage) : { path: "No page selected", page: null });
    setLoadError(null);
    setLoadOpen(false);
    setView("browse");
    return true;
  };

  const resetToSample = () => {
    setPastedJson("");
    loadValue(sampleExport);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      setPastedJson(text);
      loadValue(text);
    } catch {
      setLoadError("The selected file could not be read.");
    }
  };

  const statusColor = index.status === "clean" ? "var(--color-accent-green)" : "var(--color-accent-yellow)";

  return (
    <div
      style={{
        background: "var(--color-bg)",
        color: "var(--color-fg)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        width: "100%",
      }}
    >
      <header
        style={{
          alignItems: "center",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          flexShrink: 0,
          gap: 10,
          minHeight: 48,
          padding: "max(8px, env(safe-area-inset-top)) 12px 8px",
        }}
        onTouchStart={(event) => event.stopPropagation()}
      >
        <button onClick={onBack} aria-label="Back to Links" style={iconButtonStyle}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Vault Explorer
          </div>
          <div style={{ color: "var(--color-muted)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {index.vault}
          </div>
        </div>
        <span style={{ color: "var(--color-muted)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Read only
        </span>
        <button
          onClick={() => { setLoadError(null); setLoadOpen((open) => !open); }}
          aria-expanded={loadOpen}
          style={{ ...smallButtonStyle, color: "var(--color-accent-blue)" }}
        >
          Load
        </button>
      </header>

      {loadOpen && (
        <section style={{ background: "var(--color-bg-alt)", borderBottom: "1px solid var(--color-border)", padding: 12 }}>
          <div style={{ color: "var(--color-fg-muted)", fontSize: 12, marginBottom: 10 }}>
            Open a local <code style={codeStyle}>link-check --json</code> export. Nothing is uploaded or saved.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <label style={{ ...smallButtonStyle, alignItems: "center", display: "inline-flex" }}>
              Choose JSON
              <input
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  void handleFile(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
                style={{ display: "none" }}
              />
            </label>
            <button onClick={resetToSample} style={smallButtonStyle}>Reset sample</button>
          </div>
          <textarea
            value={pastedJson}
            onChange={(event) => setPastedJson(event.target.value)}
            placeholder="Paste a version 1 link-check JSON export…"
            aria-label="Pasted link-check JSON"
            spellCheck={false}
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border-alt)",
              borderRadius: 8,
              color: "var(--color-fg)",
              display: "block",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              minHeight: 112,
              padding: 10,
              resize: "vertical",
              width: "100%",
            }}
          />
          {loadError && (
            <div role="alert" style={{ color: "var(--color-accent-red)", fontSize: 12, marginTop: 8 }}>
              {loadError}
            </div>
          )}
          <button
            onClick={() => loadValue(pastedJson)}
            disabled={!pastedJson.trim()}
            style={{
              ...primaryButtonStyle,
              marginTop: 10,
              opacity: pastedJson.trim() ? 1 : 0.45,
            }}
          >
            View pasted export
          </button>
        </section>
      )}

      <div style={{ borderBottom: "1px solid var(--color-border)", flexShrink: 0, padding: "10px 12px" }}>
        <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
          <div style={{ background: "var(--color-surface)", borderRadius: 8, display: "flex", padding: 2 }}>
            {(["browse", "health"] as const).map((item) => (
              <button
                key={item}
                onClick={() => setView(item)}
                style={{
                  background: view === item ? "var(--color-border-alt)" : "transparent",
                  border: 0,
                  borderRadius: 6,
                  color: view === item ? "var(--color-fg)" : "var(--color-muted)",
                  fontSize: 12,
                  fontWeight: view === item ? 700 : 500,
                  minHeight: 32,
                  padding: "6px 14px",
                  textTransform: "capitalize",
                }}
              >
                {item}
              </button>
            ))}
          </div>
          <span style={{ color: statusColor, fontSize: 11, fontWeight: 700, marginLeft: "auto", textTransform: "uppercase" }}>
            {index.status}
          </span>
        </div>
        <div style={{ color: "var(--color-muted)", fontSize: 10, marginTop: 6 }}>
          {index.pages.length} pages · {index.edges.length} links · generated {formatGeneratedAt(index.generated_at)}
        </div>
      </div>

      <main style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 12px max(20px, env(safe-area-inset-bottom))" }}>
        {view === "browse" ? (
          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
              margin: "0 auto",
              maxWidth: 920,
            }}
          >
            <section aria-label="Vault layers" style={panelStyle}>
              <SectionTitle title="Layers" detail={`${index.pages.length} pages`} />
              <LayerSection label="Index" pages={groups.index} selection={selection} onSelect={selectPage} defaultOpen />
              <LayerSection label="Raw" pages={groups.raw} selection={selection} onSelect={selectPage} />
              <details open style={detailsStyle}>
                <summary style={summaryStyle}>
                  <span>Wiki</span>
                  <span style={countStyle}>
                    {groups.wiki.concepts.length + groups.wiki.entities.length + groups.wiki.summaries.length + groups.wiki.other.length}
                  </span>
                </summary>
                <div style={{ borderLeft: "1px solid var(--color-border)", marginLeft: 10, paddingLeft: 8 }}>
                  <LayerSection label="Concepts" pages={groups.wiki.concepts} selection={selection} onSelect={selectPage} nested />
                  <LayerSection label="Entities" pages={groups.wiki.entities} selection={selection} onSelect={selectPage} nested />
                  <LayerSection label="Summaries" pages={groups.wiki.summaries} selection={selection} onSelect={selectPage} nested />
                  {groups.wiki.other.length > 0 && (
                    <LayerSection label="Other wiki" pages={groups.wiki.other} selection={selection} onSelect={selectPage} nested />
                  )}
                </div>
              </details>
              <LayerSection label="Doctrine" pages={groups.doctrine} selection={selection} onSelect={selectPage} />
              <LayerSection label="Armory" pages={groups.armory} selection={selection} onSelect={selectPage} />
              {groups.other.length > 0 && (
                <LayerSection label="Other" pages={groups.other} selection={selection} onSelect={selectPage} />
              )}
            </section>

            <PageDetail
              detailRef={detailRef}
              index={index}
              selection={selection}
              onSelect={selectPage}
            />
          </div>
        ) : (
          <HealthPanel
            index={index}
            mappedFindings={mappedFindings}
            onSelectReference={selectReference}
          />
        )}
      </main>
    </div>
  );
}

function LayerSection({
  label,
  pages,
  selection,
  onSelect,
  defaultOpen = false,
  nested = false,
}: {
  label: string;
  pages: VaultPage[];
  selection: PageSelection;
  onSelect: (page: VaultPage) => void;
  defaultOpen?: boolean;
  nested?: boolean;
}) {
  return (
    <details open={defaultOpen || nested} style={detailsStyle}>
      <summary style={{ ...summaryStyle, fontSize: nested ? 11 : 12 }}>
        <span>{label}</span>
        <span style={countStyle}>{pages.length}</span>
      </summary>
      {pages.length === 0 ? (
        <div style={{ color: "var(--color-muted)", fontSize: 11, padding: "5px 8px 8px" }}>No pages</div>
      ) : (
        <div style={{ display: "grid", gap: 4, padding: "4px 0 8px" }}>
          {pages.map((page) => {
            const selected = selection.page?.path === page.path;
            return (
              <button
                key={page.path}
                onClick={() => onSelect(page)}
                style={{
                  background: selected ? "rgba(122, 162, 247, 0.14)" : "transparent",
                  border: selected ? "1px solid rgba(122, 162, 247, 0.45)" : "1px solid transparent",
                  borderRadius: 7,
                  color: "var(--color-fg)",
                  minHeight: 42,
                  padding: "7px 9px",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <span style={{ display: "block", fontSize: 12, fontWeight: 600 }}>{page.title}</span>
                <span style={{ color: "var(--color-muted)", display: "block", fontFamily: "var(--font-mono)", fontSize: 9, marginTop: 2, overflowWrap: "anywhere" }}>
                  {page.path}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </details>
  );
}

function PageDetail({
  detailRef,
  index,
  selection,
  onSelect,
}: {
  detailRef: React.RefObject<HTMLDivElement | null>;
  index: VaultIndex;
  selection: PageSelection;
  onSelect: (page: VaultPage, line?: number) => void;
}) {
  const page = selection.page;
  const outgoing = page ? getOutgoingEdges(page, index.edges) : [];
  const backlinks = page ? getBacklinks(page, index.edges) : [];

  return (
    <section ref={detailRef} aria-label="Page details" style={{ ...panelStyle, scrollMarginTop: 12 }}>
      <SectionTitle title="Page" detail={selection.line ? `line ${selection.line}` : undefined} />
      {page ? (
        <>
          <div style={{ padding: "4px 0 14px" }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{page.title}</div>
            <div style={{ color: "var(--color-accent-blue)", fontFamily: "var(--font-mono)", fontSize: 10, marginTop: 5, overflowWrap: "anywhere" }}>
              {page.path}{selection.line ? `:${selection.line}` : ""}
            </div>
            <span style={{ ...pillStyle, marginTop: 8 }}>{page.kind}</span>
          </div>
          <EdgeList
            title="Outgoing"
            empty="No outgoing links"
            edges={outgoing}
            index={index}
            direction="outgoing"
            onSelect={onSelect}
          />
          <EdgeList
            title="Backlinks"
            empty="No pages link here"
            edges={backlinks}
            index={index}
            direction="backlink"
            onSelect={onSelect}
          />
        </>
      ) : (
        <div style={{ color: "var(--color-fg-muted)", fontSize: 12, padding: "8px 0" }}>
          <div style={{ color: "var(--color-accent-yellow)", fontWeight: 700 }}>Page is not present in this export.</div>
          <div style={{ fontFamily: "var(--font-mono)", marginTop: 8, overflowWrap: "anywhere" }}>
            {selection.path}{selection.line ? `:${selection.line}` : ""}
          </div>
        </div>
      )}
    </section>
  );
}

function EdgeList({
  title,
  empty,
  edges,
  index,
  direction,
  onSelect,
}: {
  title: string;
  empty: string;
  edges: VaultEdge[];
  index: VaultIndex;
  direction: "outgoing" | "backlink";
  onSelect: (page: VaultPage, line?: number) => void;
}) {
  return (
    <div style={{ borderTop: "1px solid var(--color-border)", padding: "12px 0" }}>
      <div style={{ color: "var(--color-fg-muted)", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 7, textTransform: "uppercase" }}>
        {title} <span style={{ color: "var(--color-muted)" }}>{edges.length}</span>
      </div>
      {edges.length === 0 ? (
        <div style={{ color: "var(--color-muted)", fontSize: 11 }}>{empty}</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {edges.map((edge, indexInList) => {
            const linkedPath = direction === "outgoing" ? edge.target : edge.source;
            const linkedPage = findPageByPath(index.pages, linkedPath);
            const canNavigate = linkedPage !== null && (direction === "backlink" || edge.resolved);
            return (
              <button
                key={`${edge.source}:${edge.line}:${edge.target}:${indexInList}`}
                onClick={() => {
                  if (canNavigate && linkedPage) onSelect(linkedPage, direction === "backlink" ? edge.line : undefined);
                }}
                disabled={!canNavigate}
                style={{
                  background: "var(--color-bg-alt)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 7,
                  color: "var(--color-fg)",
                  cursor: canNavigate ? "pointer" : "default",
                  minHeight: 44,
                  opacity: canNavigate ? 1 : 0.85,
                  padding: "8px 9px",
                  textAlign: "left",
                }}
              >
                <span style={{ alignItems: "center", display: "flex", gap: 6 }}>
                  <span style={{ color: edge.resolved ? "var(--color-accent-green)" : "var(--color-accent-red)", fontSize: 10 }}>
                    {edge.resolved ? "●" : "●"}
                  </span>
                  <span style={{ flex: 1, fontSize: 11, fontWeight: 600, overflowWrap: "anywhere" }}>
                    {edge.label || linkedPage?.title || linkedPath}
                  </span>
                  <span style={{ color: "var(--color-muted)", fontSize: 9 }}>line {edge.line}</span>
                </span>
                <span style={{ color: "var(--color-muted)", display: "block", fontFamily: "var(--font-mono)", fontSize: 9, marginLeft: 16, marginTop: 3, overflowWrap: "anywhere" }}>
                  {linkedPath}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HealthPanel({
  index,
  mappedFindings,
  onSelectReference,
}: {
  index: VaultIndex;
  mappedFindings: ReturnType<typeof mapVaultFindings>;
  onSelectReference: (path: string, line?: number) => void;
}) {
  return (
    <section aria-label="Vault health" style={{ ...panelStyle, margin: "0 auto", maxWidth: 720 }}>
      <SectionTitle title="Vault health" detail={index.status} />
      <div style={{ display: "grid", gap: 7, gridTemplateColumns: "repeat(5, minmax(54px, 1fr))", margin: "6px 0 14px", overflowX: "auto" }}>
        {FINDING_CATEGORIES.map((category) => (
          <div key={category} style={{ background: "var(--color-bg-alt)", border: "1px solid var(--color-border)", borderRadius: 8, minWidth: 54, padding: "9px 5px", textAlign: "center" }}>
            <div style={{ color: CATEGORY_COLORS[category], fontSize: 18, fontWeight: 800 }}>{index.counts[category]}</div>
            <div style={{ color: "var(--color-muted)", fontSize: 8, lineHeight: 1.2, marginTop: 3 }}>{CATEGORY_LABELS[category]}</div>
          </div>
        ))}
      </div>

      {FINDING_CATEGORIES.map((category) => (
        <details key={category} open={index.counts[category] > 0} style={detailsStyle}>
          <summary style={summaryStyle}>
            <span style={{ color: CATEGORY_COLORS[category] }}>{CATEGORY_LABELS[category]}</span>
            <span style={countStyle}>{index.counts[category]}</span>
          </summary>
          {mappedFindings[category].length === 0 ? (
            <div style={{ color: "var(--color-muted)", fontSize: 11, padding: "6px 8px 10px" }}>No findings</div>
          ) : (
            <div style={{ display: "grid", gap: 6, padding: "5px 0 10px" }}>
              {mappedFindings[category].map(({ finding, page }, findingIndex) => (
                <button
                  key={`${finding.path}:${finding.line ?? ""}:${findingIndex}`}
                  onClick={() => onSelectReference(finding.path, finding.line)}
                  style={{
                    background: "var(--color-bg-alt)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 7,
                    color: "var(--color-fg)",
                    minHeight: 48,
                    padding: "8px 9px",
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <span style={{ display: "block", fontSize: 11, fontWeight: 600 }}>{finding.reason}</span>
                  <span style={{ color: page ? "var(--color-accent-blue)" : "var(--color-accent-yellow)", display: "block", fontFamily: "var(--font-mono)", fontSize: 9, marginTop: 4, overflowWrap: "anywhere" }}>
                    {finding.path}{finding.line ? `:${finding.line}` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </details>
      ))}
    </section>
  );
}

function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  return (
    <div style={{ alignItems: "center", display: "flex", marginBottom: 8 }}>
      <h2 style={{ fontSize: 13, margin: 0 }}>{title}</h2>
      {detail && <span style={{ color: "var(--color-muted)", fontSize: 10, marginLeft: "auto" }}>{detail}</span>}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  minWidth: 0,
  padding: 12,
};

const detailsStyle: React.CSSProperties = {
  borderTop: "1px solid var(--color-border)",
};

const summaryStyle: React.CSSProperties = {
  alignItems: "center",
  color: "var(--color-fg-muted)",
  cursor: "pointer",
  display: "flex",
  fontSize: 12,
  fontWeight: 650,
  justifyContent: "space-between",
  minHeight: 38,
  padding: "6px 4px",
};

const countStyle: React.CSSProperties = {
  background: "var(--color-bg-alt)",
  borderRadius: 999,
  color: "var(--color-muted)",
  fontSize: 9,
  minWidth: 22,
  padding: "2px 6px",
  textAlign: "center",
};

const iconButtonStyle: React.CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  color: "var(--color-fg)",
  fontSize: 18,
  height: 34,
  width: 34,
};

const smallButtonStyle: React.CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border-alt)",
  borderRadius: 7,
  color: "var(--color-fg-muted)",
  cursor: "pointer",
  fontSize: 11,
  minHeight: 34,
  padding: "7px 10px",
};

const primaryButtonStyle: React.CSSProperties = {
  background: "var(--color-accent-blue)",
  border: 0,
  borderRadius: 7,
  color: "var(--color-bg)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
  minHeight: 38,
  padding: "8px 12px",
};

const codeStyle: React.CSSProperties = {
  background: "var(--color-surface)",
  borderRadius: 4,
  color: "var(--color-accent-cyan)",
  fontFamily: "var(--font-mono)",
  padding: "1px 4px",
};

const pillStyle: React.CSSProperties = {
  background: "var(--color-bg-alt)",
  border: "1px solid var(--color-border)",
  borderRadius: 999,
  color: "var(--color-fg-muted)",
  display: "inline-block",
  fontSize: 9,
  letterSpacing: "0.06em",
  padding: "3px 7px",
  textTransform: "uppercase",
};
