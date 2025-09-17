// src/lib/audits.js
import { supabase } from "./supabaseClient";

/* --------------------------- Roster helpers --------------------------- */
export async function fetchGuards() {
  try {
    const { data, error } = await supabase
      .from("guards")
      .select("id, full_name")
      .order("full_name", { ascending: true });
    if (error) throw error;
    return data || [];
  } catch {
    // Fallback to profiles if guards isn’t available everywhere
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name")
      .order("full_name", { ascending: true });
    return data || [];
  }
}

/* ----------------------------- Local date utils ---------------------------- */
// Build a local YYYY-MM-DD string (no UTC drift)
function toISODateLocal(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function weekStartSundayYMD(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  // 0 = Sunday
  x.setDate(x.getDate() - x.getDay());
  return toISODateLocal(x);
}

/* --------------------------- Internal helpers ------------------------- */
/** Try inserting, and if a column is missing in the schema, drop it and retry. */
async function insertWithMissingColumnFallback(
  table,
  initialRow,
  maxAttempts = 5
) {
  let row = { ...initialRow };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error } = await supabase
      .from(table)
      .insert(row)
      .select()
      .single();
    if (!error) return data;

    const msg = String(error.message || "");
    const m =
      msg.match(/column\s+"([^"]+)"\s+does not exist/i) ||
      msg.match(/could not find the '([^']+)' column/i) ||
      msg.match(/'([^']+)'\s+column/i);

    if (m && row[m[1]] !== undefined) {
      // Drop unknown column and retry
      delete row[m[1]];
      continue;
    }
    throw error;
  }
  throw new Error("Insert failed after removing unknown columns.");
}

/** normalize score columns to a single number or null */
const toScore = (row) => {
  const a = Number(row?.score_pct);
  if (Number.isFinite(a)) return a;
  const b = Number(row?.score);
  return Number.isFinite(b) ? b : null;
};

/** generic aggregator -> Map(guard_id => {avg, n, last}) with optional day filter */
function buildAgg(rows, days = null) {
  const cutoff = days ? Date.now() - days * 864e5 : null;
  const by = new Map();

  for (const r of rows || []) {
    const gid = r.guard_id;
    if (!gid) continue;

    const when = r.occurred_at || r.created_at || r.week_start || null;
    const t = when ? new Date(when).getTime() : null;
    if (cutoff && t && t < cutoff) continue;

    const s = toScore(r);
    if (s == null) continue;

    const prev = by.get(gid) || { sum: 0, n: 0, last: null };
    prev.sum += s;
    prev.n += 1;
    if (when && (!prev.last || new Date(when) > new Date(prev.last))) {
      prev.last = when;
    }
    by.set(gid, prev);
  }

  const out = new Map();
  for (const [gid, v] of by.entries()) {
    out.set(gid, {
      avg: v.n ? Math.round((v.sum / v.n) * 10) / 10 : null, // one decimal
      n: v.n,
      last: v.last,
    });
  }
  return out;
}

/* ---------------------- Cross-cutting helpers ------------------------ */
function normalizeShift(s) {
  if (!s) return null;
  const v = String(s).toLowerCase();
  if (v.startsWith("day")) return "day";
  if (v.startsWith("night")) return "night";
  return s;
}
function computeScoreAndStatus(answers = {}, forcedPct, forcedStatus) {
  let pass = 0,
    fail = 0;
  for (const v of Object.values(answers)) {
    if (v === true) pass += 1;
    else if (v === false) fail += 1;
  }
  const considered = pass + fail;
  const pct =
    forcedPct ?? (considered ? Math.round((pass / considered) * 100) : null);

  let status = forcedStatus ?? "fail";
  if (forcedStatus == null) {
    if (pct != null) {
      if (pct >= 90) status = "pass";
      else if (pct >= 80) status = "conditional";
      else status = "fail";
    } else {
      status = "fail";
    }
  }
  return { pct, status };
}

/** Heuristic to detect a gate audit row that was mis-filed into interior_post_audits. */
function looksLikeGate(row = {}) {
  const kind = (row.audit_kind || "").toLowerCase();
  if (kind === "gate") return true;

  const p = String(row.post || "")
    .toLowerCase()
    .trim();
  if (p === "inbound" || p === "outbound" || p.includes("truck gate"))
    return true;

  if (row.gate_type != null || row.lane != null) return true;

  return false;
}
export const isGateAuditRow = looksLikeGate;

/* ----------------------------- Create INTERIOR audit -------------------------- */
/**
 * payload:
 * {
 *   supervisor, post, shift, guard_id?, guard_name?,
 *   answers, section_notes?, notes?, attachments?,
 *   week_start?, score_pct?, status?, occurred_at?
 * }
 * - answers: {key: true|false|null} ; N/A = null (ignored in scoring)
 * - If score/status provided, they will be respected; otherwise computed.
 */
