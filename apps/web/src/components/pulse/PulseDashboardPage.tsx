import { useState, useEffect, Suspense, lazy, ComponentType } from "react";
import { getAuthHeaders } from "../../lib/telegram";
import type { PulseSnapshot } from "./MinimalistDashboard";
import MinimalistDashboard from "./MinimalistDashboard";
import TabularDashboard from "./TabularDashboard";
import AlertFirstDashboard from "./AlertFirstDashboard";

// Lazy-load VisualChartDashboard (imports recharts, ~50kB)
const VisualChartDashboard = lazy(() => import("./VisualChartDashboard"));

export type DashboardId = "minimalist" | "visual-chart" | "tabular" | "alert-first";

interface Props {
  dashboardId: DashboardId;
}

function LoadingSkeletonInner() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 16,
        background: "#0f1117",
        minHeight: "100%",
      }}
    >
      {[80, 60, 90, 50, 70].map((w, i) => (
        <div
          key={i}
          style={{
            height: 16,
            borderRadius: 4,
            background: "#1f2937",
            width: `${w}%`,
            opacity: 0.6,
          }}
        />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60%",
        padding: 24,
        color: "#9ca3af",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: 13,
        textAlign: "center",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 24 }}>⚠</div>
      <div style={{ color: "#f87171", fontWeight: 600 }}>Pulse snapshot unavailable</div>
      <div style={{ color: "#6b7280", fontSize: 12 }}>{message}</div>
    </div>
  );
}

function resolveDashboard(id: DashboardId): ComponentType<{ data: PulseSnapshot }> | null {
  switch (id) {
    case "minimalist": return MinimalistDashboard;
    case "tabular": return TabularDashboard;
    case "alert-first": return AlertFirstDashboard;
    default: return null; // visual-chart handled via Suspense/lazy
  }
}

export default function PulseDashboardPage({ dashboardId }: Props) {
  const [snapshot, setSnapshot] = useState<PulseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/pulse/current", { headers: getAuthHeaders() })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<PulseSnapshot>;
      })
      .then((data) => {
        if (!cancelled) {
          setSnapshot(data);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  if (loading) return <LoadingSkeletonInner />;
  if (error || !snapshot) return <ErrorState message={error ?? "No snapshot data"} />;

  if (dashboardId === "visual-chart") {
    return (
      <Suspense fallback={<LoadingSkeletonInner />}>
        <VisualChartDashboard data={snapshot} />
      </Suspense>
    );
  }

  const Dashboard = resolveDashboard(dashboardId);
  if (!Dashboard) return <ErrorState message={`Unknown dashboard: ${dashboardId}`} />;
  return <Dashboard data={snapshot} />;
}
