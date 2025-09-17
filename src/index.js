import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom"; // swap to HashRouter if your host lacks SPA rewrites
import App from "./App";
import { ToasterProvider } from "./lib/toast";

/**
 * Apply dark mode class before render to avoid FOUC.
 * Uses localStorage('theme') = 'dark' | 'light', with system preference fallback.
 */
(function hydrateTheme() {
  try {
    const saved = localStorage.getItem("theme");
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    document.documentElement.classList.toggle(
      "dark",
      saved === "dark" || (!saved && prefersDark)
    );
  } catch {
    // no-op
  }
})();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ToasterProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ToasterProvider>
  </React.StrictMode>
);

/* If deploying to a static host without SPA rewrites, use HashRouter:
import { HashRouter } from "react-router-dom";
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ToasterProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </ToasterProvider>
  </React.StrictMode>
);
*/
