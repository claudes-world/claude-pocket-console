// Install debug capture BEFORE any other imports that could throw.
// Guarded by try/catch and hostname gate — cannot crash the app.
import { installCapture } from "./debug/capture";
installCapture();

import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary level="root" name="root">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
