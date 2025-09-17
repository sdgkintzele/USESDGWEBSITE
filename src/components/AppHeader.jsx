// src/components/AppHeader.jsx
import React, { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

/** -----------------------------------------------------------------------
 *  Config: tabs (edit paths here if your routes differ)
 *  -------------------------------------------------------------------- */
const LINKS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/rollcall", label: "Roll Call" },
  { to: "/violations/new", label: "Report Violation" }, // or "/report-violation"
  { to: "/pending-docs", label: "Pending Docs" },
  { to: "/violation-data", label: "Violation Data" },
  { to: "/weekly-review", label: "Weekly Review" },
  { to: "/gate-audit", label: "Gate Audit" },
  { to: "/interior-audits", label: "Interior Audits" },
  { to: "/uniform-log", label: "Uniform Log" },
  { to: "/users", label: "Users" },
];

/** Simple dark-mode toggle: toggles `dark` class on <html> and persists */
function useThemeToggle() {
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false
  );
  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [dark]);

  // respect stored theme on first paint
  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "dark") setDark(true);
    if (stored === "light") setDark(false);
  }, []);

  return { dark, setDark };
}

export default function AppHeader() {
  const { dark, setDark } = useThemeToggle();

  return (
    <header className="w-full bg-white dark:bg-[#161b22]">
      {/* Top row: brand + mode button (full-width) */}
      <div className="mx-auto w-full px-4 sm:px-6">
        <div className="flex items-center justify-between py-3">
          <div>
            <h1 className="font-heading text-2xl sm:text-3xl leading-tight">
              Salient Defense Group
            </h1>
            <div className="text-sm text-sdg-slate dark:text-white/70">
              Operations
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDark((d) => !d)}
            className="btn btn-ghost"
            title="Toggle dark mode"
          >
            {dark ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </div>

      {/* Tabs row (full-width, scrollable if needed) */}
      <div className="w-full">
        <nav
          aria-label="Primary"
          className="flex gap-1 overflow-x-auto px-2 sm:px-4 pb-2"
        >
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/dashboard"} // active exact on dashboard
              className={({ isActive }) =>
                [
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-sm",
                  "hover:bg-black/5 dark:hover:bg-white/10",
                  isActive
                    ? "bg-black/5 dark:bg-white/10 font-semibold"
                    : "opacity-90",
                ].join(" ")
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Gold accent bar that runs full width */}
      <div
        className="h-[3px] w-full"
        style={{ background: "linear-gradient(90deg,#b98d2d,#d4af37,#b98d2d)" }}
      />
    </header>
  );
}
