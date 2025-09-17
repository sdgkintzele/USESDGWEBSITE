// src/pages/Users.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { downloadCSV } from "../lib/csv";
import {
  fetchInteriorAuditAverages,
  fetchGateAuditAverages,
} from "../lib/audits";

/* ------------------------------- helpers -------------------------------- */
const pick = (r, ...keys) => {
  for (const k of keys) if (r?.[k] != null) return r[k];
  return null;
};

/* Badge */
function Badge({ tone = "slate", children }) {
  const theme =
    tone === "green"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200 border-green-200/70 dark:border-green-700/40"
      : tone === "amber"
      ? "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700/40"
      : tone === "rose"
      ? "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-900/40 dark:text-rose-200 dark:border-rose-700/40"
      : "bg-black/5 text-black/80 dark:bg-white/10 dark:text-white/80 border-black/10 dark:border-white/10";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] ${theme}`}
    >
      {children}
    </span>
  );
}

/* Tiny progress bar for audits */
function AuditBar({ value }) {
  if (value == null || Number.isNaN(Number(value))) return <span>—</span>;
  const pct = Math.max(0, Math.min(100, Number(value)));
  return (
    <div className="h-5 w-full rounded-md border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.06] relative overflow-hidden">
      <div className="h-full bg-green-500" style={{ width: `${pct}%` }} />
      <div className="absolute inset-0 flex items-center justify-center text-[12px] font-medium">
        {`${pct}%`}
      </div>
    </div>
  );
}

/* Initials avatar */
const avatarPalette = [
  "#E6F4FF",
  "#FDE8E8",
  "#E8F5E9",
  "#FFF7E6",
  "#F3E8FF",
  "#E8F7FA",
  "#F1F5F9",
  "#FDF2F8",
];
const avatarText = [
  "#1E40AF",
  "#9B1C1C",
  "#166534",
  "#92400E",
  "#5B21B6",
  "#0E7490",
  "#0F172A",
  "#9D174D",
];
function hashStr(s = "") {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
}
function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "•";
}
function Avatar({ name }) {
  const idx = hashStr(name) % avatarPalette.length;
  return (
    <div
      className="shrink-0 inline-flex items-center justify-center rounded-full border"
      style={{
        width: 32,
        height: 32,
        background: avatarPalette[idx],
        color: avatarText[idx],
        borderColor: "rgba(0,0,0,.08)",
      }}
    >
      <span className="text-[12px] font-semibold">{initials(name)}</span>
    </div>
  );
}

/* Simple Modal */
function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1E2430] shadow-xl overflow-hidden">
          <div
            className="h-1.5"
            style={{ background: "linear-gradient(90deg,#d4af37,#c49a2c)" }}
          />
          <div className="p-5">
            {title ? (
              <h3 className="font-heading text-xl mb-3">{title}</h3>
            ) : null}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/* Confirm Dialog */
function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "Confirm",
  onCancel,
  onConfirm,
  working,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onCancel}
        aria-hidden
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1E2430] shadow-xl overflow-hidden">
          <div
            className="h-1.5"
            style={{ background: "linear-gradient(90deg,#d4af37,#c49a2c)" }}
          />
          <div className="p-5">
            {title ? (
              <h3 className="font-heading text-xl mb-2">{title}</h3>
            ) : null}
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {message}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-md border px-3 py-2 hover:bg-black/5 dark:hover:bg:white/5"
                onClick={onCancel}
                disabled={working}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={onConfirm}
                disabled={working}
              >
                {working ? "Working…" : confirmText}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Toast */
function Toast({ open, message, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed z-[60] bottom-4 right-4">
      <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1E2430] shadow-lg px-4 py-3 text-sm">
        {message}
        <button
          className="ml-3 text-sdg-gold/90 hover:underline"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}

/* ---------------------------- export columns ---------------------------- */
const EXPORT_COLUMNS = [
  { key: "full_name", label: "Name", export: (r) => r.full_name },
  {
    key: "employment_type",
    label: "Role",
    export: (r) =>
      r.employment_type || (r.is_supervisor ? "supervisor" : "1099"),
  },
  { key: "roster_status", label: "Status", export: (r) => r.roster_status },
  { key: "total_violations", label: "Total Reports" },
  { key: "ncns_count", label: "No-Call/No-Shows" },
  { key: "unreasonable_callouts", label: "Unreasonable Callouts" },
  { key: "reasonable_callouts", label: "Reasonable Callouts" },
  { key: "ip_avg_score_pct", label: "Interior Audit %" },
  { key: "tg_avg_score_pct", label: "Gate Audit %" },
];

/* ========================================================================= */
export default function Users() {
  const navigate = useNavigate();

  /* ----- role for actions ----- */
  const [me, setMe] = useState(null);
  const isManager = String(me?.role || "").toLowerCase() === "manager";
  useEffect(() => {
    (async () => {
      const { data: userResp } = await supabase.auth.getUser();
      const user = userResp?.user;
      if (!user) return;
      const { data: p } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      setMe({ role: p?.role ?? null });
    })();
  }, []);

  /* ----- full-bleed header ----- */
  useEffect(() => {
    const headerEl =
      document.querySelector("header") ||
      document.querySelector("[data-app-header]");
    if (headerEl) headerEl.classList.add("sdg-header-bleed");
    return () => {
      if (headerEl) headerEl.classList.remove("sdg-header-bleed");
    };
  }, []);

  /* ----- detect guards table columns ----- */
  const [guardCols, setGuardCols] = useState({
    hasEmploymentType: false,
    hasIsSupervisor: false,
    hasRosterStatus: false,
    hasStatus: false,
    checked: false,
  });
  useEffect(() => {
    (async () => {
      const hasCol = async (col) => {
        const { error } = await supabase.from("guards").select(col).limit(1);
        return !error;
      };
      const [hasET, hasIS, hasRS, hasS] = await Promise.all([
        hasCol("employment_type"),
        hasCol("is_supervisor"),
        hasCol("roster_status"),
        hasCol("status"),
      ]);
      setGuardCols({
        hasEmploymentType: hasET,
        hasIsSupervisor: hasIS,
        hasRosterStatus: hasRS,
        hasStatus: hasS,
        checked: true,
      });
    })();
  }, []);

  /* ----- state ----- */
  const [rows, setRows] = useState([]);
  const [iaMap, setIaMap] = useState(new Map());
  const [tgMap, setTgMap] = useState(new Map()); // NEW: Truck/Gate fallback
  const [etypeMap, setEtypeMap] = useState(new Map());
  const [ncnsMap, setNcnsMap] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [roleFilter, setRoleFilter] = useState("all");

  /* ----- add modal ----- */
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addRole, setAddRole] = useState("1099");
  const [addStatus, setAddStatus] = useState("active");
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");

  const resetAdd = () => {
    setAddName("");
    setAddRole("1099");
    setAddStatus("active");
    setAddError("");
  };

  /* ----- confirm dialog ----- */
  const [confirm, setConfirm] = useState({
    open: false,
    title: "",
    message: "",
    working: false,
    onConfirm: null,
  });

  /* ----- toast ----- */
  const [toast, setToast] = useState({ open: false, message: "" });
  const showToast = (m) => setToast({ open: true, message: m });

  /* ----- data fetch helpers ----- */
  const fetchNoCallNoShows = useCallback(async (ids) => {
    if (!ids.length) return new Map();
    try {
      const resp = await supabase
        .from("violations")
        .select("guard_id,type")
        .in("guard_id", ids);
      const list = resp?.data || [];
      const isNCNS = (t = "") =>
        /ncns|no[\s_-]*call[\s_-]*no[\s_-]*show/i.test(String(t || ""));
      const m = new Map();
      for (const v of list) {
        if (!isNCNS(v.type)) continue;
        m.set(v.guard_id, (m.get(v.guard_id) || 0) + 1);
      }
      return m;
    } catch {
      return new Map();
    }
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setFetchError(null);

    const resp = await supabase
      .from("guard_stats_v")
      .select("*")
      .order("full_name", { ascending: true });
    const error = resp?.error || null;
    const data = resp?.data || null;

    if (error && !data) {
      setFetchError(error.message || String(error));
      setRows([]);
      setIaMap(new Map());
      setTgMap(new Map());
      setEtypeMap(new Map());
      setNcnsMap(new Map());
      setLoading(false);
      return;
    }

    const list = data || [];
    setRows(list);

    const ids = list.map((r) => r.guard_id).filter(Boolean);
    const [ia, tg, ncns] = await Promise.all([
      fetchInteriorAuditAverages(ids, 30),
      fetchGateAuditAverages(ids, 90), // NEW
      fetchNoCallNoShows(ids),
    ]);
    setIaMap(ia || new Map());
    setTgMap(tg || new Map());
    setNcnsMap(ncns || new Map());

    if (ids.length) {
      let sel = "id";
      if (guardCols.hasEmploymentType) sel += ", employment_type";
      if (guardCols.hasIsSupervisor) sel += ", is_supervisor";
      const gresp = await supabase.from("guards").select(sel).in("id", ids);
      const gdata = gresp?.data || [];
      const m = new Map();
      gdata.forEach((g) =>
        m.set(g.id, {
          employment_type: g.employment_type,
          is_supervisor: g.is_supervisor,
        })
      );
      setEtypeMap(m);
    } else {
      setEtypeMap(new Map());
    }

    setLoading(false);
  }, [
    guardCols.hasEmploymentType,
    guardCols.hasIsSupervisor,
    fetchNoCallNoShows,
  ]);

  useEffect(() => {
    if (guardCols.checked) fetchRows();
  }, [fetchRows, guardCols.checked]);

  /* ----- enrich (apply fallbacks) ----- */
  const enriched = useMemo(() => {
    if (!rows.length) return rows;
    return rows.map((r) => {
      // Interior %: prefer 30-day agg when the view is null/NaN or equals 0 but we have real samples
      const iaFallback = iaMap.get(r.guard_id);
      const useIaFallback =
        r.ip_avg_score_pct == null ||
        Number.isNaN(Number(r.ip_avg_score_pct)) ||
        (Number(r.ip_avg_score_pct) === 0 && (iaFallback?.n ?? 0) > 0);
      const ipAvg = useIaFallback
        ? iaFallback?.avg ?? null
        : r.ip_avg_score_pct;

      // Truck/Gate %: same idea
      const tgFallback = tgMap.get(r.guard_id);
      const useTgFallback =
        r.tg_avg_score_pct == null ||
        Number.isNaN(Number(r.tg_avg_score_pct)) ||
        (Number(r.tg_avg_score_pct) === 0 && (tgFallback?.n ?? 0) > 0);
      const tgAvg = useTgFallback
        ? tgFallback?.avg ?? null
        : r.tg_avg_score_pct;

      // role/status & callouts
      const et = etypeMap.get(r.guard_id) || {};
      const employment_type =
        (guardCols.hasEmploymentType && et.employment_type) ||
        (guardCols.hasIsSupervisor && et.is_supervisor ? "supervisor" : "1099");

      const callouts = Number(r.callouts || 0);
      const dnp = Number(r.docs_not_provided || 0);
      const dp = Number(r.docs_provided || 0);

      return {
        ...r,
        ip_avg_score_pct: ipAvg,
        tg_avg_score_pct: tgAvg,
        employment_type,
        is_supervisor: employment_type === "supervisor",
        ncns_count: ncnsMap.get(r.guard_id) || 0,
        unreasonable_callouts: callouts + dnp,
        reasonable_callouts: dp,
      };
    });
  }, [
    rows,
    iaMap,
    tgMap,
    etypeMap,
    guardCols.hasEmploymentType,
    guardCols.hasIsSupervisor,
    ncnsMap,
  ]);

  /* ----- filter ----- */
  const filtered = useMemo(() => {
    let out = enriched;

    if (statusFilter !== "all") {
      out = out.filter(
        (r) => String(pick(r, "roster_status") || "") === statusFilter
      );
    }
    if (roleFilter === "supervisors") out = out.filter((r) => r.is_supervisor);
    else if (roleFilter === "contractors")
      out = out.filter((r) => !r.is_supervisor);

    if (query.trim()) {
      const v = query.trim().toLowerCase();
      out = out.filter((r) =>
        (pick(r, "full_name") || "").toLowerCase().includes(v)
      );
    }

    return out;
  }, [enriched, statusFilter, roleFilter, query]);

  const activeCount = useMemo(
    () => enriched.filter((r) => String(r.roster_status) === "active").length,
    [enriched]
  );

  /* ----- add person ----- */
  const saveNewGuard = async () => {
    setAddError("");
    if (!addName.trim()) {
      setAddError("Please enter a full name.");
      return;
    }
    if (!isManager) {
      setAddError("Only managers can add people.");
      return;
    }
    setAddSaving(true);
    try {
      const payload = { full_name: addName.trim() };

      // Role → column(s)
      if (guardCols.hasEmploymentType) {
        payload.employment_type =
          addRole === "supervisor" ? "supervisor" : "1099";
      } else if (guardCols.hasIsSupervisor) {
        payload.is_supervisor = addRole === "supervisor";
      }

      // Status → column(s)
      if (guardCols.hasRosterStatus) {
        payload.roster_status = addStatus;
      } else if (guardCols.hasStatus) {
        payload.status = addStatus;
      }

      const { error } = await supabase.from("guards").insert([payload]);
      if (error) throw error;

      setShowAdd(false);
      resetAdd();
      showToast("Person added to roster.");
      fetchRows();
    } catch (e) {
      console.error(e);
      setAddError(e.message || "Could not add guard.");
    } finally {
      setAddSaving(false);
    }
  };

  /* ----- actions ----- */
  const archiveOne = async (r) => {
    const gid = r?.guard_id;
    if (!gid) return;
    if (!isManager) return showToast("Managers only.");
    const { error } = await supabase.rpc("archive_guard", { guard_id: gid });
    if (error) return showToast(error.message || String(error));
    showToast("Marked inactive.");
    fetchRows();
  };

  const askDelete = (r) => {
    const name = r?.full_name || "this guard";
    setConfirm({
      open: true,
      title: "Delete Person",
      message: `Delete ${name}? This only works if they have no violations/audits.`,
      working: false,
      onConfirm: async () => {
        try {
          setConfirm((c) => ({ ...c, working: true }));
          const gid = r?.guard_id;
          const { error } = await supabase.rpc("delete_guard_if_unused", {
            guard_id: gid,
          });
          if (error) throw error;
          setConfirm({
            open: false,
            title: "",
            message: "",
            working: false,
            onConfirm: null,
          });
          showToast("Deleted.");
          fetchRows();
        } catch (e) {
          setConfirm({
            open: false,
            title: "",
            message: "",
            working: false,
            onConfirm: null,
          });
          showToast(
            e.message ||
              "Could not delete. Make sure they have no violations/audits."
          );
        }
      },
    });
  };

  /* --------------------------------- UI ---------------------------------- */
  return (
    <div className="py-8">
      <style>{`
        header.sdg-header-bleed { position: relative; left: 50%; right: 50%; margin-left: -50vw; margin-right: -50vw; width: 100vw; border-radius: 0;
          padding-left: max(env(safe-area-inset-left), 24px); padding-right: max(env(safe-area-inset-right), 24px); }
        header.sdg-header-bleed .container, header.sdg-header-bleed .mx-auto { max-width: none !important; width: 100% !important; }
        .page-full { max-width: 100%; }
        a { color: inherit; }

        select, input[type="text"] { background-color: #ffffff; color: #0f172a; border: 1px solid rgba(0,0,0,.10); }
        .dark select, .dark input[type="text"] { background-color: #151a1e !important; color: #e5e7eb !important; border-color: rgba(255,255,255,.12) !important; }
        select:focus-visible, input[type="text"]:focus-visible { box-shadow: 0 0 0 3px rgba(212,175,55,.25); border-color: rgba(212,175,55,.45); }
        .dark select:focus-visible, .dark input[type="text"]:focus-visible { box-shadow: 0 0 0 3px rgba(212,175,55,.30); border-color: rgba(212,175,55,.55); }

        .card { border-radius: 16px; border: 1px solid rgba(0,0,0,.08); background: #fff; }
        .dark .card { background: #1E2430; border-color: rgba(255,255,255,.10); }
        .accent { height: 6px; border-top-left-radius: 16px; border-top-right-radius: 16px; background: linear-gradient(90deg,#d4af37,#c49a2c); }

        .users-table { width: 100%; font-size: 15px; border-collapse: separate; border-spacing: 0;
          --grid: rgba(15, 23, 42, .08); --gridSoft: rgba(15, 23, 42, .06); }
        .dark .users-table { --grid: rgba(255, 255, 255, .14); --gridSoft: rgba(255, 255, 255, .10); }
        .users-table thead th { background: rgba(0,0,0,.02); border-bottom: 1px solid var(--grid); }
        .dark .users-table thead th { background: rgba(255,255,255,.05); }
        .users-table thead th, .users-table tbody td { padding: 14px 16px; border-right: 1px solid var(--gridSoft); }
        .users-table thead th:last-child, .users-table tbody td:last-child { border-right: 0; }
        .users-table tbody tr { border-bottom: 1px solid var(--grid); }
        .users-table tbody tr:hover { background: rgba(0,0,0,.03); }
        .dark .users-table tbody tr:hover { background: rgba(255,255,255,.06); }

        .users-table .group-row th {
          border-top: 1px solid var(--grid); border-bottom: 1px solid var(--grid);
          font-weight: 800; letter-spacing: .04em; text-transform: uppercase; font-size: 14px;
          background: rgba(212, 175, 55, .10);
        }

        .filter-pills { display: flex; gap: 10px; flex-wrap: wrap; }
        .filter-pills button {
          padding: 10px 16px; border-radius: 9999px; border: 1px solid rgba(0,0,0,.12); background: #fff;
          font-weight: 700; font-size: 14px; transition: transform .04s ease, background .15s ease;
        }
        .filter-pills button:hover { transform: translateY(-1px); }
        .dark .filter-pills button { background: #0f1215; border-color: rgba(255,255,255,.14); color: #e5e7eb; }
        .filter-pills button[aria-pressed="true"] {
          background: linear-gradient(90deg,#d4af37,#c49a2c); color: #111827; border-color: rgba(0,0,0,.18);
        }
        .dark .filter-pills button[aria-pressed="true"] { color: #0b0e11; }
      `}</style>

      <div className="page-full px-4 md:px-6">
        {/* Header card */}
        <div className="card overflow-hidden mb-5">
          <div className="accent" />
          <div className="p-4 md:p-5">
            <div className="flex items-start gap-4 flex-wrap">
              <div>
                <h1 className="font-heading text-2xl">Users</h1>
                <p className="text-sdg-slate">Roster &amp; profiles</p>
                <p className="text-xs text-sdg-slate mt-1">
                  {loading
                    ? "Loading…"
                    : `Fetched ${rows.length} • Showing ${filtered.length} • Active Rosters ${activeCount}`}
                </p>
                {fetchError && (
                  <div className="mt-2 text-[13px] rounded-lg border border-rose-300/40 bg-rose-50/60 px-3 py-2 dark:bg-rose-900/20 dark:border-rose-900/30 text-rose-800 dark:text-rose-200">
                    {fetchError}
                  </div>
                )}
              </div>

              <div className="ml-auto flex items-center gap-2">
                <button
                  className="rounded-md border px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5"
                  onClick={() => {
                    if (!filtered.length) return;
                    const headers = EXPORT_COLUMNS.map((c) => c.label);
                    const data = filtered.map((r) => {
                      const row = {};
                      EXPORT_COLUMNS.forEach((c) => {
                        const raw = c.export ? c.export(r) : r[c.key];
                        row[c.label] =
                          typeof raw === "number" || raw ? raw : "";
                      });
                      return row;
                    });
                    downloadCSV(
                      `users_${new Date().toISOString().slice(0, 10)}.csv`,
                      data,
                      { headers }
                    );
                  }}
                >
                  Export CSV
                </button>

                {isManager && (
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      resetAdd();
                      setShowAdd(true);
                    }}
                  >
                    + Add Person
                  </button>
                )}
              </div>
            </div>

            {/* Search & Filters */}
            <div className="mt-4 grid gap-4 md:grid-cols-12">
              <div className="md:col-span-7">
                <label className="block text-sm font-medium text-sdg-slate mb-1">
                  Search
                </label>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name…"
                  className="w-full rounded-md px-3 py-2"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-sdg-slate mb-1">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full rounded-md px-3 py-2"
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-sdg-slate mb-1">
                  &nbsp;
                </label>
                <button
                  className="rounded-md border px-3 py-2 w-full hover:bg-black/5 dark:hover:bg-white/5"
                  onClick={() => {
                    setQuery("");
                    setStatusFilter("active");
                    setRoleFilter("all");
                  }}
                >
                  Reset filters
                </button>
              </div>

              {/* Big View pills row */}
              <div className="md:col-span-12">
                <label className="block text-sm font-medium text-sdg-slate mb-2">
                  View
                </label>
                <div className="filter-pills">
                  <button
                    onClick={() => setRoleFilter("all")}
                    aria-pressed={roleFilter === "all"}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setRoleFilter("supervisors")}
                    aria-pressed={roleFilter === "supervisors"}
                  >
                    Supervisors
                  </button>
                  <button
                    onClick={() => setRoleFilter("contractors")}
                    aria-pressed={roleFilter === "contractors"}
                  >
                    1099
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="accent" />
          <div className="overflow-x-auto p-0">
            <table className="users-table text-sm">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead>
                <tr className="text-center group-row">
                  <th colSpan={3}>Roster</th>
                  <th colSpan={4}>Activity</th>
                  <th colSpan={2}>Audits</th>
                  <th colSpan={1}>Actions</th>
                </tr>
                <tr className="text-center text-slate-700 dark:text-slate-200">
                  <th className="text-left">Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Total Reports</th>
                  <th>No-Call/No-Shows</th>
                  <th>Unreasonable Callouts</th>
                  <th>Reasonable Callouts</th>
                  <th className="whitespace-nowrap">Interior Audit %</th>
                  <th className="whitespace-nowrap">Gate Audit %</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center">
                      Loading…
                    </td>
                  </tr>
                ) : !filtered.length ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-6 text-center text-sdg-slate"
                    >
                      No users match your filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => {
                    const gid = r.guard_id;
                    const go = () =>
                      gid && navigate(`/hr/users/${encodeURIComponent(gid)}`);
                    return (
                      <tr
                        key={gid || r.full_name}
                        className="text-center cursor-pointer"
                        onClick={go}
                      >
                        <td className="text-left">
                          <div className="flex items-center gap-3">
                            <Avatar name={r.full_name} />
                            <div className="font-medium">
                              {r.full_name || "—"}
                            </div>
                          </div>
                        </td>
                        <td>
                          {r.employment_type === "supervisor" ? (
                            <Badge tone="green">Supervisor</Badge>
                          ) : (
                            <Badge>1099</Badge>
                          )}
                        </td>
                        <td>
                          <Badge
                            tone={
                              String(r.roster_status) === "active"
                                ? "green"
                                : "slate"
                            }
                          >
                            {r.roster_status || "—"}
                          </Badge>
                        </td>
                        <td>{r.total_violations ?? 0}</td>
                        <td>{r.ncns_count ?? 0}</td>
                        <td>{r.unreasonable_callouts ?? 0}</td>
                        <td>{r.reasonable_callouts ?? 0}</td>
                        <td className="whitespace-nowrap">
                          <AuditBar value={r.ip_avg_score_pct} />
                        </td>
                        <td className="whitespace-nowrap">
                          <AuditBar value={r.tg_avg_score_pct} />
                        </td>
                        <td
                          className="text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex gap-2">
                            <button
                              className="rounded-full px-3 py-1 text-[12px] border font-medium bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100"
                              onClick={() => archiveOne(r)}
                            >
                              Inactive
                            </button>
                            <button
                              className="rounded-full px-3 py-1 text-[12px] border font-medium bg-rose-50 text-rose-900 border-rose-300 hover:bg-rose-100"
                              onClick={() => askDelete(r)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="p-4 text-xs text-sdg-slate">
            * Interior Audit shows a 30-day average; Gate uses a 90-day average.
            When the view has no value, these fall back to live aggregates.
          </div>
        </div>
      </div>

      {/* Add Person Modal */}
      <Modal
        open={showAdd}
        onClose={() => {
          if (!addSaving) setShowAdd(false);
        }}
        title="Add Person to Roster"
      >
        <div className="grid gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">
              Full name *
            </label>
            <input
              className="w-full rounded-md px-3 py-2 border border-black/10 dark:border-white/15 bg-white dark:bg-[#0f1215]"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="Jane Doe"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Role *</label>
              <select
                className="w-full rounded-md px-3 py-2 border border-black/10 dark:border-white/15 bg-white dark:bg-[#0f1215]"
                value={addRole}
                onChange={(e) => setAddRole(e.target.value)}
              >
                <option value="1099">1099 Contractor</option>
                <option value="supervisor">Supervisor</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Status *</label>
              <select
                className="w-full rounded-md px-3 py-2 border border-black/10 dark:border-white/15 bg-white dark:bg-[#0f1215]"
                value={addStatus}
                onChange={(e) => setAddStatus(e.target.value)}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          {addError ? (
            <div className="text-sm text-rose-600">{addError}</div>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <button
              className="rounded-md border px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5"
              onClick={() => {
                if (!addSaving) setShowAdd(false);
              }}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={saveNewGuard}
              disabled={addSaving}
            >
              {addSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm Delete */}
      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        working={confirm.working}
        confirmText="Delete"
        onCancel={() =>
          setConfirm({
            open: false,
            title: "",
            message: "",
            working: false,
            onConfirm: null,
          })
        }
        onConfirm={confirm.onConfirm || (() => {})}
      />

      {/* Toast */}
      <Toast
        open={toast.open}
        message={toast.message}
        onClose={() => setToast({ open: false, message: "" })}
      />
    </div>
  );
}
