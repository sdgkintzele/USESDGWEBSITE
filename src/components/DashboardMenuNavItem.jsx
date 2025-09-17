// src/components/DashboardMenuNavItem.jsx
import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPortal } from "react-dom";

const REPORT_VIOLATION_PATH = "/hr/violations/new";
const INTERIOR_AUDIT_FORM_PATH = "/audits/interior/new";

/* ---------------- Icons ---------------- */
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
    vectorEffect: "non-scaling-stroke",
  };

  switch (name) {
    case "overview":
      return (
        <svg {...common}>
          <path d="M3 12l9-9 9 9" />
          <path d="M9 21V9h6v12" />
        </svg>
      );
    case "rollcall":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="14" height="16" rx="2" />
          <path d="M7 8h6M7 12h6M7 16h4" />
          <path d="M18.5 8.5l2 2 3-3" />
        </svg>
      );
    case "fuel": // gauge
      return (
        <svg {...common}>
          <path d="M12 20a8 8 0 1 0-8-8" />
          <path d="M12 12l4-2" />
          <circle cx="12" cy="12" r="1.5" />
          <path d="M3 21h18" />
        </svg>
      );
    case "shield": // security shield for Interior Audit
      return (
        <svg {...common}>
          <path d="M12 2l7 3v6c0 5-3.5 9-7 11-3.5-2-7-6-7-11V5l7-3z" />
          <path d="M9.5 12.5l2 2 3.5-3.5" />
        </svg>
      );
    case "truck": // gate audit
      return (
        <svg {...common}>
          <path d="M1 16V7a2 2 0 0 1 2-2h9v11H1z" />
          <path d="M12 11h5l3 3v2h-8" />
          <circle cx="5" cy="18" r="2" />
          <circle cx="17" cy="18" r="2" />
        </svg>
      );
    case "warning": // report violation
      return (
        <svg {...common}>
          <path d="M12 2l10 18H2L12 2z" />
          <path d="M12 9v5" />
          <circle cx="12" cy="17" r="1.5" />
        </svg>
      );
    default:
      return null;
  }
}

/* -------------- Dropdown via PORTAL (no clipping) -------------- */
export default function DashboardMenuNavItem() {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 320 });
  const location = useLocation();

  // Mark Dashboard as "active" for these routes (Overview, Rollcall, Interior Audit FORM, Gate Audit).
  // NOTE: We intentionally do NOT include "/audits/interior" (the Overview page)
  // so the Audit Overview top tab owns that active state.
  const isDashActive = [
    "/",
    "/rollcall",
    INTERIOR_AUDIT_FORM_PATH,
    "/audit",
  ].some((p) =>
    p === "/" ? location.pathname === "/" : location.pathname.startsWith(p)
  );

  // close on route change
  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    const updatePos = () => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const minW = Math.max(320, r.width);
      let left = r.left;
      if (left + minW > vw - 8) left = Math.max(8, vw - minW - 8);
      setPos({ top: r.bottom + 6, left, width: minW });
    };

    if (open) updatePos();

    const onDocClick = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    const onScroll = () => open && updatePos();

    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const Item = ({ to, icon, children }) => (
    <Link
      to={to}
      role="menuitem"
      className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[15px]"
      onClick={() => setOpen(false)}
    >
      <Icon
        name={icon}
        className="h-5 w-5 shrink-0 text-slate-700 dark:text-white/80"
      />
      <span className="leading-none">{children}</span>
    </Link>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="Open Dashboard menu"
        className={`sidebar-link whitespace-nowrap inline-flex items-center gap-1 px-4 py-2.5 text-[15px] md:text-base font-medium rounded-lg hover:bg-black/5 dark:hover:bg-white/10 ${
          isDashActive ? "sidebar-link-active" : ""
        }`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Dashboard
        <svg
          className="h-5 w-5 opacity-70"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            role="menu"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              minWidth: pos.width,
            }}
            className="z-[1000] rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1E2430] shadow-2xl p-2"
          >
            <div className="grid grid-cols-1 gap-1">
              <Item to="/" icon="overview">
                Overview
              </Item>
              <Item to="/rollcall" icon="rollcall">
                Roll Call
              </Item>
              <Item to={REPORT_VIOLATION_PATH} icon="warning">
                Report Violation
              </Item>
              <Item to="/finances/fuel-report" icon="fuel">
                Patrol Fuel
              </Item>

              {/* 🔁 UPDATED: “Interior Audit” now opens the new-audit form */}
              <Item to={INTERIOR_AUDIT_FORM_PATH} icon="shield">
                Interior Audit
              </Item>

              <Item to="/audit" icon="truck">
                Gate Audit
              </Item>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
