// src/App.js
import React, { useEffect, useRef, useState } from "react";
import {
  Routes,
  Route,
  NavLink,
  Navigate,
  useLocation,
} from "react-router-dom";
import ReactDOM from "react-dom";

import Dashboard from "./Dashboard.jsx";
import AuthGate from "./components/AuthGate.jsx";

// Iconified dashboard dropdown
import DashboardMenuNavItem from "./components/DashboardMenuNavItem.jsx";

// HR
import LogViolation from "./pages/LogViolation.jsx";
import Violations from "./pages/Violations.jsx";
import ViolationDetail from "./pages/ViolationDetail.jsx";
import PendingCalloutDocs from "./pages/PendingCalloutDocs.jsx";
import WeeklyReview from "./pages/WeeklyReview.jsx";
import Users from "./pages/Users.jsx";
import UserDetail from "./pages/UserDetail.jsx";

// Legacy/other
import GateAudit from "./pages/GateAudit.jsx";
import RollcallPage from "./pages/Rollcall.jsx";

// Interior audits
import InteriorAuditForm from "./pages/InteriorAuditForm.jsx";
import InteriorAuditsOverview from "./pages/InteriorAuditsOverview.jsx";

// ✅ Gate audits (NEW)
import GateAuditsOverview from "./pages/GateAuditsOverview.jsx";
import GateAuditForm from "./pages/GateAuditForm.jsx";

import UniformLog from "./pages/UniformLog.jsx";

// Finances
import Finances from "./pages/Finances.jsx";
import PatrolFuel from "./pages/PatrolFuel.jsx";
import PatrolFuelLogs from "./pages/PatrolFuelLogs.jsx";
import VehicleMaintenance from "./pages/VehicleMaintenance.jsx";
import OperationalExpenses from "./pages/OperationalExpenses.jsx";
import GuardCommendations from "./pages/GuardCommendations.jsx";