export async function createAudit(payload) {
  const answers = payload.answers || {};
  const { pct: scorePct, status } = computeScoreAndStatus(
    answers,
    payload.score_pct,
    payload.status
  );

  const { data: auth } = await supabase.auth.getUser();
  const auditor = auth?.user?.id ?? null;

  const row = {
    // calendar bucketing
    week_start: payload.week_start || weekStartSundayYMD(),

    // timestamps (optional column; safe because of fallback)
    occurred_at: payload.occurred_at || new Date().toISOString(),

    // basics
    post: payload.post ?? null,
    shift: normalizeShift(payload.shift) ?? null,

    supervisor: payload.supervisor ?? null,
    supervisor_id: payload.supervisor_id ?? null, // optional
    auditor,

    // guard linkage (optional in some schemas)
    guard_id: payload.guard_id ?? null,
    guard_name: payload.guard_name ?? null,

    // details
    answers,
    section_notes: payload.section_notes || {},
    notes: payload.notes || null,
    attachments: payload.attachments || [],

    // compatibility: keep both
    score_pct: scorePct,
    score: scorePct,

    // enums
    status, // 'pass' | 'conditional' | 'fail'

    // ✅ tag to distinguish from gate audits forever
    audit_kind: "interior",
  };

  return insertWithMissingColumnFallback("interior_post_audits", row);
}

/* ------------------ Weekly summary (smart, with averages) ------------- */
function rollupFromRaw(rows = []) {
  const init = () => ({
    bucket: "all",
    audits_total: 0,
    passes: 0,
    fails: 0,
    conditionals: 0,
    pass_rate: 0,
    avg_score_pct: null,
    _sum: 0,
    _n: 0,
  });

  const agg = {
    all: init(),
    day: { ...init(), bucket: "day" },
    night: { ...init(), bucket: "night" },
  };

  for (const r of rows) {
    const bucket =
      r.shift === "night" ? "night" : r.shift === "day" ? "day" : "all";
    for (const bk of ["all", bucket]) {
      const a = agg[bk];
      a.audits_total += 1;
      if (r.status === "pass") a.passes += 1;
      else if (r.status === "conditional") a.conditionals += 1;
      else if (r.status === "fail") a.fails += 1;

      const s = toScore(r);
      if (s != null) {
        a._sum += s;
        a._n += 1;
      }
    }
  }

  for (const key of ["all", "day", "night"]) {
    const a = agg[key];
    const denom = a.passes + a.fails; // pass rate ignores conditionals
    a.pass_rate = denom ? Math.round((a.passes / denom) * 100) : 0;
    a.avg_score_pct = a._n ? Math.round(a._sum / a._n) : null;
    delete a._sum;
    delete a._n;
  }

  return [agg.all, agg.day, agg.night];
}

/** ✅ Always compute from raw interior rows and exclude anything that looks like gate. */
export async function fetchAuditWeeklySummary(weekStartISO) {
  const selects = [
    "shift, status, score_pct, score, week_start, post, audit_kind, gate_type, lane",
    "shift, status, score_pct, score, week_start, post, audit_kind",
    "shift, status, score_pct, score, week_start, post",
    "shift, status, score_pct, score, week_start",
  ];

  let raw = [];
  let lastErr = null;

  for (const sel of selects) {
    const resp = await supabase
      .from("interior_post_audits")
      .select(sel)
      .eq("week_start", weekStartISO);
    if (!resp.error) {
      raw = resp.data || [];
      break;
    }
    lastErr = resp.error;
  }

  if (!raw && lastErr) throw lastErr;

  // strip any misfiled gate rows
  const filtered = (raw || []).filter((r) => !looksLikeGate(r));
  return rollupFromRaw(filtered);
}

/* ----- 30/90-day guard averages (for Users page fallback) ----- */
/** Interior: exclude gate-like rows, include {avg, n, last} */
export async function fetchInteriorAuditAverages(guardIds = [], days = 30) {
  if (!guardIds.length) return new Map();

  const selects = [
    "guard_id, score_pct, score, occurred_at, created_at, week_start, post, audit_kind, gate_type, lane",
    "guard_id, score_pct, score, occurred_at, created_at, week_start, post, audit_kind",
    "guard_id, score_pct, score, occurred_at, created_at, week_start, post",
    "guard_id, score_pct, score, occurred_at, created_at, week_start",
  ];

  let data = [];
  for (const sel of selects) {
    const resp = await supabase
      .from("interior_post_audits")
      .select(sel)
      .in("guard_id", guardIds);
    if (!resp.error) {
      data = resp.data || [];
      break;
    }
  }

  const rows = (data || []).filter((r) => !looksLikeGate(r));
  return buildAgg(rows, days);
}

