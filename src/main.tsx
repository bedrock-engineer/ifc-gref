import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./app.tsx";

const reactScan = false

// react-scan: dev-only render diagnostics. Vite replaces `import.meta.env.DEV`
// with `false` in production builds, so the dynamic import + the entire branch
// are dead-code-eliminated from the prod bundle.
if (import.meta.env.DEV && reactScan) {
  const { scan } = await import("react-scan");
  scan({ enabled: true });
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
createRoot(document.querySelector("#root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
