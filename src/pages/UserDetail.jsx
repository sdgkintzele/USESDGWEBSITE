// src/pages/UserDetail.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import {
  fetchInteriorAuditAverages,
  fetchGateAuditAverages,
} from "../lib/audits";

/* =================== Small UI helpers (Frame + Metric) =================== */
function Frame({ title, actions, children, accent = true }) {
  return (
    <section className="frame overflow-hidden h-full flex flex-col rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1E2430]">
      {accent && (
        <div
          className="h-1.5"
          style={{ background: "linear-gradient(90deg,#d4af37,#c49a2c)" }}
        />
      )}
      <div className="flex-1 p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          {title ? (
            <h2 className="font-heading text-lg md:text-xl">{title}</h2>
          ) : (
            <span />
          )}
          {actions ? (
            <div className="flex items-center gap-2">{actions}</div>
          ) : null}
        </div>
        {children}
      </div>
    </section>
  );
}

function Metric({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#141a24] p-4 text-center">
      <div className="text-sm text-slate-600 dark:text-slate-300/80">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub ? (
        <div className="text-xs text-slate-500 dark:text-slate-300/70 mt-1">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

/* =================== Format helpers =================== */
const fmtDate = (v) => (!v ? "—" : new Date(v).toLocaleDateString());
const fmtDateTime = (v) => (!v ? "—" : new Date(v).toLocaleString());
const fmtPct = (v) => {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${s.replace(/\.0$/, "")}%`;
};
const fmtISODate = () => new Date().toISOString().slice(0, 10);

/* normalize violation type (slug or label) */
function typeKeyFromSlugOrLabel(slug = "", label = "") {
  const s = (slug || label).toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (s.includes("nocallnoshow") || s === "ncns") return "ncns";
  if (s.includes("callout")) return "callout";
  if (
    s.includes("earlydeparture") ||
    s.includes("earlyout") ||
    s.includes("leftpostearly") ||
    s.includes("leftsiteearly")
  )
    return "early_departure";
  return slug || label || "";
}

// Which violation types require documentation tracking from here
const DOC_TYPES = new Set(["callout", "early_departure"]);

/* Badge */
function Badge({ tone = "slate", children }) {
  const theme =
    tone === "green"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200 border-green-200/70 dark:border-green-700/40"
      : tone === "amber"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 border-amber-200/70 dark:border-amber-700/40"
      : tone === "red"
      ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200 border-rose-200/70 dark:border-rose-700/40"
      : "bg-black/5 text-black/80 dark:bg-white/10 dark:text-white/80 border-black/10 dark:border-white/10";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] ${theme}`}
    >
      {children}
    </span>
  );
}

/* =================== math/helpers =================== */
const avg = (nums) =>
  !nums?.length
    ? null
    : Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;

function pickStatus(g) {
  const s =
    (g?.roster_status && String(g.roster_status).toLowerCase()) ||
    (g?.status && String(g.status).toLowerCase()) ||
    (typeof g?.is_active === "boolean"
      ? g.is_active
        ? "active"
        : "inactive"
      : null);
  return s || "active";
}
function setStatusPayload(g, next) {
  if ("roster_status" in g) return { roster_status: next };
  if ("status" in g) return { status: next };
  if ("is_active" in g) return { is_active: next === "active" };
  return {};
}
function setEmailPayload(g, value) {
  if ("contact_email" in g) return { contact_email: value };
  if ("email" in g) return { email: value };
  return {};
}

/* =================== UI: Confirm & Toast =================== */
function useConfirm() {
  const [state, setState] = useState(null);
  const confirm = (opts) =>
    new Promise((resolve) => setState({ ...opts, resolve }));
  const onCancel = () => {
    state?.resolve?.(false);
    setState(null);
  };
  const onOk = () => {
    state?.resolve?.(true);
    setState(null);
  };
  const Confirm = () =>
    state
      ? createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
            <div
              role="dialog"
              aria-modal="true"
              className="relative w-[92vw] max-w-md rounded-xl border border-white/10 bg-white text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-slate-100"
            >
              <div
                className="h-1.5 w-full rounded-t-xl"
                style={{ background: "var(--sdg-gold, #d4af37)" }}
              />
              <div className="p-4">
                <h3 className="text-lg font-semibold">
                  {state.title || "Are you sure?"}
                </h3>
                {state.body && (
                  <p className="mt-1 text-sm text-sdg-slate">{state.body}</p>
                )}
                {state.extra && (
                  <div className="mt-3 text-[13px] text-sdg-slate">
                    {state.extra}
                  </div>
                )}
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    className="btn btn-ghost"
                    onClick={onCancel}
                    autoFocus
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={onOk}
                    style={{ background: "rgba(212,175,55,.12)" }}
                  >
                    {state.okLabel || "Confirm"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;
  return { confirm, Confirm };
}
function useToast() {
  const [toasts, setToasts] = useState([]);
  const toast = (msg) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2400);
  };
  const Toasts = () =>
    createPortal(
      <div className="fixed bottom-4 right-4 z-[101] space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="rounded-lg border border-white/10 bg-white/90 px-3 py-2 text-sm shadow-lg backdrop-blur dark:bg-slate-900/90"
          >
            {t.msg}
          </div>
        ))}
      </div>,
      document.body
    );
  return { toast, Toasts };
}

/* =================== Interior Post Audits (prefer table, fallback RPC) =================== */
async function fetchIpAuditsRPC(guardId, days = 365) {
  const { data, error } = await supabase.rpc("list_interior_audits_for_guard", {
    p_guard_id: guardId,
    p_days: days,
  });
  if (error) {
    console.warn("IPA RPC error:", error.message);
    return [];
  }
  return (data || []).map((r) => ({
    ...r,
    _when: r.occurred_at || r.created_at || r.week_start || null,
    _score: Number.isFinite(+r.score_pct)
      ? +r.score_pct
      : Number.isFinite(+r.score)
      ? +r.score
      : null,
  }));
}

