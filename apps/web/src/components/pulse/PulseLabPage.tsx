import { useState } from "react";
import PulseDashboardPage, { type DashboardId } from "./PulseDashboardPage";

interface DashboardMeta {
  id: DashboardId;
  name: string;
  description: string;
}

const DASHBOARDS: DashboardMeta[] = [
  {
    id: "minimalist",
    name: "Minimalist Text",
    description: "Terminal-first triage surface. Dense monospace rows, color-coded by severity.",
  },
  {
    id: "visual-chart",
    name: "Visual Chart",
    description: "Leads with donut + bar charts for instant org health at a glance.",
  },
  {
    id: "tabular",
    name: "Tabular Terminal",
    description: "Sortable table with filter bar. Every metric a first-class column.",
  },
  {
    id: "alert-first",
    name: "Alert First",
    description: "Inverted hierarchy — highest-priority alerts at pixel zero, no summary.",
  },
];

export default function PulseLabPage() {
  const [activeDashboard, setActiveDashboard] = useState<DashboardId | null>(null);

  if (activeDashboard) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {/* Back header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            borderBottom: "1px solid #1f2937",
            background: "#0f1117",
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setActiveDashboard(null)}
            style={{
              background: "none",
              border: "none",
              color: "#60a5fa",
              fontSize: 13,
              cursor: "pointer",
              padding: "4px 0",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            ← Back
          </button>
          <span style={{ color: "#9ca3af", fontSize: 12 }}>
            {DASHBOARDS.find((d) => d.id === activeDashboard)?.name}
          </span>
        </div>
        {/* Dashboard fills remaining height */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <PulseDashboardPage dashboardId={activeDashboard} />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        background: "#0f1117",
        color: "#e5e7eb",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        boxSizing: "border-box",
        maxWidth: "100%",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 16px 12px",
          borderBottom: "1px solid #1f2937",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: "#f3f4f6" }}>
          Dashboard Lab
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
          4 design concepts for Org Pulse v2. Tap a card to preview.
        </div>
      </div>

      {/* Cards */}
      <div style={{ padding: "12px 12px 32px" }}>
        {DASHBOARDS.map((d, i) => (
          <button
            key={d.id}
            onClick={() => setActiveDashboard(d.id)}
            style={{
              width: "100%",
              background: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 10,
              padding: "14px 16px",
              marginBottom: 10,
              cursor: "pointer",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 12,
              minHeight: 64,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "#1f2937",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 700,
                color: "#60a5fa",
                flexShrink: 0,
                fontFamily: "monospace",
              }}
            >
              {i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#f3f4f6", marginBottom: 3 }}>
                {d.name}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.4 }}>
                {d.description}
              </div>
            </div>
            <span style={{ color: "#374151", fontSize: 16, flexShrink: 0 }}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
