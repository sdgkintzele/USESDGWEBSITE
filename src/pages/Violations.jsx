// src/pages/Violations.jsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { downloadCSV } from "../lib/csv";

/* ------------------------------ Constants ------------------------------ */
const DEFAULT_PAGE_SIZE = 25;
const REQUIRES_DOCS = new Set(["callout", "early_departure"]);
const STORAGE_KEY = "violations.filters.v3";
const LOCAL_VOID_KEY = "violations.localVoid.v1";
const LOCAL_NOTIFY_KEY = "violations.notifyProgress.v1"; // { [violationId]: { docs?:true, breach?:true } }
const DEFAULT_TZ = "America/New_York";

/* ------------------------------- TZ utils ------------------------------ */
function tzOffsetSuffix(y, m, d, hh = 0, mm = 0, tz = DEFAULT_TZ) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0));
  const parts = dtf.formatToParts(guess);
  const tzn = parts.find((p) => p.type === "timeZoneName")?.value || "GMT+00";
  const mOff = /GMT([+-]\d{1,2})(?::?(\d{2}))?/.exec(tzn);
  const h = mOff ? parseInt(mOff[1], 10) : 0;
  const mins = mOff && mOff[2] ? parseInt(mOff[2], 10) : 0;
  const sign = h > 0 || (h === 0 && mins > 0) ? "+" : h < 0 ? "-" : "+";
  const absH = String(Math.abs(h)).padStart(2, "0");
  const absM = String(mins).padStart(2, "0");
  return `${sign}${absH}:${absM}`;
}
function startOfDayInTZ(dateStr, tz = DEFAULT_TZ) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n || "0", 10));
  return `${dateStr}T00:00:00.000${tzOffsetSuffix(y, m, d, 0, 0, tz)}`;
}
function endOfDayInTZ(dateStr, tz = DEFAULT_TZ) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n || "0", 10));
  return `${dateStr}T23:59:59.999${tzOffsetSuffix(y, m, d, 23, 59, tz)}`;
}

/* quick ranges */
const z2 = (n) => String(n).padStart(2, "0");
const ymd = (d) =>
  `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}`;