/* =================== date helpers (date-only UI) =================== */
const toLocalDateInput = (v) => {
  if (!v) return "";
  const d = new Date(v);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fromDateInputToISO = (yyyyMmDd) =>
  !yyyyMmDd ? null : new Date(`${yyyyMmDd}T00:00:00`).toISOString();

/* =================== Tabs =================== */
const TABS = [
  { id: "info", label: "Guard Information" },
  { id: "uniform", label: "Uniform Information" },
  { id: "reports", label: "Reports & Violations" },
  { id: "audits", label: "Audits (Interior / Truck Gate)" },
];
const getInitialTab = () => {
  const h = (window.location.hash || "").replace("#", "");
  return TABS.some((t) => t.id === h) ? h : "info";
};

/* ======================================================================= */

const UNIFORMS_TABLE = "uniforms";
const PHONE_KEYS = ["contact_phone", "phone", "phone_number"]; // allowed phone columns

export default function UserDetail() {
  const { id } = useParams();

  // Full-bleed header
  useEffect(() => {
    const headerEl =
      document.querySelector("header") ||
      document.querySelector("[data-app-header]");
    if (headerEl) headerEl.classList.add("sdg-header-bleed");
    return () => {
      if (headerEl) headerEl.classList.remove("sdg-header-bleed");
    };
  }, []);

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
        .maybeSingle();
      setMe({ id: user.id, role: p?.role ?? null });
    })();
  }, []);

  const [activeTab, setActiveTab] = useState(getInitialTab);
  useEffect(() => {
    if (window.location.hash.replace("#", "") !== activeTab) {
      window.history.replaceState(null, "", `#${activeTab}`);
    }
    const onHash = () => {
      const h = (window.location.hash || "").replace("#", "");
      if (TABS.some((t) => t.id === h)) setActiveTab(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [activeTab]);

  const [guard, setGuard] = useState(null);
  const [stats, setStats] = useState(null);
  const [violations, setViolations] = useState([]);

  // Policy points & recommendation queue (kept)
  const [points30, setPoints30] = useState(null);
  const [recos, setRecos] = useState([]);

  // Point-based escalation (rolling windows)
  const [esc, setEsc] = useState(null); // current recommendation row
  const [peLogs, setPeLogs] = useState([]); // recent decisions

  // Interior Post Audits
  const [ipAudits, setIpAudits] = useState([]);

  // Truck gate audits
  const [gateAudits, setGateAudits] = useState([]);
  const [gateAgg, setGateAgg] = useState({ avg: null, n: 0, last: null });

  // 30-day aggregates (match Users page)
  const [ipAgg30, setIpAgg30] = useState({ avg: null, n: 0, last: null });
  const [tgAgg30, setTgAgg30] = useState({ avg: null, n: 0, last: null });

  // Uniform
  const [uniform, setUniform] = useState({
    shirt_size: "",
    shirt_qty: 0,
    shirt_issued_at: null,
    hi_vis: false,
    agreement_signed: false,
    notes: "",
  });
  const [uniformLogs, setUniformLogs] = useState([]);

  const [loading, setLoading] = useState(true);

  // Phone handling
  const [phoneKey, setPhoneKey] = useState(null); // one of PHONE_KEYS or null
  const [phoneLocal, setPhoneLocal] = useState("");

  // UI hooks
  const { confirm, Confirm: ConfirmModal } = useConfirm();
  const { toast, Toasts } = useToast();

  const loadIpRows = useCallback(async () => {
    const q = await supabase
      .from("interior_post_audits")
      .select(
        "id, created_at, occurred_at, week_start, post, shift, score_pct, score, status, notes, supervisor, guard_id"
      )
      .eq("guard_id", id)
      .order("created_at", { ascending: false });

    if (!q.error) {
      const rows = (q.data || []).map((r) => ({
        ...r,
        _when: r.occurred_at || r.created_at || r.week_start || null,
        _score: Number.isFinite(+r.score_pct)
          ? +r.score_pct
          : Number.isFinite(+r.score)
          ? +r.score
          : null,
      }));
      setIpAudits(rows);
      return;
    }

    // fallback: RPC (older envs)
    const rows = await fetchIpAuditsRPC(id, 365);
    setIpAudits(rows.filter((r) => r.lane == null)); // defensive: drop any 'gate bleed'
  }, [id]);

  const loadPolicyData = useCallback(async () => {
    const [{ data: sum30 }, { data: br }] = await Promise.all([
      supabase
        .from("guard_summary_30d_v")
        .select("*")
        .eq("guard_id", id)
        .maybeSingle(),
      supabase
        .from("breach_recommendations_v")
        .select("*")
        .eq("guard_id", id)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);
    setPoints30(sum30 || null);
    setRecos(br || []);
  }, [id]);

  const loadEscalation = useCallback(async () => {
    const [{ data: escRow }, { data: logs }] = await Promise.all([
      supabase
        .from("guard_point_escalations_v")
        .select("*")
        .eq("guard_id", id)
        .maybeSingle(),
      supabase
        .from("point_escalations")
        .select("*")
        .eq("guard_id", id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    setEsc(escRow || null);
    setPeLogs(logs || []);
  }, [id]);

  const loadGateRowsAndAgg = useCallback(async () => {
    const pick = async (table) =>
      supabase
        .from(table)
        .select(
          "id, created_at, occurred_at, post, lane, shift, score_pct, score, status, notes, guard_id"
        )
        .eq("guard_id", id)
        .order("created_at", { ascending: false });

    let all = [];
    const tga = await pick("truck_gate_audits");
    if (!tga.error) all = all.concat(tga.data || []);
    const ga = await pick("gate_audits");
    if (!ga.error) all = all.concat(ga.data || []);

    const map = new Map();
    all.forEach((r) => map.set(r.id, r));
    const rows = [...map.values()].sort((a, b) => {
      const ta = new Date(a.occurred_at || a.created_at || 0).getTime() || 0;
      const tb = new Date(b.occurred_at || b.created_at || 0).getTime() || 0;
      return tb - ta;
    });
    setGateAudits(rows);

    let last = null;
    const scores = [];
    for (const r of rows) {
      const s = Number.isFinite(+r.score_pct)
        ? +r.score_pct
        : Number.isFinite(+r.score)
        ? +r.score
        : null;
      if (s != null) scores.push(s);
      const when = r.occurred_at || r.created_at;
      if (when && (!last || new Date(when) > new Date(last))) last = when;
    }
    setGateAgg({ avg: avg(scores), n: rows.length, last });
  }, [id]);

  const loadUniform = useCallback(async () => {
    const q = await supabase
      .from(UNIFORMS_TABLE)
      .select("*")
      .eq("guard_id", id)
      .limit(1);
    const row = q.data?.[0] ?? null;

    if (row) {
      setUniform({
        shirt_size: row.shirt_size ?? "",
        shirt_qty: Number(row.shirt_qty ?? 0),
        shirt_issued_at: row.shirt_issued_at ?? null,
        hi_vis: !!row.hi_vis,
        agreement_signed: !!row.agreement_signed,
        notes: row.notes ?? "",
        id: row.id,
      });
    } else {
      setUniform({
        shirt_size: "",
        shirt_qty: 0,
        shirt_issued_at: null,
        hi_vis: false,
        agreement_signed: false,
        notes: "",
      });
    }

    const { data: logs } = await supabase
      .from("uniform_logs")
      .select("*")
      .eq("guard_id", id)
      .order("created_at", { ascending: false })
      .limit(200);
    setUniformLogs(logs || []);
  }, [id]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    const [{ data: g }, { data: s }, { data: v }] = await Promise.all([
      supabase.from("guards").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("guard_stats_v")
        .select("*")
        .eq("guard_id", id)
        .maybeSingle(),
      supabase
        .from("violations")
        .select(
          `id, occurred_at, shift, post, lane, status, doc_status,
           breach_days, eligible_return_date, supervisor_note,
           violation_types ( label, slug )`
        )
        .eq("guard_id", id)
        .order("occurred_at", { ascending: false }),
    ]);

    setGuard(g || null);
    setStats(s || null);
    setViolations(v || []);

    if (g) {
      const found = PHONE_KEYS.find((k) =>
        Object.prototype.hasOwnProperty.call(g, k)
      );
      setPhoneKey(found || null);
      setPhoneLocal((found && g[found]) || "");
    } else {
      setPhoneKey(null);
      setPhoneLocal("");
    }

    await Promise.all([loadIpRows(), loadGateRowsAndAgg()]);

    // 30-day averages (align with Users page)
    const [iaMap, gaMap] = await Promise.all([
      fetchInteriorAuditAverages([id], 30),
      fetchGateAuditAverages([id], 30),
    ]);
    const ia = iaMap?.get(id) || null;
    const ga = gaMap?.get(id) || null;
    setIpAgg30({ avg: ia?.avg ?? null, n: ia?.n ?? 0, last: ia?.last ?? null });
    setTgAgg30({ avg: ga?.avg ?? null, n: ga?.n ?? 0, last: ga?.last ?? null });

    await Promise.all([loadUniform(), loadPolicyData(), loadEscalation()]);
    setLoading(false);
  }, [
    id,
    loadEscalation,
    loadGateRowsAndAgg,
    loadIpRows,
    loadPolicyData,
    loadUniform,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  /* ---------- derived ---------- */
  const statusStr = guard ? pickStatus(guard) : "active";
  const pendingReturn = Number(uniform?.shirt_qty || 0) > 0;

  /* ---------- Interior KPI (all-time from loaded rows) ---------- */
  const ipAgg = useMemo(() => {
    const graded = (ipAudits || [])
      .map((r) => r._score)
      .filter((n) => n != null);
    const last = (ipAudits || []).reduce((acc, r) => {
      const when = r._when;
      if (!when) return acc;
      return !acc || new Date(when) > new Date(acc) ? when : acc;
    }, null);
    return { avg: avg(graded), n: graded.length, last };
  }, [ipAudits]);

  /* ---------- Violations KPIs & breakdown ---------- */
  const vAgg = useMemo(() => {
    const list = violations || [];
    const total = list.length;
    const open = list.filter((v) => v.status === "open").length;
    const closed = list.filter((v) => v.status === "closed").length;
    const lastWhen = list.reduce((acc, r) => {
      const d = r.occurred_at;
      if (!d) return acc;
      return !acc || new Date(d) > new Date(acc) ? d : acc;
    }, null);
    return { total, open, closed, lastWhen };
  }, [violations]);

  const typeBreakdown = useMemo(() => {
    const map = new Map();
    (violations || []).forEach((v) => {
      const label = v?.violation_types?.label || "Other";
      map.set(label, (map.get(label) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [violations]);

  /* ----------------- local helpers for editing ----------------- */
  const setStatusLocal = (next) => {
    if (!guard) return;
    if ("roster_status" in guard)
      setGuard((g) => ({ ...g, roster_status: next }));
    else if ("status" in guard) setGuard((g) => ({ ...g, status: next }));
    else if ("is_active" in guard)
      setGuard((g) => ({ ...g, is_active: next === "active" }));
  };
  const setEmailLocal = (val) => {
    if (!guard) return;
    if ("contact_email" in guard)
      setGuard((g) => ({ ...g, contact_email: val }));
    else setGuard((g) => ({ ...g, email: val }));
  };

  /* ----------------- actions ----------------- */
  const saveProfile = useCallback(async () => {
    if (!isManager) return alert("Managers only.");
    if (!guard) return;

    const ok = await confirm({
      title: "Save changes?",
      body: `This will update the profile for ${
        guard.full_name || "this guard"
      }.`,
      okLabel: "Save",
    });
    if (!ok) return;

    const payload = {
      full_name: guard.full_name,
      notes: guard.notes ?? null,
      job_title: guard.job_title ?? null,
      ...(guard.employment_type
        ? { employment_type: guard.employment_type }
        : {}),
      ...setEmailPayload(guard, guard.contact_email ?? guard.email ?? null),
      ...setStatusPayload(guard, pickStatus(guard)),
    };

    if (phoneKey) payload[phoneKey] = phoneLocal || null;

    const { error } = await supabase
      .from("guards")
      .update(payload)
      .eq("id", id);
    if (error) return alert(error.message);

    if (!phoneKey && phoneLocal) {
      toast("Saved. (Phone not saved—no phone column exists on guards table.)");
    } else {
      toast("Profile saved.");
    }
    load();
  }, [confirm, guard, id, isManager, load, phoneKey, phoneLocal, toast]);

  const archiveToggle = useCallback(async () => {
    if (!isManager) return alert("Managers only.");
    if (!guard) return;

    const current = pickStatus(guard);
    const next = current === "inactive" ? "active" : "inactive";

    const ok = await confirm({
      title:
        next === "inactive" ? "Archive (terminate) guard?" : "Unarchive guard?",
      body:
        next === "inactive"
          ? "This will mark the guard inactive. Uniform return will be enforced."
          : "This will reactivate the guard.",
      okLabel: next === "inactive" ? "Archive" : "Unarchive",
    });
    if (!ok) return;

    if (next === "active") {
      const payload = setStatusPayload(guard, next);
      const { error } = await supabase
        .from("guards")
        .update(payload)
        .eq("id", id);
      if (error) return alert(error.message);
      toast("Guard unarchived.");
      return load();
    }

    try {
      const { data: okTerm, error } = await supabase.rpc(
        "can_terminate_guard",
        {
          p_guard_id: id,
        }
      );
      if (error) throw error;
      if (!okTerm) {
        alert(
          "This guard still has shirt(s) issued. Log the return first (Uniform tab → Shirt quantity = 0)."
        );
        setActiveTab("uniform");
        return;
      }
      const { error: terr } = await supabase.rpc("terminate_guard", {
        p_guard_id: id,
      });
      if (terr) throw terr;
      toast("Guard archived.");
      load();
    } catch (e) {
      alert(e.message || String(e));
    }
  }, [confirm, guard, id, isManager, load, toast]);

  const deleteGuard = useCallback(async () => {
    if (!isManager) return alert("Managers only.");
    const ok = await confirm({
      title: "Delete guard?",
      body: "Only proceed if the guard has no violations/audits. This action cannot be undone.",
      okLabel: "Delete",
    });
    if (!ok) return;

    let error = null;
    try {
      const resp = await supabase.rpc("delete_guard_if_unused", {
        guard_id: id,
      });
      error = resp.error || null;
      if (error && /function .* does not exist/i.test(error.message)) {
        const del = await supabase.from("guards").delete().eq("id", id);
        error = del.error || null;
      }
    } catch (e) {
      error = e;
    }
    if (error) return alert(error.message || String(error));
    toast("Deleted (if unused).");
  }, [confirm, id, isManager, toast]);

  const upsertUniform = useCallback(
    async (partial) => {
      const body = {
        guard_id: id,
        shirt_size: uniform.shirt_size || null,
        shirt_qty: Number.isFinite(+uniform.shirt_qty) ? +uniform.shirt_qty : 0,
        shirt_issued_at: uniform.shirt_issued_at || null,
        hi_vis: !!uniform.hi_vis,
        agreement_signed: !!uniform.agreement_signed,
        notes: uniform.notes || null,
        updated_at: new Date().toISOString(),
        ...partial,
      };
      const { error } = await supabase
        .from(UNIFORMS_TABLE)
        .upsert(body, { onConflict: "guard_id" });
      if (error) throw error;
    },
    [id, uniform]
  );

  const saveUniform = useCallback(async () => {
    if (!isManager) return alert("Managers only.");
    const ok = await confirm({
      title: "Save uniform info?",
      body: "This will update uniform details.",
      okLabel: "Save",
    });
    if (!ok) return;

    try {
      await upsertUniform({});
      toast("Uniform saved.");
      await loadUniform();
    } catch (e) {
      alert(e.message || String(e));
    }
  }, [confirm, isManager, loadUniform, toast, upsertUniform]);

  const deleteUniformLog = useCallback(
    async (logId) => {
      if (!isManager) return alert("Managers only.");
      const ok = await confirm({
        title: "Delete uniform log entry?",
        body: "This action cannot be undone.",
        okLabel: "Delete",
      });
      if (!ok) return;

      const { error } = await supabase
        .from("uniform_logs")
        .delete()
        .eq("id", logId);
      if (error) return alert(error.message);
      await loadUniform();
      toast("Log entry deleted.");
    },
    [confirm, isManager, loadUniform, toast]
  );

  const clearUniformLog = useCallback(async () => {
    if (!isManager) return alert("Managers only.");
    const ok = await confirm({
      title: "Clear ALL uniform logs?",
      body: "This will permanently remove all log entries for this guard.",
      okLabel: "Clear All",
    });
    if (!ok) return;

    const { error } = await supabase
      .from("uniform_logs")
      .delete()
      .eq("guard_id", id);
    if (error) return alert(error.message);
    await loadUniform();
    toast("All log entries cleared.");
  }, [confirm, id, isManager, loadUniform, toast]);

  /* ---- Update doc_status from here (no emails) ---- */
  const markDocStatus = useCallback(
    async (violationId, next) => {
      if (!isManager) return alert("Managers only.");
      const prev = violations;
      setViolations((vs) =>
        vs.map((v) => (v.id === violationId ? { ...v, doc_status: next } : v))
      );
      const { error } = await supabase
        .from("violations")
        .update({ doc_status: next })
        .eq("id", violationId);
      if (error) {
        setViolations(prev);
        alert(error.message);
      } else {
        toast(
          next === "provided"
            ? "Marked provided."
            : next === "not_provided"
            ? "Marked not provided."
            : "Set back to pending."
        );
      }
    },
    [isManager, toast, violations]
  );

  /* ---- Policy recommendation actions (existing) ---- */
  const dismissRecommendation = useCallback(
    async (rid) => {
      if (!isManager) return alert("Managers only.");
      await supabase
        .from("breach_recommendations")
        .update({
          status: "dismissed",
          decided_at: new Date().toISOString(),
          decided_by: me?.id ?? null,
        })
        .eq("id", rid);
      toast("Recommendation dismissed.");
      loadPolicyData();
    },
    [isManager, loadPolicyData, me?.id, toast]
  );

  const acceptRecommendation = useCallback(
    async (r) => {
      if (!isManager) return alert("Managers only.");
      await supabase
        .from("breach_recommendations")
        .update({
          status: "accepted",
          decided_at: new Date().toISOString(),
          decided_by: me?.id ?? null,
        })
        .eq("id", r.id);
      toast(`Accepted (${r.recommended_days}-day breach).`);
      loadPolicyData();
    },
    [isManager, loadPolicyData, me?.id, toast]
  );

  /* ---- Points escalation decision actions ---- */
  const currentLevel = esc?.recommended_action || "ok";
  function levelMeta(level) {
    if (!esc) return { pts: 0, days: 0 };
    if (level === "termination_review")
      return { pts: esc.points_in_term_window, days: esc.term_window_days };
    if (level === "breach_review")
      return { pts: esc.points_in_breach_window, days: esc.breach_window_days };
    return { pts: esc.points_in_reduce_window, days: esc.reduce_window_days }; // reduce_hours
  }
  const prettyLevel = (s) =>
    String(s || "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());

  const acceptEscalation = useCallback(async () => {
    if (!isManager || !esc || currentLevel === "ok") return;
    const { pts, days } = levelMeta(currentLevel);

    const ok = await confirm({
      title: "Apply recommended action?",
      body:
        currentLevel === "reduce_hours"
          ? "Flag this guard and reduce hours."
          : currentLevel === "breach_review"
          ? "Open a breach review for this guard."
          : "Escalate to termination review.",
      okLabel: "Record Decision",
    });
    if (!ok) return;

    // Try RPC first (creates guard_flag + logs decision).
    const rpcArgs = {
      p_guard_id: id,
      p_level: currentLevel,
      p_window_days: days,
      p_points: pts,
      p_decided_by: me?.id ?? null,
      ...(currentLevel === "reduce_hours"
        ? {
            p_hours_cap: esc?.default_hours_cap ?? 24,
            p_reduce_days: esc?.default_reduce_days ?? 14,
          }
        : {}),
    };

    const rpc = await supabase.rpc("apply_point_escalation", rpcArgs);

    if (rpc.error) {
      // Fallback: write decision log only (no guard_flag)
      const ins = await supabase.from("point_escalations").insert({
        guard_id: id,
        level: currentLevel,
        window_days: days,
        points: pts,
        status: "accepted",
        decided_by: me?.id || null,
        decided_at: new Date().toISOString(),
        reason: `Auto-recommended (${currentLevel}) based on ${pts} pts in ${days}d (fallback)`,
      });
      if (ins.error) return alert(ins.error.message);
    }

    toast("Decision recorded.");
    loadEscalation();
  }, [
    confirm,
    currentLevel,
    esc,
    id,
    isManager,
    loadEscalation,
    me?.id,
    toast,
  ]);

  const dismissEscalation = useCallback(async () => {
    if (!isManager || !esc || currentLevel === "ok") return;
    const { pts, days } = levelMeta(currentLevel);

    const ins = await supabase.from("point_escalations").insert({
      guard_id: id,
      level: currentLevel,
      window_days: days,
      points: pts,
      status: "dismissed",
      decided_by: me?.id || null,
      decided_at: new Date().toISOString(),
      reason: "Dismissed on user page",
    });
    if (ins.error) return alert(ins.error.message);
    toast("Dismissed.");
    loadEscalation();
  }, [currentLevel, esc, id, isManager, loadEscalation, me?.id, toast]);

  /* ---------- computed display ---------- */
  // Prefer view % from guard_stats_v, then 30-day avg, then all-time avg from loaded rows.
  const ipAvgValue = stats?.ip_avg_score_pct ?? ipAgg30.avg ?? ipAgg.avg;
  // For counts, intentionally fall back when the view returns 0 (staleness guard).
  const ipCnt = stats?.ip_audits || ipAgg30.n || ipAgg.n || 0;
  const ipLast = ipAgg30.last ?? ipAgg.last;

  const tgAvgValue = stats?.tg_avg_score_pct ?? tgAgg30.avg ?? gateAgg.avg;
  const tgCnt = stats?.tg_audits || tgAgg30.n || gateAgg.n || 0;
  const tgLast = stats?.last_audit_at ?? tgAgg30.last ?? gateAgg.last;

  return (
    <div className="py-6">
      {/* Full-bleed header + global width overrides */}
      <style>{`
        header.sdg-header-bleed{position:relative;left:50%;right:50%;margin-left:-50vw;margin-right:-50vw;width:100vw;border-radius:0;padding-left:max(env(safe-area-inset-left),24px);padding-right:max(env(safe-area-inset-right),24px);}
        header.sdg-header-bleed .container, header.sdg-header-bleed .mx-auto, header.sdg-header-bleed [class*="max-w-"]{max-width:none!important;width:100%!important;}
        .page-full{max-width:100%!important;width:100%!important;}
        table thead{position:sticky;top:0;z-index:5}
        tbody tr:nth-child(odd){background:rgba(255,255,255,.02)}
        input,select,textarea{background-color:#fff;color:#0f172a;border:1px solid rgba(0,0,0,.10)}
        .dark input,.dark select,.dark textarea{background-color:#151a1e!important;color:#e5e7eb!important;border-color:rgba(255,255,255,.12)!important}
        .tabbtn{position:relative;padding:10px 14px;border-radius:10px 10px 0 0;background:transparent;font-weight:600}
        .tabbtn[aria-selected="true"]{background:rgba(255,255,255,.04)}
        .tabbtn[aria-selected="true"]::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:3px;background:var(--sdg-gold,#d4af37);border-radius:3px 3px 0 0}
        .chipbtn{border-radius:9999px;padding:.35rem .65rem;font-size:12px;border:1px solid}
        .chip-green{background:#ecfdf5;color:#065f46;border-color:#a7f3d0}
        .chip-red{background:#fff1f2;color:#9f1239;border-color:#fecdd3}
        .chip-amber{background:#fffbeb;color:#92400e;border-color:#fde68a}
        .chip-ghost{background:transparent;color:inherit;border-color:rgba(255,255,255,.12)}
      `}</style>

      {/* PAGE CONTAINER */}
      <div className="page-full px-4 md:px-6">
        {/* Top strip */}
        <div className="-mx-4 md:-mx-6 px-4 md:px-6 border-b border-white/10 mb-4">
          <div className="flex items-center justify-between py-3">
            <Link
              to="/hr/users"
              className="inline-flex items-center gap-2 rounded-full border border-black/10 dark:border-white/10 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 transition"
              title="Back to Users"
            >
              <span className="text-lg leading-none">←</span>
              <span className="font-medium">Back to Users</span>
            </Link>

            {guard && (
              <div className="flex items-center gap-2">
                {isManager && (
                  <>
                    <button className="btn btn-ghost" onClick={saveProfile}>
                      Save
                    </button>
                    <button className="btn btn-ghost" onClick={archiveToggle}>
                      {pickStatus(guard) === "inactive"
                        ? "Unarchive"
                        : "Archive"}
                    </button>
                    <button className="btn btn-ghost" onClick={deleteGuard}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Name + Job Title + big status */}
          {guard && (
            <div className="flex flex-wrap items-start justify-between gap-3 pb-3">
              <div>
                <h1 className="font-heading text-3xl md:text-4xl leading-tight">
                  {guard.full_name}
                  {` — ${
                    guard.job_title ||
                    guard.employment_type ||
                    (guard.is_supervisor ? "Supervisor" : "Guard")
                  }`}
                </h1>
                <div
                  className={`mt-2 text-xl font-semibold ${
                    statusStr === "active" ? "text-green-600" : "text-rose-600"
                  }`}
                >
                  {statusStr === "active" ? "Active" : "Inactive"}
                </div>
              </div>
            </div>
          )}

          {/* Full-bleed Tabs */}
          <nav
            className="flex gap-2"
            role="tablist"
            aria-label="User detail tabs"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={activeTab === t.id}
                aria-controls={`panel-${t.id}`}
                id={`tab-${t.id}`}
                className="tabbtn"
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {!guard ? (
          <div className="text-sdg-slate">
            {loading ? "Loading…" : "Not found."}
          </div>
        ) : (
          <>
            {/* ================= INFO TAB ================= */}
            {activeTab === "info" && (
              <>
                {/* Reports Summary FIRST */}
                <Frame title="Reports Summary">
                  <div className="grid gap-3 md:grid-cols-4 mt-3">
                    <Metric label="Open Reports" value={vAgg.open} />
                    <Metric label="Closed Reports" value={vAgg.closed} />
                    <Metric label="Total Violations" value={vAgg.total} />
                    <Metric
                      label="Points (30d)"
                      value={points30?.points_30d ?? 0}
                    />
                  </div>
                </Frame>

                {/* Guard Information — full width */}
                <div className="mt-6">
                  <Frame
                    title="Guard Information"
                    actions={
                      isManager ? (
                        <button className="btn btn-ghost" onClick={saveProfile}>
                          Save Profile
                        </button>
                      ) : null
                    }
                  >
                    <div className="space-y-3 mt-3">
                      {/* Full name */}
                      <label className="block text-sm">
                        <span className="block mb-1 text-sdg-slate">
                          Full Name
                        </span>
                        <input
                          type="text"
                          className="w-full rounded-md px-3 py-2"
                          value={guard.full_name || ""}
                          onChange={(e) =>
                            setGuard((g) => ({
                              ...g,
                              full_name: e.target.value,
                            }))
                          }
                        />
                      </label>

                      {/* Email + Phone */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="block text-sm">
                          <span className="block mb-1 text-sdg-slate">
                            Email
                          </span>
                          <input
                            type="email"
                            className="w-full rounded-md px-3 py-2"
                            value={guard.contact_email ?? guard.email ?? ""}
                            onChange={(e) => setEmailLocal(e.target.value)}
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="block mb-1 text-sdg-slate">
                            Phone Number
                          </span>
                          <input
                            type="tel"
                            className="w-full rounded-md px-3 py-2"
                            value={phoneLocal}
                            onChange={(e) => setPhoneLocal(e.target.value)}
                          />
                        </label>
                      </div>

                      {/* Employment Type + Job Title */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="block text-sm">
                          <span className="block mb-1 text-sdg-slate">
                            Employment Type
                          </span>
                          <select
                            className="w-full rounded-md px-3 py-2"
                            value={(
                              guard.employment_type || "1099"
                            ).toUpperCase()}
                            onChange={(e) =>
                              setGuard((g) => ({
                                ...g,
                                employment_type: e.target.value.toUpperCase(),
                              }))
                            }
                          >
                            <option value="W2">W2</option>
                            <option value="1099">1099</option>
                          </select>
                        </label>

                        <label className="block text-sm">
                          <span className="block mb-1 text-sdg-slate">
                            Job Title
                          </span>
                          <select
                            className="w-full rounded-md px-3 py-2"
                            value={guard.job_title ?? ""}
                            onChange={(e) =>
                              setGuard((g) => ({
                                ...g,
                                job_title: e.target.value,
                              }))
                            }
                          >
                            <option value="">—</option>
                            {[
                              "Interior Guard",
                              "Gate Guard",
                              "Roving Guard",
                              "Gate Supervisor",
                              "Shift Supervisor",
                            ].map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      {/* Status */}
                      <label className="block text-sm">
                        <span className="block mb-1 text-sdg-slate">
                          Status
                        </span>
                        <select
                          className="w-full rounded-md px-3 py-2"
                          value={pickStatus(guard)}
                          onChange={(e) => setStatusLocal(e.target.value)}
                        >
                          <option value="active">active</option>
                          <option value="inactive">inactive</option>
                        </select>
                      </label>

                      {/* Notes */}
                      <label className="block text-sm">
                        <span className="block mb-1 text-sdg-slate">Notes</span>
                        <textarea
                          rows={5}
                          className="w-full rounded-md px-3 py-2"
                          value={guard.notes ?? ""}
                          onChange={(e) =>
                            setGuard((g) => ({ ...g, notes: e.target.value }))
                          }
                        />
                      </label>
                    </div>
                  </Frame>
                </div>
              </>
            )}

            {/* ================= UNIFORM TAB ================= */}
            {activeTab === "uniform" && (
              <>
                <Frame
                  title="Uniform Information"
                  actions={
                    isManager ? (
                      <button className="btn btn-ghost" onClick={saveUniform}>
                        Save Uniform
                      </button>
                    ) : null
                  }
                >
                  {/* Full-width form; use internal grid just for fields */}
                  <div className="space-y-3 mt-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="block text-sm">
                        <span className="block mb-1 text-sdg-slate">
                          Shirt Size
                        </span>
                        <input
                          type="text"
                          className="w-full rounded-md px-3 py-2"
                          value={uniform.shirt_size || ""}
                          onChange={(e) =>
                            setUniform((u) => ({
                              ...u,
                              shirt_size: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="block mb-1 text-sdg-slate">
                          Shirt Quantity
                        </span>
                        <input
                          type="number"
                          className="w-full rounded-md px-3 py-2"
                          value={Number(uniform.shirt_qty ?? 0)}
                          onChange={(e) =>
                            setUniform((u) => ({
                              ...u,
                              shirt_qty: Number(e.target.value || 0),
                            }))
                          }
                        />
                      </label>
                    </div>

                    <label className="block text-sm">
                      <span className="block mb-1 text-sdg-slate">
                        Shirt Issued (date)
                      </span>
                      <input
                        type="date"
                        className="w-full rounded-md px-3 py-2"
                        value={toLocalDateInput(uniform.shirt_issued_at)}
                        onChange={(e) =>
                          setUniform((u) => ({
                            ...u,
                            shirt_issued_at: fromDateInputToISO(e.target.value),
                          }))
                        }
                      />
                    </label>

                    <div className="flex flex-wrap gap-6">
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!!uniform.hi_vis}
                          onChange={(e) =>
                            setUniform((u) => ({
                              ...u,
                              hi_vis: e.target.checked,
                            }))
                          }
                        />
                        Hi-Vis Issued
                      </label>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!!uniform.agreement_signed}
                          onChange={(e) =>
                            setUniform((u) => ({
                              ...u,
                              agreement_signed: e.target.checked,
                            }))
                          }
                        />
                        Uniform Agreement Signed
                      </label>
                    </div>

                    <label className="block text-sm">
                      <span className="block mb-1 text-sdg-slate">Notes</span>
                      <textarea
                        rows={5}
                        className="w-full rounded-md px-3 py-2"
                        value={uniform.notes || ""}
                        onChange={(e) =>
                          setUniform((u) => ({ ...u, notes: e.target.value }))
                        }
                      />
                    </label>

                    {isManager && pendingReturn && (
                      <button
                        className="btn btn-ghost"
                        onClick={async () => {
                          const ok = await confirm({
                            title: "Mark shirt(s) returned?",
                            body: "This will set Shirt quantity to 0 and stamp a note.",
                            okLabel: "Mark Returned",
                          });
                          if (!ok) return;
                          try {
                            await upsertUniform({
                              shirt_qty: 0,
                              notes: `${
                                uniform?.notes ? uniform.notes + "\n" : ""
                              }[${fmtISODate()}] Marked returned`,
                            });
                            toast("Marked returned.");
                            await loadUniform();
                          } catch (e) {
                            alert(e.message || String(e));
                          }
                        }}
                      >
                        Mark Returned
                      </button>
                    )}
                  </div>
                </Frame>

                {/* Uniform Log */}
                <Frame
                  title="Uniform Log"
                  actions={
                    isManager && uniformLogs.length > 0 ? (
                      <button
                        className="btn btn-ghost"
                        onClick={clearUniformLog}
                      >
                        Clear All
                      </button>
                    ) : null
                  }
                >
                  <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10 mt-3">
                    <table className="min-w-full text-sm">
                      <thead className="bg-black/[0.03] dark:bg-white/[0.06] text-slate-700 dark:text-slate-200">
                        <tr>
                          <th className="py-2.5 pl-3 pr-3 text-left font-semibold">
                            Date/Time
                          </th>
                          <th className="py-2.5 pr-3 text-left font-semibold">
                            Event
                          </th>
                          <th className="py-2.5 pr-3 text-left font-semibold">
                            Notes
                          </th>
                          <th className="py-2.5 pr-3 text-left font-semibold">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="[&>tr:nth-child(even)]:bg-black/[0.015] dark:[&>tr:nth-child(even)]:bg-white/[0.04]">
                        {uniformLogs.length === 0 ? (
                          <tr>
                            <td
                              className="py-6 text-center text-slate-500"
                              colSpan={4}
                            >
                              No uniform log entries.
                            </td>
                          </tr>
                        ) : (
                          uniformLogs.map((row) => (
                            <tr
                              key={row.id}
                              className="border-t border-black/5 dark:border-white/10"
                            >
                              <td className="py-2.5 pl-3 pr-3 whitespace-nowrap">
                                {fmtDateTime(row.created_at)}
                              </td>
                              <td className="py-2.5 pr-3">
                                {row.event || row.action || "—"}
                              </td>
                              <td className="py-2.5 pr-3">
                                {row.notes || row.message || "—"}
                              </td>
                              <td className="py-2.5 pr-3">
                                {isManager && row.id && (
                                  <button
                                    className="chipbtn chip-ghost underline underline-offset-2"
                                    onClick={() => deleteUniformLog(row.id)}
                                  >
                                    Delete
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </Frame>
              </>
            )}

            {/* ================= REPORTS TAB ================= */}
            {activeTab === "reports" && (
              <div className="space-y-6">
                {/* Point-Based Escalation */}
                <Frame title="Point-Based Escalation">
                  {!esc ? (
                    <div className="text-sdg-slate">No data.</div>
                  ) : (
                    <>
                      <div className="grid gap-3 md:grid-cols-5 mt-3">
                        <Metric
                          label={`Points (${esc.reduce_window_days}d)`}
                          value={esc.points_in_reduce_window}
                          sub={`Threshold ${esc.reduce_points_threshold}`}
                        />
                        <Metric
                          label={`Points (${esc.breach_window_days}d)`}
                          value={esc.points_in_breach_window}
                          sub={`Threshold ${esc.breach_points_threshold}`}
                        />
                        <Metric
                          label={`Points (${esc.term_window_days}d)`}
                          value={esc.points_in_term_window}
                          sub={`Threshold ${esc.term_points_threshold}`}
                        />
                        <Metric
                          label="Recommended"
                          value={
                            esc.recommended_action === "ok"
                              ? "OK"
                              : prettyLevel(esc.recommended_action)
                          }
                          sub="Highest level currently triggered"
                        />
                        <div className="flex items-center justify-center">
                          {isManager && esc.recommended_action !== "ok" ? (
                            <div className="flex gap-2">
                              <button
                                className="btn btn-ghost"
                                onClick={acceptEscalation}
                              >
                                Accept
                              </button>
                              <button
                                className="btn btn-ghost"
                                onClick={dismissEscalation}
                              >
                                Dismiss
                              </button>
                            </div>
                          ) : (
                            <Badge tone="green">No action required</Badge>
                          )}
                        </div>
                      </div>

                      {/* Recent escalation decisions */}
                      <div className="mt-5">
                        <div className="text-sm font-medium text-slate-600 dark:text-slate-300/90">
                          Recent Escalation Decisions
                        </div>
                        <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10 mt-2">
                          <table className="min-w-full text-sm">
                            <thead className="bg-black/[0.03] dark:bg-white/[0.06] text-slate-700 dark:text-slate-200">
                              <tr>
                                <th className="py-2.5 pl-3 pr-3 text-left font-semibold">
                                  When
                                </th>
                                <th className="py-2.5 pr-3 text-left font-semibold">
                                  Level
                                </th>
                                <th className="py-2.5 pr-3 text-left font-semibold">
                                  Window
                                </th>
                                <th className="py-2.5 pr-3 text-left font-semibold">
                                  Points
                                </th>
                                <th className="py-2.5 pr-3 text-left font-semibold">
                                  Status
                                </th>
                                <th className="py-2.5 pr-3 text-left font-semibold">
                                  Reason
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {peLogs.length === 0 ? (
                                <tr>
                                  <td
                                    className="py-4 text-center text-sdg-slate"
                                    colSpan={6}
                                  >
                                    No decisions logged.
                                  </td>
                                </tr>
                              ) : (
                                peLogs.map((r) => (
                                  <tr
                                    key={r.id}
                                    className="border-t border-black/5 dark:border-white/10"
                                  >
                                    <td className="py-2.5 pl-3 pr-3 whitespace-nowrap">
                                      {fmtDateTime(r.created_at)}
                                    </td>
                                    <td className="py-2.5 pr-3 capitalize">
                                      {prettyLevel(r.level)}
                                    </td>
                                    <td className="py-2.5 pr-3">
                                      {r.window_days} days
                                    </td>
                                    <td className="py-2.5 pr-3">{r.points}</td>
                                    <td className="py-2.5 pr-3 capitalize">
                                      {r.status}
                                    </td>
                                    <td className="py-2.5 pr-3">
                                      {r.reason || "—"}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )}
                </Frame>

                <Frame title="Violations Overview" accent>
                  {/* Top emphasis */}
                  <div className="grid gap-3 md:grid-cols-4 mt-3">
                    <Metric label="Total Violations" value={vAgg.total} />
                    <Metric label="Open Cases" value={vAgg.open} />
                    <Metric label="Closed Cases" value={vAgg.closed} />
                    <Metric
                      label="Points (30d)"
                      value={points30?.points_30d ?? 0}
                    />
                  </div>

                  {/* By Type (count, all-time) — compact list */}
                  <div className="mt-5">
                    <div className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300/90">
                      By Type (count, all-time)
                    </div>
                    {typeBreakdown.length === 0 ? (
                      <div className="text-sdg-slate text-sm">
                        No violations to display.
                      </div>
                    ) : (
                      <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
                        <ul className="divide-y divide-black/10 dark:divide-white/10">
                          {typeBreakdown.map(({ label, count }) => (
                            <li
                              key={label}
                              className="flex items-center justify-between px-4 py-2.5"
                            >
                              <span className="truncate">{label}</span>
                              <span className="inline-flex min-w-[2.25rem] justify-center rounded-full border border-black/10 dark:border-white/10 px-2 py-0.5 text-sm font-medium">
                                {count}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Frame>

                {/* Policy Recommendations queue */}
                {recos.length > 0 && (
                  <Frame title="Policy Recommendations">
                    <div className="space-y-2 mt-2">
                      {recos.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center justify-between rounded-xl border border-black/10 dark:border-white/10 p-3"
                        >
                          <div>
                            <div className="font-medium">{r.type_label}</div>
                            <div className="text-sm text-slate-500">
                              Occurred {fmtDateTime(r.occurred_at)} • {r.reason}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {isManager && (
                              <>
                                <button
                                  className="chipbtn chip-green"
                                  onClick={() => acceptRecommendation(r)}
                                >
                                  Accept {r.recommended_days}-Day Breach
                                </button>
                                <button
                                  className="chipbtn chip-ghost"
                                  onClick={() => dismissRecommendation(r.id)}
                                >
                                  Dismiss
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Frame>
                )}

                {/* Violations table */}
                <Frame title="Violations">
                  <div className="mb-2 text-[12px] text-slate-500 dark:text-white/60">
                    <strong>Note:</strong> Updating documentation status here
                    will not send emails. Use the <em>Violations</em> page to
                    send documentation requests or breach notices.
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
                    <table className="min-w-full text-sm">
                      <thead className="bg-black/[0.03] dark:bg-white/[0.06] text-slate-700 dark:text-slate-200">
                        <tr className="text-left">
                          <th className="py-2.5 pl-3 pr-3 font-semibold">
                            Date/Time
                          </th>
                          <th className="py-2.5 pr-3 font-semibold">Type</th>
                          <th className="py-2.5 pr-3 font-semibold">
                            Post/Lane
                          </th>
                          <th className="py-2.5 pr-3 font-semibold">Shift</th>
                          <th className="py-2.5 pr-3 font-semibold text-center">
                            Status
                          </th>
                          <th className="py-2.5 pr-3 font-semibold text-center">
                            Docs
                          </th>
                          <th className="py-2.5 pr-3 font-semibold">
                            Supervisor Notes
                          </th>
                          {/* New, optional breach info columns */}
                          <th className="py-2.5 pr-3 font-semibold text-center">
                            Breach
                          </th>
                          <th className="py-2.5 pr-3 font-semibold text-center">
                            Eligible Return
                          </th>
                          <th className="py-2.5 pr-3 font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="[&>tr:nth-child(even)]:bg-black/[0.015] dark:[&>tr:nth-child(even)]:bg-white/[0.04]">
                        {violations.length === 0 ? (
                          <tr>
                            <td
                              className="py-6 text-center text-slate-500"
                              colSpan={10}
                            >
                              No violations.
                            </td>
                          </tr>
                        ) : (
                          violations.map((r) => {
                            const postLane = r.lane
                              ? `${r.post || "—"} • Lane ${r.lane}`
                              : r.post || "—";
                            const key = typeKeyFromSlugOrLabel(
                              r.violation_types?.slug || "",
                              r.violation_types?.label || ""
                            );
                            const requires = DOC_TYPES.has(key);
                            const docs = requires
                              ? r.doc_status === "provided"
                                ? "Provided"
                                : r.doc_status === "not_provided"
                                ? "Not provided"
                                : "Pending"
                              : "N/A";
                            return (
                              <tr
                                key={r.id}
                                className="border-t border-black/5 dark:border-white/10"
                              >
                                <td className="py-2.5 pl-3 pr-3 whitespace-nowrap">
                                  {fmtDateTime(r.occurred_at)}
                                </td>
                                <td className="py-2.5 pr-3">
                                  {r.violation_types?.label}
                                </td>
                                <td className="py-2.5 pr-3">{postLane}</td>
                                <td className="py-2.5 pr-3 capitalize">
                                  {r.shift || "—"}
                                </td>
                                <td className="py-2.5 pr-3 text-center">
                                  <Badge
                                    tone={
                                      r.status === "open" ? "amber" : "green"
                                    }
                                  >
                                    {r.status}
                                  </Badge>
                                </td>
                                <td className="py-2.5 pr-3 text-center">
                                  {requires ? (
                                    <Badge
                                      tone={
                                        r.doc_status === "provided"
                                          ? "green"
                                          : r.doc_status === "not_provided"
                                          ? "red"
                                          : "amber"
                                      }
                                    >
                                      {docs}
                                    </Badge>
                                  ) : (
                                    <span className="text-sdg-slate">N/A</span>
                                  )}
                                </td>
                                <td
                                  className="py-2.5 pr-3 whitespace-pre-wrap break-words"
                                  title={r.supervisor_note || ""}
                                >
                                  {r.supervisor_note || "—"}
                                </td>
                                {/* Breach days */}
                                <td className="py-2.5 pr-3 text-center">
                                  {r.breach_days != null && r.breach_days !== ""
                                    ? `${r.breach_days}d`
                                    : "—"}
                                </td>
                                {/* Eligible return date */}
                                <td className="py-2.5 pr-3 text-center">
                                  {r.eligible_return_date
                                    ? fmtDate(r.eligible_return_date)
                                    : "—"}
                                </td>
                                <td className="py-2.5 pr-3">
                                  <div className="inline-flex flex-wrap gap-2">
                                    {requires && isManager && (
                                      <>
                                        <button
                                          className="chipbtn chip-green"
                                          onClick={() =>
                                            markDocStatus(r.id, "provided")
                                          }
                                        >
                                          Mark Provided
                                        </button>
                                        <button
                                          className="chipbtn chip-red"
                                          onClick={() =>
                                            markDocStatus(r.id, "not_provided")
                                          }
                                        >
                                          Not Provided
                                        </button>
                                        <button
                                          className="chipbtn chip-amber"
                                          onClick={() =>
                                            markDocStatus(r.id, null)
                                          }
                                          title="Reset to pending"
                                        >
                                          Pending
                                        </button>
                                      </>
                                    )}
                                    <Link
                                      to={`/hr/violations/${r.id}`}
                                      className="chipbtn chip-ghost underline underline-offset-2"
                                      title="Open this case on the Violations page"
                                    >
                                      Open Case
                                    </Link>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </Frame>
              </div>
            )}

            {/* ================= AUDITS TAB ================= */}
            {activeTab === "audits" && (
              <div className="space-y-6">
                <Frame title="Audit Overview" accent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#141a24] p-4">
                      <div className="text-sm text-slate-600 dark:text-slate-300/80">
                        Interior Audit
                      </div>
                      <div className="mt-3 flex items-end gap-3">
                        <div className="text-2xl font-semibold">
                          {fmtPct(ipAvgValue)}
                        </div>
                        <div className="text-sdg-slate">( {ipCnt} )</div>
                      </div>
                      <div className="text-xs mt-2">
                        <span className="text-sdg-slate">Last audit:</span>{" "}
                        {fmtDateTime(ipLast)}
                      </div>
                      <div className="text-xs text-sdg-slate mt-1">
                        Shows 30-day average when available; otherwise all-time
                        average of graded / pass-fail scores.
                      </div>
                    </div>

                    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#141a24] p-4">
                      <div className="text-sm text-slate-600 dark:text-slate-300/80">
                        Truck Gate Audit
                      </div>
                      <div className="mt-3 flex items-end gap-3">
                        <div className="text-2xl font-semibold">
                          {fmtPct(tgAvgValue)}
                        </div>
                        <div className="text-sdg-slate">( {tgCnt} )</div>
                      </div>
                      <div className="text-xs mt-2">
                        <span className="text-sdg-slate">Last audit:</span>{" "}
                        {fmtDateTime(tgLast)}
                      </div>
                    </div>
                  </div>
                </Frame>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <Frame title="Interior Post Audits">
                    <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
                      <table className="min-w-full text-sm">
                        <thead className="bg-black/[0.03] dark:bg-white/[0.06] text-slate-700 dark:text-slate-200">
                          <tr>
                            <th className="py-2.5 pl-3 pr-3 text-left font-semibold">
                              Date/Time
                            </th>
                            <th className="py-2.5 pr-3 text-left font-semibold">
                              Week
                            </th>
                            <th className="py-2.5 pr-3 text-left font-semibold">
                              Supervisor
                            </th>
                            <th className="py-2.5 pr-3 text-left font-semibold">
                              Post
                            </th>
                            <th className="py-2.5 pr-3 text-left font-semibold">
                              Shift
                            </th>
                            <th className="py-2.5 pr-3 text-left font-semibold">
                              Score
                            </th>
                            <th className="py-2.5 pr-3 text-left font-semibold">
                              Status
                            </th>
                            <th className="py-2.5 pr-3 text-left font-semibold">
                              Notes
                            </th>
                          </tr>
                        </thead>
                        <tbody className="[&>tr:nth-child(even)]:bg-black/[0.015] dark:[&>tr:nth-child(even)]:bg-white/[0.04]">
                          {ipAudits.length === 0 ? (
                            <tr>
                              <td
                                className="py-6 text-center text-slate-500"
                                colSpan={8}
                              >
                                No interior audits yet.
                              </td>
                            </tr>
                          ) : (
                            ipAudits.map((a) => {
                              const when = a._when;
                              const score = a._score;
                              return (
                                <tr
                                  key={a.id}
                                  className="border-t border-black/5 dark:border-white/10"
                                >
                                  <td className="py-2.5 pl-3 pr-3 whitespace-nowrap">
                                    {fmtDateTime(when)}
                                  </td>
                                  <td className="py-2.5 pr-3">
                                    {fmtDate(a.week_start)}
                                  </td>
                                  <td className="py-2.5 pr-3">
                                    {a.supervisor || "—"}
                                  </td>
                                  <td className="py-2.5 pr-3">
                                    {a.post || "—"}
                                  </td>
                                  <td className="py-2.5 pr-3 capitalize">
                                    {a.shift || "—"}
                                  </td>
                                  <td className="py-2.5 pr-3">
                                    {score == null ? "—" : fmtPct(score)}
                                  </td>
                                  <td className="py-2.5 pr-3 capitalize">
                                    {a.status || "—"}
                                  </td>
                                  <td className="py-2.5 pr-3">
                                    {a.notes || "—"}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Frame>

                  <Frame title="Truck / Gate Audits">
                    <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
                      <table className="min-w-full text-sm">
                        <thead className="bg-black/[0.03] dark:bg-white/[0.06] text-slate-700 dark:text-slate-200">
                          <tr>
                            <th className="py-2.5 pl-3 pr-3 text-left font-semibold">
                              Date/Time
                            </th>
                            <th className="py-2.5 pr-3 text-left font-semibold">
                              Post / Lane
                            </th>
                            <th className="py-2.5 pr-3 text-left font-semibold">
                              Shift
                            </th>
                            <th className="py-2.5 pr-3 text-left font-semibold">
                              Score
                            </th>
                            <th className="py-2.5 pr-3 text-left font-semibold">
                              Status
                            </th>
                            <th className="py-2.5 pr-3 text-left font-semibold">
                              Notes
                            </th>
                          </tr>
                        </thead>
                        <tbody className="[&>tr:nth-child(even)]:bg-black/[0.015] dark:[&>tr:nth-child(even)]:bg-white/[0.04]">
                          {gateAudits.length === 0 ? (
                            <tr>
                              <td
                                className="py-6 text-center text-slate-500"
                                colSpan={6}
                              >
                                No truck/gate audits yet.
                              </td>
                            </tr>
                          ) : (
                            gateAudits.map((a) => {
                              const when = a.occurred_at || a.created_at;
                              const score =
                                a.score_pct == null ||
                                Number.isNaN(Number(a.score_pct))
                                  ? a.score
                                  : a.score_pct;
                              const postLane = a.lane
                                ? `${a.post || "—"} • Lane ${a.lane}`
                                : a.post || "—";
                              return (
                                <tr
                                  key={a.id}
                                  className="border-t border-black/5 dark:border-white/10"
                                >
                                  <td className="py-2.5 pl-3 pr-3 whitespace-nowrap">
                                    {fmtDateTime(when)}
                                  </td>
                                  <td className="py-2.5 pr-3">{postLane}</td>
                                  <td className="py-2.5 pr-3 capitalize">
                                    {a.shift || "—"}
                                  </td>
                                  <td className="py-2.5 pr-3">
                                    {score == null ? "—" : fmtPct(score)}
                                  </td>
                                  <td className="py-2.5 pr-3 capitalize">
                                    {a.status || "—"}
                                  </td>
                                  <td className="py-2.5 pr-3">
                                    {a.notes || "—"}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Frame>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 pointer-events-none flex items-end justify-end p-4 z-[90]">
          <div className="rounded-md bg-black/50 text-white text-xs px-2 py-1">
            Loading…
          </div>
        </div>
      )}

      {/* UI Portals */}
      <ConfirmModal />
      <Toasts />
    </div>
  );
}
