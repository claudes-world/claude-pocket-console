import { useEffect, useState } from "react";
import { getAuthHeaders, getTelegramWebApp } from "../lib/telegram";

interface CockpitPageProps {
  onBack: () => void;
}

export function CockpitPage({ onBack }: CockpitPageProps) {
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    const backButton = getTelegramWebApp()?.BackButton;
    backButton?.show();
    backButton?.onClick(onBack);
    return () => {
      backButton?.offClick(onBack);
      backButton?.hide();
    };
  }, [onBack]);

  useEffect(() => {
    let active = true;
    fetch("/api/cockpit-proxy/health", {
      headers: getAuthHeaders(),
      credentials: "same-origin",
    })
      .then(async (response) => response.ok ? response.json() : { configured: false })
      .then((result) => {
        if (active) setState(result.configured === true ? "ready" : "unavailable");
      })
      .catch(() => {
        if (active) setState("unavailable");
      });
    return () => { active = false; };
  }, []);

  if (state !== "ready") {
    return (
      <div style={{
        alignItems: "center",
        background: "var(--color-bg)",
        color: "var(--color-muted)",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        padding: 20,
        textAlign: "center",
      }}>
        {state === "loading" ? "Opening Fleet Cockpit…" : "Fleet Cockpit is not configured."}
      </div>
    );
  }

  return (
    <iframe
      src="/api/cockpit-proxy/"
      title="Fleet Cockpit"
      style={{ border: 0, display: "block", height: "100%", width: "100%" }}
    />
  );
}