const today = () => ymd(new Date());
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
};
const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${z2(d.getMonth() + 1)}-01`;
};

/* ----------------------------- Main screen ----------------------------- */
export default function Violations() {
  /* ------------------------------- Filters ------------------------------- */
  const [search, setSearch] = useState("");
  const [rawSearch, setRawSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [docFilter, setDocFilter] = useState("all");
  const [typeId, setTypeId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sort, setSort] = useState({ key: "occurred_at", dir: "desc" });
  const [params, setParams] = useSearchParams();

  /* full-bleed header */
  useEffect(() => {
    const headerEl =
      document.querySelector("header") ||
      document.querySelector("[data-app-header]");
    if (headerEl) headerEl.classList.add("sdg-header-bleed");
    return () => {
      if (headerEl) headerEl.classList.remove("sdg-header-bleed");
    };
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (typeof saved.search === "string") {
        setSearch(saved.search);
        setRawSearch(saved.search);
      }
      if (typeof saved.status === "string") setStatus(saved.status);
      if (typeof saved.docFilter === "string") setDocFilter(saved.docFilter);
      if (typeof saved.typeId === "string") setTypeId(saved.typeId);
      if (typeof saved.fromDate === "string") setFromDate(saved.fromDate);
      if (typeof saved.toDate === "string") setToDate(saved.toDate);
    } catch {}
    const q = params.get("q");
    const st = params.get("status");
    const df = params.get("docs");
    const ty = params.get("type");
    const pg = params.get("page");
    const ps = params.get("ps");
    const fd = params.get("from");
    const td = params.get("to");
    if (q != null) {
      setRawSearch(q);
      setSearch(q);
    }
    if (st) setStatus(st);
    if (df) setDocFilter(df);
    if (ty) setTypeId(ty);
    if (pg && !Number.isNaN(+pg)) setPage(Math.max(1, +pg));
    if (ps && !Number.isNaN(+ps)) setPageSize(Math.max(1, +ps));
    if (fd) setFromDate(fd);
    if (td) setToDate(td);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ search, status, docFilter, typeId, fromDate, toDate })
      );
    } catch {}
  }, [search, status, docFilter, typeId, fromDate, toDate]);

  useEffect(() => {
    const id = setTimeout(() => setSearch(rawSearch), 250);
    return () => clearTimeout(id);
  }, [rawSearch]);

  useEffect(() => {
    setParams(
      {
        q: search || "",
        status,
        docs: docFilter,
        type: typeId,
        from: fromDate || "",
        to: toDate || "",
        page: String(page),
        ps: String(pageSize),
      },
      { replace: true }
    );
  }, [
    search,
    status,
    docFilter,
    typeId,
    fromDate,
    toDate,
    page,
    pageSize,
    setParams,
  ]);

  /* -------------------------------- Data -------------------------------- */
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [types, setTypes] = useState([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("violation_types")
        .select("id, label, slug")
        .order("label", { ascending: true });
      setTypes(data || []);
    })();
  }, []);

  const [hasVoidColumn, setHasVoidColumn] = useState(null);
  const [localVoids, setLocalVoids] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(LOCAL_VOID_KEY) || "[]"));
    } catch {
      return new Set();
    }
  });
  const saveLocalVoids = (set_) => {
    try {
      localStorage.setItem(LOCAL_VOID_KEY, JSON.stringify([...set_]));
    } catch {}
  };

  // local notify progress (docs/breach) to keep both chips green once sent
  const [progress, setProgress] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_NOTIFY_KEY) || "{}");
    } catch {
      return {};
    }
  });
  const setProgressFor = (id, patch) => {
    setProgress((prev) => {
      const next = { ...prev, [id]: { ...(prev[id] || {}), ...patch } };
      try {
        localStorage.setItem(LOCAL_NOTIFY_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const [me, setMe] = useState(null);
  const isManager = String(me?.role || "").toLowerCase() === "manager";

  useEffect(() => {
    (async () => {
      const { data: userResp } = await supabase.auth.getUser();
      const user = userResp?.user;
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", user.id)
        .single();

      setMe({
        id: user.id,
        full_name: profile?.full_name ?? null,
        role: profile?.role ?? null,
      });
    })();
  }, []);

  /* ----------------------------- Fetch rows ----------------------------- */
  const baseSelect = `
    id, occurred_at, shift, post, lane, status, doc_status, breach_days, eligible_return_date, type_id,
    notification_status, notified_at, notified_to, notified_template,
    guards:guards ( id, full_name, email, contact_email ),
    violation_types:violation_types ( id, label, slug )
  `.trim();

  const fetchRows = useCallback(async () => {
    setLoading(true);

    const tryWithVoided = hasVoidColumn !== false;
    const makeQuery = (withVoided) => {
      const select = withVoided ? `${baseSelect}, voided` : baseSelect;
      let q = supabase
        .from("violations")
        .select(select, { count: "exact" })
        .order("occurred_at", { ascending: false });

      if (status !== "all" && status !== "void") q = q.eq("status", status);

      if (typeId !== "all") {
        const isNumeric = /^\d+$/.test(String(typeId).trim());
        q = q.eq("type_id", isNumeric ? Number(typeId) : String(typeId));
      }

      if (fromDate) q = q.gte("occurred_at", startOfDayInTZ(fromDate));
      if (toDate) q = q.lte("occurred_at", endOfDayInTZ(toDate));

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      return q.range(from, to);
    };

    let data, error, count;

    if (tryWithVoided) {
      const resp = await makeQuery(true);
      data = resp.data;
      error = resp.error;
      count = resp.count;
      if (error && /column .*voided.* does not exist/i.test(error.message)) {
        setHasVoidColumn(false);
        const resp2 = await makeQuery(false);
        data = resp2.data;
        error = resp2.error;
        count = resp2.count;
      } else if (!error) {
        setHasVoidColumn(true);
      }
    } else {
      const resp = await makeQuery(false);
      data = resp.data;
      error = resp.error;
      count = resp.count;
    }

    if (error) {
      console.error(error);
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    let out = data || [];

    if (status === "void") {
      out = out.filter(
        (r) => effectiveStatus(r, hasVoidColumn, localVoids) === "void"
      );
    } else if (status !== "all") {
      out = out.filter(
        (r) => effectiveStatus(r, hasVoidColumn, localVoids) === status
      );
    }

    if (docFilter !== "all") {
      out = out.filter((r) => {
        const requires = REQUIRES_DOCS.has(r.violation_types?.slug || "");
        if (docFilter === "na") return !requires;
        if (!requires) return false;
        if (docFilter === "pending")
          return !r.doc_status || r.doc_status === "pending";
        return r.doc_status === docFilter;
      });
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r) => {
        const guard = r.guards?.full_name?.toLowerCase() || "";
        const typ = r.violation_types?.label?.toLowerCase() || "";
        const post = r.post?.toLowerCase() || "";
        const lane = (r.lane || "").toString().toLowerCase();
        const st = effectiveStatus(r, hasVoidColumn, localVoids).toLowerCase();
        const docs = r.doc_status?.toLowerCase() || "";
        return [guard, typ, post, lane, st, docs].some((s) => s.includes(q));
      });
    }

    setRows(out);
    setTotal(count || 0);
    setLoading(false);
  }, [
    status,
    typeId,
    docFilter,
    search,
    fromDate,
    toDate,
    page,
    pageSize,
    hasVoidColumn,
    localVoids,
  ]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    setPage(1);
  }, [status, docFilter, typeId, search, pageSize, fromDate, toDate]);

  /* ---------------------- Toasts + Sent Popup ---------------------- */
  const [toasts, setToasts] = useState([]);
  const pushToast = useCallback((msg, tone = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((ts) => [...ts, { id, msg, tone }]);
    setTimeout(() => {
      setToasts((ts) => ts.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  // NEW: simple center popup when an email is sent
  const [sentPopup, setSentPopup] = useState(null);

  /* ---------------------- mutations / actions ----------------------- */
  const [savingId, setSavingId] = useState(null);

  const updateCaseStatus = async (row, next) => {
    setSavingId(row.id);
    const { error } = await supabase
      .from("violations")
      .update({ status: next })
      .eq("id", row.id);
    setSavingId(null);
    if (error) return alert(error.message);
    setRows((rs) =>
      rs.map((r) => (r.id === row.id ? { ...r, status: next } : r))
    );
  };

  const setVoid = async (row, makeVoid) => {
    if (hasVoidColumn) {
      setSavingId(row.id);
      const { error } = await supabase
        .from("violations")
        .update({ voided: !!makeVoid })
        .eq("id", row.id);
      setSavingId(null);
      if (error) {
        alert(error.message);
        return;
      }
      setRows((rs) =>
        rs.map((r) => (r.id === row.id ? { ...r, voided: !!makeVoid } : r))
      );
      return;
    }
    setLocalVoids((prev) => {
      const next = new Set(prev);
      if (makeVoid) next.add(row.id);
      else next.delete(row.id);
      saveLocalVoids(next);
      return next;
    });
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r } : r)));
  };

  // --- main notifier used by the wizard (now supports 'generic' too)
  const notifyGuard = async (row, kind /* 'docs' | 'breach' | 'generic' */) => {
    if (!isManager) {
      pushToast("Managers only.", "error");
      return;
    }

    const guardEmail = row?.guards?.email || row?.guards?.contact_email || null;
    if (!guardEmail) {
      pushToast("No email on file for this guard.", "error");
      return;
    }

    setSavingId(row.id);
    // We keep the API simple (the edge function can infer from type/status).
    // If your function accepts a hint, include { template: kind }.
    const { data, error } = await supabase.functions.invoke(
      "send-violation-email",
      { body: { id: row.id, template: kind } }
    );
    setSavingId(null);

    if (error || !data?.ok) {
      const msg =
        data?.error || error?.message || "Failed to send notification.";
      pushToast(msg, "error");
      return;
    }

    // success feedback
    pushToast("Notification email sent.");
    setSentPopup("Notification email sent.");
    setTimeout(() => setSentPopup(null), 1500);

    if (kind === "docs") setProgressFor(row.id, { docs: true });
    if (kind === "breach") setProgressFor(row.id, { breach: true });

    // refresh the row
    const { data: fresh } = await supabase
      .from("violations")
      .select(
        `
        id, occurred_at, shift, post, lane, status, doc_status, breach_days, eligible_return_date, type_id,
        notification_status, notified_at, notified_to, notified_template,
        guards:guards ( id, full_name, email, contact_email ),
        violation_types:violation_types ( id, label, slug )
      `
      )
      .eq("id", row.id)
      .single();

    if (fresh) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? fresh : r)));
    }
  };

  /* ------------------------------ Export ------------------------------ */
  const exportCSV = () => {
    if (!rows.length) return;
    const items = rows.map((r) => ({
      occurred_at: new Date(r.occurred_at).toLocaleString(),
      guard: r.guards?.full_name ?? "",
      type: r.violation_types?.label ?? "",
      post: r.lane ? `${r.post ?? ""} • lane ${r.lane}` : r.post ?? "",
      shift: r.shift ?? "",
      status: effectiveStatus(r, hasVoidColumn, localVoids),
      docs: REQUIRES_DOCS.has(r.violation_types?.slug || "")
        ? r.doc_status ?? "pending"
        : "N/A",
      breach_days: r.breach_days ?? "",
      eligible_return_date: r.eligible_return_date ?? "",
      id: r.id,
    }));
    downloadCSV(
      `violations_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`,
      items
    );
  };

  /* ---------------------- Wizard modal state ---------------------- */
  const [wizard, setWizard] = useState({
    open: false,
    row: null,
    eff: "open",
  });
  const openWizard = (row) =>
    setWizard({
      open: true,
      row,
      eff: effectiveStatus(row, hasVoidColumn, localVoids),
    });
  const closeWizard = () =>
    setWizard({
      open: false,
      row: null,
      eff: "open",
    });
  const sendFromWizard = async (kind) => {
    if (!wizard?.row) return;
    await notifyGuard(wizard.row, kind);
    closeWizard();
  };

  /* -------------------------------- UI -------------------------------- */
  const tableHeight = "max-h-[84vh]";

  const applyQuickRange = (key) => {
    const t = today();
    if (key === "today") {
      setFromDate(t);
      setToDate(t);
    } else if (key === "7d") {
      setFromDate(daysAgo(6));
      setToDate(t);
    } else if (key === "30d") {
      setFromDate(daysAgo(29));
      setToDate(t);
    } else if (key === "90d") {
      setFromDate(daysAgo(89));
      setToDate(t);
    } else if (key === "mtd") {
      setFromDate(monthStart());
      setToDate(t);
    } else if (key === "clear") {
      setFromDate("");
      setToDate("");
    }
    setPage(1);
  };

  return (
    <div className="py-8">
      <style>{`
        /* header bleed */
        header.sdg-header-bleed{
          position:relative; left:50%; right:50%;
          margin-left:-50vw; margin-right:-50vw; width:100vw;
          border-radius:0; padding-left:max(env(safe-area-inset-left),24px); padding-right:max(env(safe-area-inset-right),24px);
        }
        header.sdg-header-bleed .container,
        header.sdg-header-bleed .mx-auto,
        header.sdg-header-bleed [class*="max-w-"]{ max-width:none !important; width:100% !important; }

        select, input[type="text"], input[type="date"] { background-color: #ffffff; color: #0f172a; }
        option { color: #0f172a; background-color: #ffffff; }
        .dark select, .dark input[type="text"], .dark input[type="date"] { background-color: #151a1e !important; color: #e5e7eb !important; border-color: rgba(255,255,255,0.12) !important; }
        .dark option { color: #e5e7eb !important; background-color: #0f1215 !important; }

        .table-clean th, .table-clean td { text-align:center; vertical-align:middle; padding:.75rem .9rem; white-space:nowrap; }
        .table-clean thead th { background: rgba(255,255,255,.90); font-weight:700; text-transform:uppercase; letter-spacing:.03em; border-bottom:1px solid rgba(15,23,42,.08); }
        .dark .table-clean thead th { background: rgba(15,18,21,.90); border-bottom-color: rgba(255,255,255,.12); }
        .table-clean tbody tr { border-bottom: 1px solid rgba(15,23,42,.06); }
        .dark .table-clean tbody tr { border-bottom-color: rgba(255,255,255,.10); }

        /* Pills / buttons */
        .btn-pill{ border-radius: .65rem; border-width:1px; padding:.42rem .7rem; font-size:12px; font-weight:600; }
        .btn-ghost{ border:1px solid rgba(15,23,42,.12); }
        .btn-green{ background:#ecfdf5; color:#065f46; border-color:#a7f3d0; }
        .btn-green:hover{ background:#d1fae5; }
        .btn-orange{ background:#fff7ed; color:#9a3412; border-color:#fed7aa; }
        .btn-orange:hover{ background:#ffedd5; }
        .btn-red{ background:#fff1f2; color:#9f1239; border-color:#fecdd3; }
        .btn-red:hover{ background:#ffe4e6; }

        /* Modal / wizard base */
        .overlay{ position:fixed; inset:0; background:rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; z-index:60; }
        .modal{ background:#fff; color:#0f172a; width:min(720px, 94vw); border-radius:16px; box-shadow:0 15px 60px rgba(0,0,0,.25); overflow:hidden; }
        .modal-head{ padding:16px 20px; border-bottom:1px solid rgba(15,23,42,.08); background:linear-gradient(#fef3c7 4px, transparent 4px) top/100% 8px no-repeat; }
        .modal-title{ font-size:18px; font-weight:800; letter-spacing:.01em; }
        .modal-sub{ font-size:12px; color:#6b7280; margin-top:2px; }
        .modal-body{ padding:18px 20px; font-size:14px; line-height:1.45; }
        .modal-row{ margin:.25rem 0; }
        .modal-foot{ padding:12px 20px; display:flex; justify-content:flex-end; gap:10px; border-top:1px solid rgba(15,23,42,.08); }

        /* Wizard cards */
        .wiz-card{ border:1px solid rgba(15,23,42,.12); border-radius:12px; padding:12px; background:#fff; transition:box-shadow .12s, border-color .12s; }
        .wiz-card:hover{ box-shadow:0 6px 18px rgba(0,0,0,.06); border-color:rgba(15,23,42,.18); }
        .wiz-card.disabled{ opacity:.5; pointer-events:none; }
        .wiz-head{ display:flex; align-items:center; gap:10px; font-weight:700; }
        .wiz-note{ font-size:12px; color:#6b7280; margin-left:28px; }
        .wiz-done{ font-size:12px; padding:.1rem .5rem; border-radius:9999px; border:1px solid #a7f3d0; background:#ecfdf5; color:#065f46; }
      `}</style>

      <div className="mx-auto max-w-none px-4 md:px-6">
        <header className="mb-4">
          <h1 className="font-heading text-2xl md:text-3xl">Violation Data</h1>
          <p className="text-sdg-slate mt-1">
            Browse, filter, and manage recorded violations.
          </p>
        </header>

        {/* Controls / SEARCH + filters */}
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-xs font-semibold mb-1">Search</label>
            <input
              type="text"
              className="w-full h-9 rounded border px-3 text-sm"
              placeholder="Search name, type, post, status…"
              value={rawSearch}
              onChange={(e) => setRawSearch(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">Status</label>
            <select
              className="h-9 rounded border px-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="void">Void</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">Docs</label>
            <select
              className="h-9 rounded border px-2 text-sm"
              value={docFilter}
              onChange={(e) => setDocFilter(e.target.value)}
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="provided">Provided</option>
              <option value="not_provided">Not Provided</option>
              <option value="na">N/A</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">Type</label>
            <select
              className="h-9 rounded border px-2 text-sm"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
            >
              <option value="all">All</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">From</label>
            <input
              type="date"
              className="h-9 rounded border px-2 text-sm"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">To</label>
            <input
              type="date"
              className="h-9 rounded border px-2 text-sm"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-1">
            <button
              className="btn-pill btn-ghost"
              onClick={() => applyQuickRange("today")}
            >
              Today
            </button>
            <button
              className="btn-pill btn-ghost"
              onClick={() => applyQuickRange("7d")}
            >
              7d
            </button>
            <button
              className="btn-pill btn-ghost"
              onClick={() => applyQuickRange("30d")}
            >
              30d
            </button>
            <button
              className="btn-pill btn-ghost"
              onClick={() => applyQuickRange("mtd")}
            >
              MTD
            </button>
            <button
              className="btn-pill btn-ghost"
              onClick={() => applyQuickRange("clear")}
            >
              Clear
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <label className="block text-xs font-semibold mb-1">
              Page size
            </label>
            <select
              className="h-9 rounded border px-2 text-sm"
              value={pageSize}
              onChange={(e) => setPageSize(Math.max(1, +e.target.value))}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button className="btn-pill btn-ghost" onClick={exportCSV}>
              Export CSV
            </button>
          </div>
        </div>

        {/* Table */}
        <section className="frame overflow-hidden" aria-label="Violation table">
          <div className="frame-accent" />
          <div className="p-0">
            <div className={`overflow-y-auto ${tableHeight}`}>
              <table className="min-w-full table-fixed table-clean">
                <colgroup>
                  <col className="w-[12%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[20%]" />
                  <col className="w-[10%]" />
                  <col className="w-[9%]" />
                  <col className="w-[13%]" />
                  <col className="w-[10%]" /> {/* Steps */}
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                </colgroup>

                <thead className="sticky top-0 z-10">
                  <tr>
                    <SortableTh
                      label="Date"
                      active={sort.key === "occurred_at"}
                      dir={sort.dir}
                      onClick={() =>
                        setSort((s) => ({
                          key: "occurred_at",
                          dir:
                            s.key === "occurred_at" && s.dir === "asc"
                              ? "desc"
                              : "asc",
                        }))
                      }
                    />
                    <SortableTh
                      className="border-l border-black/5 dark:border-white/10"
                      label="Guard"
                      active={sort.key === "guard"}
                      dir={sort.dir}
                      onClick={() =>
                        setSort((s) => ({
                          key: "guard",
                          dir:
                            s.key === "guard" && s.dir === "asc"
                              ? "desc"
                              : "asc",
                        }))
                      }
                    />
                    <SortableTh
                      className="border-l border-black/5 dark:border-white/10"
                      label="Type"
                      active={sort.key === "type"}
                      dir={sort.dir}
                      onClick={() =>
                        setSort((s) => ({
                          key: "type",
                          dir:
                            s.key === "type" && s.dir === "asc"
                              ? "desc"
                              : "asc",
                        }))
                      }
                    />
                    <SortableTh
                      className="border-l border-black/5 dark:border-white/10"
                      label="Post/Lane"
                      active={sort.key === "post"}
                      dir={sort.dir}
                      onClick={() =>
                        setSort((s) => ({
                          key: "post",
                          dir:
                            s.key === "post" && s.dir === "asc"
                              ? "desc"
                              : "asc",
                        }))
                      }
                    />
                    <SortableTh
                      className="border-l border-black/5 dark:border-white/10"
                      label="Documentation"
                      active={sort.key === "docs"}
                      dir={sort.dir}
                      onClick={() =>
                        setSort((s) => ({
                          key: "docs",
                          dir:
                            s.key === "docs" && s.dir === "asc"
                              ? "desc"
                              : "asc",
                        }))
                      }
                    />
                    <SortableTh
                      className="border-l border-black/5 dark:border-white/10"
                      label="Status"
                      active={sort.key === "status"}
                      dir={sort.dir}
                      onClick={() =>
                        setSort((s) => ({
                          key: "status",
                          dir:
                            s.key === "status" && s.dir === "asc"
                              ? "desc"
                              : "asc",
                        }))
                      }
                    />
                    <Th className="border-l border-black/5 dark:border-white/10">
                      Breach / Return
                    </Th>
                    <Th className="border-l border-black/5 dark:border-white/10">
                      Steps
                    </Th>
                    <Th className="border-l border-black/5 dark:border-white/10">
                      Actions
                    </Th>
                    <Th className="border-l border-black/5 dark:border-white/10">
                      Notification Center
                    </Th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-black/5 dark:divide-white/10">
                  {loading ? (
                    <tr>
                      <td
                        colSpan={10}
                        className="p-4 text-sdg-slate text-center"
                      >
                        Loading…
                      </td>
                    </tr>
                  ) : !rows.length ? (
                    <tr>
                      <td
                        colSpan={10}
                        className="p-6 text-sdg-slate text-center"
                      >
                        No violations match your filters.
                      </td>
                    </tr>
                  ) : (
                    rows
                      .slice()
                      .sort((a, b) => {
                        const { key, dir } = sort;
                        const cmp = (A, B) =>
                          (A > B ? 1 : A < B ? -1 : 0) *
                          (dir === "asc" ? 1 : -1);
                        if (key === "occurred_at")
                          return cmp(
                            +new Date(a.occurred_at),
                            +new Date(b.occurred_at)
                          );
                        if (key === "guard")
                          return cmp(
                            (a.guards?.full_name || "").toLowerCase(),
                            (b.guards?.full_name || "").toLowerCase()
                          );
                        if (key === "type")
                          return cmp(
                            (a.violation_types?.label || "").toLowerCase(),
                            (b.violation_types?.label || "").toLowerCase()
                          );
                        if (key === "post") {
                          const A = `${a.post || ""}${
                            a.lane ? ` • ${a.lane}` : ""
                          }`.toLowerCase();
                          const B = `${b.post || ""}${
                            b.lane ? ` • ${b.lane}` : ""
                          }`.toLowerCase();
                          return cmp(A, B);
                        }
                        if (key === "status") {
                          const A = effectiveStatus(
                            a,
                            hasVoidColumn,
                            localVoids
                          );
                          const B = effectiveStatus(
                            b,
                            hasVoidColumn,
                            localVoids
                          );
                          return cmp(A, B);
                        }
                        if (key === "docs") {
                          const norm = (r) =>
                            REQUIRES_DOCS.has(r.violation_types?.slug || "")
                              ? (r.doc_status || "pending").toLowerCase()
                              : "zzz_na";
                          return cmp(norm(a), norm(b));
                        }
                        return 0;
                      })
                      .map((r, idx) => {
                        const requires = REQUIRES_DOCS.has(
                          r.violation_types?.slug || ""
                        );
                        const effStatus = effectiveStatus(
                          r,
                          hasVoidColumn,
                          localVoids
                        );
                        const profileHref = r.guards?.id
                          ? `/hr/users/${r.guards.id}`
                          : `/hr/users?q=${encodeURIComponent(
                              r.guards?.full_name || ""
                            )}`;

                        return (
                          <tr
                            key={r.id}
                            className={`${
                              idx % 2 === 0
                                ? "bg-black/[.015] dark:bg-white/[.03]"
                                : ""
                            }`}
                          >
                            <Td
                              title={`ID: ${r.id}`}
                              className="whitespace-nowrap"
                            >
                              {new Date(r.occurred_at).toLocaleString()}
                            </Td>

                            <Td className="border-l border-black/5 dark:border-white/10 truncate">
                              <Link
                                to={profileHref}
                                className="underline decoration-dotted underline-offset-[3px] hover:decoration-solid"
                                title="Open guard profile"
                              >
                                <Highlight
                                  text={r.guards?.full_name}
                                  term={search}
                                />
                              </Link>
                            </Td>

                            <Td className="border-l border-black/5 dark:border-white/10 truncate">
                              <Highlight
                                text={r.violation_types?.label}
                                term={search}
                              />
                            </Td>

                            <Td
                              className="border-l border-black/5 dark:border-white/10"
                              title={`${r.post || "—"}${
                                r.lane ? ` • Lane ${r.lane}` : ""
                              } • Shift: ${cap(r.shift)}`}
                            >
                              <div className="truncate mx-auto max-w-[22ch]">
                                <Highlight
                                  text={`${r.post || "—"}${
                                    r.lane ? ` • ${r.lane}` : ""
                                  }`}
                                  term={search}
                                />
                              </div>
                              <span className="cell-sub">
                                Shift: {cap(r.shift)}
                              </span>
                            </Td>

                            <Td className="border-l border-black/5 dark:border-white/10">
                              {requires ? (
                                <Badge
                                  tone={
                                    r.doc_status === "provided"
                                      ? "green"
                                      : r.doc_status === "not_provided"
                                      ? "red"
                                      : "slate"
                                  }
                                >
                                  {cap(r.doc_status ?? "pending")}
                                </Badge>
                              ) : (
                                <span className="text-sdg-slate">N/A</span>
                              )}
                            </Td>

                            <Td className="border-l border-black/5 dark:border-white/10">
                              <Badge
                                tone={
                                  effStatus === "open"
                                    ? "amber"
                                    : effStatus === "closed"
                                    ? "green"
                                    : "slate"
                                }
                              >
                                {cap(effStatus)}
                              </Badge>
                            </Td>

                            <Td className="border-l border-black/5 dark:border-white/10">
                              <BreachCell
                                days={r.breach_days}
                                returnDate={r.eligible_return_date}
                              />
                            </Td>

                            {/* Steps checklist column (only for types with breach periods) */}
                            <Td className="border-l border-black/5 dark:border-white/10">
                              <StepChecklistCell row={r} progress={progress} />
                            </Td>

                            <Td className="border-l border-black/5 dark:border-white/10">
                              <div className="inline-flex items-center gap-2">
                                <Link
                                  to={profileHref}
                                  className="btn-pill btn-ghost"
                                  title="Open guard profile"
                                >
                                  Profile
                                </Link>

                                {isManager && (
                                  <>
                                    {effStatus === "open" && (
                                      <>
                                        <button
                                          className="btn-pill btn-green"
                                          disabled={savingId === r.id}
                                          onClick={() =>
                                            updateCaseStatus(r, "closed")
                                          }
                                          title="Mark case as closed"
                                        >
                                          ✓ Report Closed
                                        </button>
                                        <button
                                          className="btn-pill btn-red"
                                          disabled={savingId === r.id}
                                          onClick={() => setVoid(r, true)}
                                          title="Void this violation"
                                        >
                                          Void
                                        </button>
                                      </>
                                    )}

                                    {effStatus === "closed" && (
                                      <>
                                        <button
                                          className="btn-pill btn-orange"
                                          disabled={savingId === r.id}
                                          onClick={() =>
                                            updateCaseStatus(r, "open")
                                          }
                                          title="Reopen case"
                                        >
                                          Reopen Case
                                        </button>
                                        <button
                                          className="btn-pill btn-red"
                                          disabled={savingId === r.id}
                                          onClick={() => setVoid(r, true)}
                                          title="Void this violation"
                                        >
                                          Void
                                        </button>
                                      </>
                                    )}

                                    {effStatus === "void" && (
                                      <button
                                        className="btn-pill btn-orange"
                                        disabled={savingId === r.id}
                                        onClick={() => setVoid(r, false)}
                                        title="Unvoid by reopening"
                                      >
                                        Reopen Case
                                      </button>
                                    )}
                                  </>
                                )}

                                <Link
                                  to={`/hr/violations/${r.id}`}
                                  className="btn-pill btn-ghost"
                                  title="View details"
                                >
                                  View
                                </Link>
                              </div>
                            </Td>

                            {/* Notification Center — ONE button only */}
                            <Td className="border-l border-black/5 dark:border-white/10">
                              <NotifyCell row={r} onOpenWizard={openWizard} />
                            </Td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-3 flex items-center justify-between border-t border-black/5 dark:border-white/10">
              <div className="text-sm text-sdg-slate">
                Page {page} of {Math.max(1, Math.ceil((total || 0) / pageSize))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-ghost"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                >
                  ‹ Prev
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={loading || rows.length < pageSize}
                >
                  Next ›
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Notification Center (wizard) */}
      <NotifyWizardModal
        open={wizard.open}
        row={wizard.row}
        effStatus={wizard.eff}
        onCancel={closeWizard}
        onSend={sendFromWizard}
      />

      {/* Sent confirmation popup */}
      <SentPopup message={sentPopup} onClose={() => setSentPopup(null)} />

      {/* Toasts */}
      <ToastStack toasts={toasts} />
    </div>
  );
}

/* -------------------------- Helpers & subcomponents -------------------------- */
function effectiveStatus(row, hasVoidColumn, localVoids) {
  const v = hasVoidColumn ? !!row.voided : localVoids.has(row.id);
  return v ? "void" : row.status || "open";
}

function Th({ children, className = "", ...rest }) {
  return (
    <th
      {...rest}
      className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-center ${className}`}
    >
      {children}
    </th>
  );
}
function SortableTh({ label, active, dir, onClick, className = "" }) {
  return (
    <Th className={`cursor-pointer select-none ${className}`} onClick={onClick}>
      <span className="inline-flex items-center justify-center gap-1 w-full">
        {label}
        {active ? (
          <span>{dir === "asc" ? "▲" : "▼"}</span>
        ) : (
          <span className="opacity-40">↕</span>
        )}
      </span>
    </Th>
  );
}
function Td({ children, className = "", title }) {
  return (
    <td
      className={`px-3 py-3 align-middle text-center ${className}`}
      title={title}
    >
      {children}
    </td>
  );
}

function Badge({ tone = "slate", className = "", children }) {
  const theme =
    tone === "green"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200 border-green-200/70 dark:border-green-700/40"
      : tone === "red"
      ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200 border-red-200/70 dark:border-red-700/40"
      : tone === "amber"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 border-amber-200/70 dark:border-amber-700/40"
      : "bg-black/5 text-black/80 dark:bg-white/10 dark:text-white/80 border-black/10 dark:border-white/10";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] ${className} ${theme}`}
    >
      {children}
    </span>
  );
}
function cap(s) {
  return String(s ?? "")
    .replace(/_/g, " ")
    .replace(/^\w/, (m) => m.toUpperCase());
}
function fmtDate(d) {
  try {
    return new Date(d).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return d ?? "";
  }
}
function BreachCell({ days, returnDate }) {
  if (days == null) return <span className="text-sdg-slate">—</span>;
  let tone = "green";
  if (days >= 3) tone = "red";
  else if (days >= 1) tone = "amber";
  const isToday =
    returnDate &&
    new Date(returnDate).toDateString() === new Date().toDateString();
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white/60 px-2.5 py-1.5 dark:border-white/10 dark:bg-white/5 ${
        isToday ? "ring-1 ring-emerald-300" : ""
      }`}
      title={returnDate ? `Eligible return: ${fmtDate(returnDate)}` : undefined}
    >
      <Badge tone={tone} className="justify-center min-w-[70px]">
        {days} day(s)
      </Badge>
      {returnDate ? (
        <div className="text-xs leading-tight text-sdg-slate text-left">
          <div className="uppercase tracking-wide flex items-center gap-1">
            <span>Return</span>
            {isToday && (
              <span className="rounded-full bg-emerald-100 text-emerald-800 px-1.5 py-[1px]">
                Today
              </span>
            )}
          </div>
          <div className="font-medium">{fmtDate(returnDate)}</div>
        </div>
      ) : (
        <div className="text-xs text-sdg-slate">—</div>
      )}
    </div>
  );
}
function Highlight({ text, term }) {
  const value = String(text ?? "");
  const q = String(term ?? "").trim();
  if (!q) return <>{value}</>;
  const lower = value.toLowerCase();
  const t = q.toLowerCase();
  const parts = [];
  let i = 0;
  while (true) {
    const idx = lower.indexOf(t, i);
    if (idx === -1) {
      parts.push(value.slice(i));
      break;
    }
    if (idx > i) parts.push(value.slice(i, idx));
    parts.push(
      <mark
        key={`${idx}-${i}`}
        className="rounded px-0.5 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
      >
        {value.slice(idx, idx + t.length)}
      </mark>
    );
    i = idx + t.length;
  }
  return <>{parts}</>;
}

/* ---- Steps checklist (only for types with breach periods) ---- */
function StepChecklistCell({ row, progress }) {
  const rawSlug = (
    row?.violation_types?.slug ||
    row?.violation_types?.label ||
    ""
  ).toLowerCase();
  const isNCNS = /^(no[_-]?call[_-]?no[_-]?show|ncns)$/.test(rawSlug);
  const isEarly = rawSlug.includes("early");
  const isDocsType = rawSlug === "callout" || isEarly; // callout | early_departure
  const hasBreach = isDocsType || isNCNS;

  if (!hasBreach) return <span className="text-sdg-slate">N/A</span>;

  const sent = row.notification_status === "sent";
  const docsProvided = isDocsType && row.doc_status === "provided";

  const tmpl = String(row?.notified_template || "").toLowerCase();
  const docsRequestLast = /doc|request/.test(tmpl);
  const breachLast =
    /(breach|3[- ]?day|5[- ]?day|1[- ]?day|no[-_ ]?breach)/i.test(tmpl);

  const lp = progress?.[row.id] || {};
  const docsDone = !!lp.docs || (sent && docsRequestLast) || !!docsProvided;
  const breachDone = !!lp.breach || (sent && breachLast);

  return (
    <div className="flex items-center justify-center gap-1">
      {isDocsType && (
        <Badge tone={docsDone ? "green" : "slate"}>
          {docsDone ? "✓ Documentation" : "• Documentation"}
        </Badge>
      )}
      <Badge tone={breachDone ? "green" : "slate"}>
        {breachDone ? "✓ Breach" : "• Breach"}
      </Badge>
    </div>
  );
}

/* ---- Notification Center (Wizard) ---- */
function NotifyWizardModal({ open, row, effStatus, onCancel, onSend }) {
  const overlayRef = useRef(null);
  const [sel, setSel] = useState("docs"); // "docs" | "breach" | "generic"

  useEffect(() => {
    // default selection based on type
    const rawSlug = (
      row?.violation_types?.slug ||
      row?.violation_types?.label ||
      ""
    ).toLowerCase();
    const isNCNS = /^(no[_-]?call[_-]?no[_-]?show|ncns)$/.test(rawSlug);
    const isEarly = rawSlug.includes("early");
    const isDocsType = rawSlug === "callout" || isEarly;
    const isGeneric = !(isDocsType || isNCNS);
    const docsPending =
      isDocsType && (!row?.doc_status || row?.doc_status === "pending");
    if (isGeneric) setSel("generic");
    else setSel(docsPending ? "docs" : "breach");
  }, [row]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onCancel?.();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || !row) return null;

  const guardEmail = row?.guards?.email || row?.guards?.contact_email || "";

  const rawSlug = (
    row?.violation_types?.slug ||
    row?.violation_types?.label ||
    ""
  ).toLowerCase();
  const isNCNS = /^(no[_-]?call[_-]?no[_-]?show|ncns)$/.test(rawSlug);
  const isEarly = rawSlug.includes("early");
  const isDocsType = rawSlug === "callout" || isEarly;
  const isGeneric = !(isDocsType || isNCNS); // everything else

  const docsPending =
    isDocsType && (!row?.doc_status || row?.doc_status === "pending");
  const docsMissing = isDocsType && row?.doc_status === "not_provided";
  const docsProvided = isDocsType && row?.doc_status === "provided";

  // availability
  const canSendDocs = !!guardEmail && isDocsType && docsPending; // allowed while OPEN
  const canSendBreach =
    !!guardEmail &&
    ((isDocsType && docsMissing) || isNCNS) &&
    effStatus === "closed";
  const canSendGeneric = !!guardEmail && isGeneric; // generic notice for all other types

  // labels
  const breachLabel = isDocsType
    ? isEarly
      ? "Send 1-Day Breach"
      : "Send 3-Day Breach"
    : isNCNS
    ? "Send 5-Day Breach"
    : "Send Breach";

  return (
    <div
      className="overlay"
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onCancel?.();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">Notification Center</div>
          <div className="modal-sub">Choose one of the actions below.</div>
        </div>
        <div className="modal-body">
          <div className="modal-row">
            <strong>Guard:</strong> {row.guards?.full_name || "—"}
          </div>
          <div className="modal-row">
            <strong>Type:</strong> {row.violation_types?.label || "—"}
          </div>
          <div className="modal-row">
            <strong>To:</strong> {guardEmail || "—"}
          </div>
          <div className="h-3" />

          {/* Generic Violation Notice (for all non-docs / non-NCNS types) */}
          {isGeneric && (
            <>
              <div
                className={`wiz-card ${!canSendGeneric ? "disabled" : ""}`}
                onClick={() => canSendGeneric && setSel("generic")}
                role="button"
              >
                <div className="wiz-head">
                  <input type="checkbox" checked={sel === "generic"} readOnly />
                  <span>Send Violation Notice</span>
                </div>
                <div className="wiz-note">
                  Sends the standard violation notification to the guard.
                </div>
              </div>
              <div className="h-2" />
            </>
          )}

          {/* Request Documentation (only for docs types) */}
          {isDocsType && (
            <div
              className={`wiz-card ${!canSendDocs ? "disabled" : ""}`}
              onClick={() => canSendDocs && setSel("docs")}
              role="button"
            >
              <div className="wiz-head">
                <input type="checkbox" checked={sel === "docs"} readOnly />
                <span>Request Documentation</span>
                {docsProvided && <span className="wiz-done">✓ Provided</span>}
              </div>
              <div className="wiz-note">
                Sends a documentation request (allowed while OPEN).
              </div>
            </div>
          )}

          {isDocsType && <div className="h-2" />}

          {/* Breach Notice (3/1/5-day depending on type) */}
          {(isDocsType || isNCNS) && (
            <div
              className={`wiz-card ${!canSendBreach ? "disabled" : ""}`}
              onClick={() => canSendBreach && setSel("breach")}
              role="button"
            >
              <div className="wiz-head">
                <input type="checkbox" checked={sel === "breach"} readOnly />
                <span>{breachLabel}</span>
              </div>
              <div className="wiz-note">
                Requires the report to be <strong>CLOSED</strong>
                {isDocsType && " and documentation marked Not Provided."}
              </div>
            </div>
          )}

          {/* If none of the above were shown (shouldn't happen), provide context */}
          {!isGeneric && !isDocsType && !isNCNS && (
            <div className="text-sdg-slate text-sm">
              No actions are configured for this violation type.
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn-pill btn-ghost" onClick={onCancel}>
            Close
          </button>
          <button
            className="btn-pill btn-green"
            onClick={() => onSend?.(sel)}
            disabled={
              (sel === "docs" && !canSendDocs) ||
              (sel === "breach" && !canSendBreach) ||
              (sel === "generic" && !canSendGeneric)
            }
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Notification Center cell (single button only) ---- */
function NotifyCell({ row, onOpenWizard }) {
  return (
    <div className="flex items-center justify-center">
      <button
        className="btn-pill btn-green"
        title="Open Notification Center"
        onClick={() => onOpenWizard?.(row)}
      >
        Notification Center
      </button>
    </div>
  );
}

/* ---- Sent popup (center confirmation) ---- */
function SentPopup({ message, onClose }) {
  if (!message) return null;
  return (
    <div className="fixed inset-0 z-[90]">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/35" onClick={onClose} />
      {/* card */}
      <div className="relative h-full w-full flex items-center justify-center p-4">
        <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#0f1215] shadow-2xl px-6 py-5 text-center max-w-sm w-full">
          <div className="text-base font-semibold">Notification sent</div>
          <div className="text-sdg-slate mt-1">{message}</div>
          <button className="btn-pill btn-green mt-3" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Toasts ---- */
function ToastStack({ toasts }) {
  if (!toasts?.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[80] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded-xl border px-3 py-2 shadow-lg text-sm ${
            t.tone === "error"
              ? "bg-rose-50 border-rose-200 text-rose-900"
              : "bg-emerald-50 border-emerald-200 text-emerald-900"
          }`}
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ NOTES ------------------------------
To persist step-tracking org-wide (instead of per-browser), add columns:

ALTER TABLE violations
  ADD COLUMN IF NOT EXISTS docs_notice_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS breach_notice_sent_at timestamptz;

…and set them inside your email edge function. Then, read them here and
replace the localStorage fallback used in `progress`.
--------------------------------------------------------------------- */