/* ---------- Finances dropdown (kept from before) ---------- */
function FinancesMenu() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnId = "fin-trigger";
  const isActive = location.pathname.startsWith("/finances");

  useEffect(() => setOpen(false), [location.pathname]);

  function Icon({ name, className = "h-5 w-5" }) {
    const common = {
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      className,
      "aria-hidden": "true",
    };
    switch (name) {
      case "overview":
        return (
          <svg {...common}>
            <path d="M3 12l9-9 9 9" />
            <path d="M9 21V9h6v12" />
          </svg>
        );
      case "fuel":
        return (
          <svg {...common}>
            <path d="M12 20a8 8 0 1 0-8-8" />
            <path d="M12 12l4-2" />
            <circle cx="12" cy="12" r="1.5" />
            <path d="M3 21h18" />
          </svg>
        );
      case "tool":
        return (
          <svg {...common}>
            <path d="M21 2l-2.5 2.5a5.5 5.5 0 0 0-7.8 7.8L2 21l3 1 1 3 8.7-8.7a5.5 5.5 0 0 0 7.8-7.8L22 3z" />
          </svg>
        );
      case "money":
        return (
          <svg {...common}>
            <path d="M12 1v22" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        );
      case "award":
        return (
          <svg {...common}>
            <circle cx="12" cy="8" r="6" />
            <path d="M15.9 13.4L17 22l-5-3-5 3 1.1-8.6" />
          </svg>
        );
      default:
        return null;
    }
  }

  useEffect(() => {
    const btn = document.getElementById(btnId);
    const updatePos = () => {
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left, width: r.width });
    };
    if (open) updatePos();

    const onDocClick = (e) => {
      if (e.target.closest(`#${btnId}`)) return;
      setOpen(false);
    };
    const onScroll = () => open && updatePos();

    document.addEventListener("click", onDocClick);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("click", onDocClick);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const Item = ({ to, icon, children }) => (
    <NavLink
      to={to}
      className="flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-[15px] hover:bg-black/5 dark:hover:bg-white/10"
      onClick={() => setOpen(false)}
      role="menuitem"
    >
      <Icon
        name={icon}
        className="h-5 w-5 shrink-0 text-slate-700 dark:text-white/80"
      />
      <span>{children}</span>
    </NavLink>
  );

  return (
    <>
      <button
        id={btnId}
        type="button"
        className={`sidebar-link whitespace-nowrap text-[15px] md:text-base font-medium px-4 py-2.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 ${
          isActive ? "sidebar-link-active" : ""
        }`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
      >
        Finances ▾
      </button>

      {open &&
        ReactDOM.createPortal(
          <div
            role="menu"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              minWidth: Math.max(320, pos.width),
            }}
            className="z-[1000] rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1E2430] shadow-2xl p-2"
          >
            <div className="grid grid-cols-1 gap-1">
              <Item to="/finances" icon="overview">
                Overview
              </Item>
              <Item to="/finances/fuel-logs" icon="fuel">
                Patrol Gas Fuel Logs
              </Item>
              <Item to="/finances/vehicle-maintenance" icon="tool">
                Vehicle Maintenance
              </Item>
              <Item to="/finances/operations" icon="money">
                Operational Expenses
              </Item>
              <Item to="/finances/commendations" icon="award">
                Guard Commendations
              </Item>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

/* ---------- NEW: Audit dropdown (Interior + Gate) ---------- */
function AuditMenu() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnId = "audit-trigger";
  const isActive = location.pathname.startsWith("/audits");

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    const btn = document.getElementById(btnId);
    const updatePos = () => {
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left, width: r.width });
    };
    if (open) updatePos();

    const onDocClick = (e) => {
      if (e.target.closest(`#${btnId}`)) return;
      setOpen(false);
    };
    const onScroll = () => open && updatePos();

    document.addEventListener("click", onDocClick);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("click", onDocClick);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const Item = ({ to, children }) => (
    <NavLink
      to={to}
      className="rounded-lg px-3.5 py-2.5 text-[15px] hover:bg-black/5 dark:hover:bg-white/10"
      onClick={() => setOpen(false)}
      role="menuitem"
    >
      {children}
    </NavLink>
  );

  return (
    <>
      <button
        id={btnId}
        type="button"
        className={`sidebar-link whitespace-nowrap text-[15px] md:text-base font-medium px-4 py-2.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 ${
          isActive ? "sidebar-link-active" : ""
        }`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
      >
        Audits ▾
      </button>

      {open &&
        ReactDOM.createPortal(
          <div
            role="menu"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              minWidth: Math.max(280, pos.width),
            }}
            className="z-[1000] rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1E2430] shadow-2xl p-2"
          >
            <div className="grid grid-cols-1 gap-1">
              <div className="px-3.5 py-1 text-xs uppercase tracking-wide opacity-60">
                Interior
              </div>
              <Item to="/audits/interior">Overview</Item>
              <Item to="/audits/interior/new">New Interior Audit</Item>

              <div className="px-3.5 pt-3 pb-1 text-xs uppercase tracking-wide opacity-60">
                Gate
              </div>
              <Item to="/audits/gate">Overview</Item>
              <Item to="/audits/gate/new">New Gate Audit</Item>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

export default function App() {
  const location = useLocation();

  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "dark" || saved === "light") return saved;
    } catch {}
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("theme", theme);
    } catch {}
  }, [theme]);

  const navLink = ({ isActive }) =>
    `sidebar-link whitespace-nowrap ${
      isActive ? "sidebar-link-active" : ""
    } text-[15px] md:text-base font-medium px-4 py-2.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10`;

  /* ---------- Ink/slider bar under active tab ---------- */
  const navRef = useRef(null);
  const [ink, setInk] = useState({ left: 0, width: 0, visible: false });

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;

    const updateInk = () => {
      const active =
        el.querySelector(".sidebar-link-active") ||
        el.querySelector('a[aria-current="page"]');

      if (!active) {
        setInk((s) => ({ ...s, visible: false }));
        return;
      }
      const nr = el.getBoundingClientRect();
      const ar = active.getBoundingClientRect();
      setInk({
        left: Math.max(0, ar.left - nr.left),
        width: ar.width,
        visible: true,
      });
    };

    updateInk();
    const ro = new ResizeObserver(updateInk);
    ro.observe(el);
    window.addEventListener("resize", updateInk);
    window.addEventListener("scroll", updateInk, true);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateInk);
      window.removeEventListener("scroll", updateInk, true);
    };
  }, [location.pathname]);

  return (
    <div className="min-h-screen">
      <style>{`
        *::-webkit-scrollbar-button { width: 0; height: 0; display: none; }
        html, body { overscroll-behavior-y: none; }
        .tab-rail { box-shadow: 0 1px 0 rgba(0,0,0,0.04); }
      `}</style>

      <header className="border-b border-sdg-dark/10 bg-white dark:border-white/10 dark:bg-[#0f1215]">
        <div className="container flex items-center justify-between py-4 md:py-5">
          <h1 className="font-heading tracking-tight text-3xl md:text-[2.4rem] leading-none">
            <span>Salient Defense Group</span>{" "}
            <span className="text-[0.92em] opacity-80">—</span>{" "}
            <span className="text-[0.92em] opacity-80">Operations</span>
          </h1>

          <button
            type="button"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            className="px-4 py-2 rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#11161f] hover:bg-black/5 dark:hover:bg-white/10 text-sm md:text-[15px]"
            title={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>

        {/* Tab rail */}
        <div className="container pb-3">
          <div className="overflow-x-auto">
            <div className="tab-rail border border-black/10 dark:border-white/10 rounded-2xl px-3 py-2 bg-white dark:bg-[#0f1215]">
              <nav
                ref={navRef}
                className="relative flex items-center gap-3 min-w-max"
              >
                <DashboardMenuNavItem />

                <NavLink to="/hr/violations/new" className={navLink}>
                  Report Violation
                </NavLink>
                <NavLink to="/hr/docs" className={navLink}>
                  Pending Callout Docs
                </NavLink>
                <NavLink to="/hr/violations" className={navLink}>
                  Violation Data
                </NavLink>
                <NavLink to="/hr/weekly-review" className={navLink}>
                  Weekly Review
                </NavLink>

                {/* ✅ Replaces single tab with a dropdown for audits */}
                <AuditMenu />

                <NavLink to="/hr/uniforms" className={navLink}>
                  Uniform Log
                </NavLink>
                <NavLink to="/hr/users" className={navLink}>
                  Users
                </NavLink>

                <FinancesMenu />

                {/* Ink bar */}
                <span
                  style={{
                    left: `${ink.left}px`,
                    width: `${ink.width}px`,
                    background: "var(--sdg-gold, #d4af37)",
                  }}
                  className={`pointer-events-none absolute bottom-[6px] h-[4px] rounded-full transition-all duration-300 ease-out ${
                    ink.visible ? "opacity-100" : "opacity-0"
                  }`}
                />
              </nav>
            </div>
          </div>
        </div>

        <div className="h-1.5 bg-sdg-gold" />
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />

          {/* Dashboard dropdown items */}
          <Route
            path="/rollcall"
            element={
              <AuthGate>
                <RollcallPage />
              </AuthGate>
            }
          />
          <Route path="/audit" element={<GateAudit />} />

          {/* Interior Audits */}
          <Route
            path="/audits/interior/new"
            element={
              <AuthGate>
                <InteriorAuditForm />
              </AuthGate>
            }
          />
          <Route
            path="/audits/interior"
            element={
              <AuthGate>
                <InteriorAuditsOverview />
              </AuthGate>
            }
          />

          {/* ✅ Gate Audits */}
          <Route
            path="/audits/gate/new"
            element={
              <AuthGate>
                <GateAuditForm />
              </AuthGate>
            }
          />
          <Route
            path="/audits/gate"
            element={
              <AuthGate>
                <GateAuditsOverview />
              </AuthGate>
            }
          />

          {/* HR */}
          <Route
            path="/hr/violations/new"
            element={
              <AuthGate>
                <LogViolation />
              </AuthGate>
            }
          />
          <Route
            path="/hr/violations"
            element={
              <AuthGate>
                <Violations />
              </AuthGate>
            }
          />
          <Route
            path="/hr/violations/:id"
            element={
              <AuthGate>
                <ViolationDetail />
              </AuthGate>
            }
          />
          <Route
            path="/hr/users"
            element={
              <AuthGate>
                <Users />
              </AuthGate>
            }
          />
          <Route
            path="/hr/users/:id"
            element={
              <AuthGate>
                <UserDetail />
              </AuthGate>
            }
          />
          <Route
            path="/hr/weekly-review"
            element={
              <AuthGate>
                <WeeklyReview />
              </AuthGate>
            }
          />
          <Route
            path="/hr/docs"
            element={
              <AuthGate>
                <PendingCalloutDocs />
              </AuthGate>
            }
          />
          <Route
            path="/hr/uniforms"
            element={
              <AuthGate>
                <UniformLog />
              </AuthGate>
            }
          />

          {/* Legacy Patrol Gas redirects */}
          <Route
            path="/patrol-gas/report"
            element={<Navigate to="/finances/fuel-report" replace />}
          />
          <Route
            path="/patrol-gas/logs"
            element={<Navigate to="/finances/fuel-logs" replace />}
          />

          {/* Finances */}
          <Route
            path="/finances"
            element={
              <AuthGate>
                <Finances />
              </AuthGate>
            }
          />
          <Route
            path="/finances/fuel-report"
            element={
              <AuthGate>
                <PatrolFuel />
              </AuthGate>
            }
          />
          <Route
            path="/finances/fuel-logs"
            element={
              <AuthGate>
                <PatrolFuelLogs />
              </AuthGate>
            }
          />
          <Route
            path="/finances/vehicle-maintenance"
            element={
              <AuthGate>
                <VehicleMaintenance />
              </AuthGate>
            }
          />
          <Route
            path="/finances/operations"
            element={
              <AuthGate>
                <OperationalExpenses />
              </AuthGate>
            }
          />
          <Route
            path="/finances/commendations"
            element={
              <AuthGate>
                <GuardCommendations />
              </AuthGate>
            }
          />

          <Route path="*" element={<Dashboard />} />
        </Routes>
      </main>
    </div>
  );
}