/* ==========================  GATE AUDIT ADDITIONS  ========================== */
/* ----------------------------- Create TRUCK/GATE audit ----------------------- */
/**
 * payload: same shape as createAudit, plus optional:
 * - gate_type (e.g., "Inbound" | "Outbound")
 * - lane (optional lane label/number)
 * Writes to `truck_gate_audits`. If that table isn't present yet, falls back
 * to `interior_post_audits` with post = gate_type (and audit_kind = "gate").
 */
export async function createTruckGateAudit(payload) {
  const { pct, status } = computeScoreAndStatus(
    payload.answers,
    payload.score_pct,
    payload.status
  );

  const { data: auth } = await supabase.auth.getUser();
  const auditor = auth?.user?.id ?? null;

  const baseRow = {
    week_start: payload.week_start || weekStartSundayYMD(),
    occurred_at: payload.occurred_at || new Date().toISOString(),

    // basics
    post: payload.post || payload.gate_type || null,
    gate_type: payload.gate_type ?? null,
    lane: payload.lane ?? null,
    shift: normalizeShift(payload.shift) ?? null,

    supervisor: payload.supervisor ?? null,
    supervisor_id: payload.supervisor_id ?? null,
    auditor,

    // guard
    guard_id: payload.guard_id ?? null,
    guard_name: payload.guard_name ?? null,

    // details
    answers: payload.answers || {},
    section_notes: payload.section_notes || {},
    notes: payload.notes || null,
    attachments: payload.attachments || [],

    // scoring
    score_pct: pct,
    score: pct,
    status,

    audit_kind: "gate",
  };

  // First try the dedicated gate table
  try {
    return await insertWithMissingColumnFallback("truck_gate_audits", baseRow);
  } catch (e) {
    const msg = String(e?.message || "");
    // If table doesn't exist, fall back to interior_post_audits
    if (
      /relation .* does not exist/i.test(msg) ||
      /table .* does not exist/i.test(msg)
    ) {
      return insertWithMissingColumnFallback("interior_post_audits", baseRow);
    }
    throw e;
  }
}

/** Gate weekly summary; tries a view, then gate tables, then interior fallback. */
export async function fetchGateAuditWeeklySummary(weekStartISO) {
  // 1) Try a materialized/SQL view if present
  try {
    const resp = await supabase
      .from("truck_gate_audits_weekly")
      .select("*")
      .eq("week_start", weekStartISO);

    const data = resp.data || [];
    const needsAvg = data.length && data.every((r) => r.avg_score_pct == null);
    if (!resp.error && data.length && !needsAvg) return data; // fast path
  } catch {
    // ignore; fall back to raw computation
  }

  // 2) Try the dedicated base tables
  try {
    const pick = (table) =>
      supabase
        .from(table)
        .select("shift, status, score_pct, score, week_start");

    const [tga, ga] = await Promise.all([
      pick("truck_gate_audits"),
      pick("gate_audits"),
    ]);

    const combined = []
      .concat(tga?.data || [])
      .concat(ga?.data || [])
      .filter((r) => r?.week_start === weekStartISO);

    if (combined.length) return rollupFromRaw(combined);
  } catch {
    // ignore; fall through to final fallback
  }

  // 3) Final fallback: use interior_post_audits rows that look like gate audits
  const r3 = await supabase
    .from("interior_post_audits")
    .select(
      "shift, status, score_pct, score, week_start, post, audit_kind, gate_type, lane"
    )
    .eq("week_start", weekStartISO);

  const onlyGateLike = (r3.data || []).filter((r) => looksLikeGate(r));
  return rollupFromRaw(onlyGateLike);
}

/* Back-compat alias (some UIs might still import the old name) */
export const fetchTruckGateWeeklySummary = fetchGateAuditWeeklySummary;

/* ----- Guard averages for Gate audits (counts + last) ----- */
export async function fetchGateAuditAverages(guardIds = [], days = 30) {
  if (!guardIds.length) return new Map();

  // Try dedicated tables first (both, merged)
  try {
    const pick = (table) =>
      supabase
        .from(table)
        .select(
          "guard_id, score_pct, score, occurred_at, created_at, week_start"
        )
        .in("guard_id", guardIds);

    const [tga, ga] = await Promise.all([
      pick("truck_gate_audits"),
      pick("gate_audits"),
    ]);

    const rows = [].concat(tga?.data || []).concat(ga?.data || []);

    if (rows.length) return buildAgg(rows, days);
  } catch {
    // fall through to interior fallback
  }

  // Fallback: use interior table for rows that look like gate
  const { data } = await supabase
    .from("interior_post_audits")
    .select(
      "guard_id, score_pct, score, occurred_at, created_at, week_start, post, audit_kind, gate_type, lane"
    )
    .in("guard_id", guardIds);

  const rows = (data || []).filter((r) => looksLikeGate(r));
  return buildAgg(rows, days);
}
