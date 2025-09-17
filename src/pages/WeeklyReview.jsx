// src/pages/WeeklyReview.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { downloadCSV } from "../lib/csv";

/* ---------------------------------------------------------------------- */
/* Config                                                                 */
/* ---------------------------------------------------------------------- */
const UI_KEY = "weeklyReview.ui.wide.v3";
const FILTERS_KEY = "weeklyReview.filters.v1";
const DEFAULT_TZ = "America/New_York"; // set to null to use browser TZ
const REQUIRES_DOCS = new Set(["callout", "early_departure"]);

/** Alert thresholds */
const RISK = Object.freeze({
  HIGH_SCORE: 18,
  HIGH_CALLOUTS: 2,
  HIGH_DOCS_NP: 2,
  TREND_WEEKS: 4,
  HIGH_TREND: 1.6,
  MOD_SCORE: 10,
  MOD_TREND: 1.25,
});

/* ---------------------------------------------------------------------- */
/* Date helpers                                                           */
/* ---------------------------------------------------------------------- */
const pad = (n) => String(n).padStart(2, "0");
const formatLocalYMD = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function startOfDayUTC(localYMD) {
  const [y, m, d] = localYMD.split("-").map(Number);
  const local = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  return new Date(
    Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), 0, 0, 0, 0)
  ).toISOString();
}
function endOfDayUTC(localYMD) {
  const [y, m, d] = localYMD.split("-").map(Number);
  const local = new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
  return new Date(
    Date.UTC(
      local.getFullYear(),
      local.getMonth(),
      local.getDate(),
      23,
      59,
      59,
      999
    )
  ).toISOString();
}

/** Sun–Sat for the week containing "today", in chosen tz. */
function currentWeekRange(today = new Date(), tz = DEFAULT_TZ) {
  let t = today;
  if (tz) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(today);
    const y = +parts.find((p) => p.type === "year").value;
    const m = +parts.find((p) => p.type === "month").value;
    const d = +parts.find((p) => p.type === "day").value;
    t = new Date(y, m - 1, d);
  }
  const dow = t.getDay(); // 0=Sun
  const start = new Date(t);
  start.setDate(t.getDate() - dow);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}
function longRangeLabel(start, end) {
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

/* ---------------------------------------------------------------------- */
/* Small UI                                                               */
/* ---------------------------------------------------------------------- */
function Badge({ tone = "slate", children, className = "" }) {
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
const Th = (p) => (
  <th
    {...p}
    className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-sdg-slate ${
      p.className || ""
    }`}
  >
    {p.children}
  </th>
);
const Td = (p) => (
  <td {...p} className={`px-3 py-2 align-top ${p.className || ""}`}>
    {p.children}
  </td>
);

/* ---------------------------------------------------------------------- */
/* Aggregation utils                                                      */
/* ---------------------------------------------------------------------- */
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const groupBy = (arr, keyFn) => {
  const m = new Map();
  for (const x of arr) m.set(keyFn(x), (m.get(keyFn(x)) || []).concat(x));
  return m;
};
const sum = (arr, sel = (x) => x) =>
  arr.reduce((a, b) => a + (+sel(b) || 0), 0);

/** Status logic (supports `voided` and `status='void'`) */
function effectiveStatus(row) {
  const s = (row.status || "").toLowerCase().trim();
  const isVoid =
    s === "void" ||
    s.startsWith("void") ||
    row.is_void === true ||
    !!row.voided;
  return isVoid ? "void" : row.status || "open";
}
const stripVoids = (rows) =>
  (rows || []).filter((r) => effectiveStatus(r) !== "void");

/** Guard score */
function computeGuardScores(rows) {
  const byGuard = groupBy(rows, (r) => r.guards?.full_name || "—");
  const out = [];
  for (const [guard, list] of byGuard.entries()) {
    const callouts = list.filter(
      (r) => r.violation_types?.slug === "callout"
    ).length;
    const early = list.filter(
      (r) => r.violation_types?.slug === "early_departure"
    ).length;
    const open = list.filter((r) => effectiveStatus(r) === "open").length;
    const notProvided = list.filter(
      (r) =>
        r.doc_status === "not_provided" ||
        r.doc_status === "pending" ||
        !r.doc_status
    ).length;
    const breach = sum(list, (r) => r.breach_days || 0);
    const score =
      callouts * 3 + early * 2 + open * 2 + notProvided * 2 + breach * 1;
    out.push({
      guard,
      count: list.length,
      callouts,
      early,
      open,
      notProvided,
      breach,
      score,
    });
  }
  out.sort(
    (a, b) =>
      b.score - a.score || b.count - a.count || a.guard.localeCompare(b.guard)
  );
  return out;
}

function kpiFromRows(rows) {
  const total = rows.length;
  const open = rows.filter((r) => effectiveStatus(r) === "open").length;
  const closed = rows.filter((r) => effectiveStatus(r) === "closed").length;
  const callouts = rows.filter(
    (r) => r.violation_types?.slug === "callout"
  ).length;
  const early = rows.filter(
    (r) => r.violation_types?.slug === "early_departure"
  ).length;
  const req = rows.filter((r) =>
    REQUIRES_DOCS.has(r.violation_types?.slug || "")
  );
  const docsProvided = req.filter((r) => r.doc_status === "provided").length;
  const docsNotProvided = req.filter(
    (r) => r.doc_status === "not_provided"
  ).length;
  const docsPending = req.filter(
    (r) => !r.doc_status || r.doc_status === "pending"
  ).length;
  const breachTotal = sum(rows, (r) => r.breach_days || 0);
  const breachAvg = rows.length ? breachTotal / rows.length : 0;
  return {
    total,
    open,
    closed,
    callouts,
    early,
    docsProvided,
    docsNotProvided,
    docsPending,
    breachTotal,
    breachAvg: breachAvg.toFixed(2),
  };
}

function summarizeGuard(list) {
  const callouts = list.filter(
    (r) => r.violation_types?.slug === "callout"
  ).length;
  const early = list.filter(
    (r) => r.violation_types?.slug === "early_departure"
  ).length;
  const open = list.filter((r) => effectiveStatus(r) === "open").length;
  const np = list.filter(
    (r) =>
      r.doc_status === "not_provided" ||
      r.doc_status === "pending" ||
      !r.doc_status
  ).length;
  const breach = sum(list, (r) => r.breach_days || 0);
  const score = callouts * 3 + early * 2 + open * 2 + np * 2 + breach * 1;
  return {
    callouts,
    early,
    open,
    notProvided: np,
    breach,
    score,
    count: list.length,
  };
}

/* ---------------------------------------------------------------------- */
/* Violations data access (with `voided` fallback)                         */
/* ---------------------------------------------------------------------- */
const SELECT_WITH_VOIDED = `
  id, occurred_at,
  shift, post, lane, status, doc_status, voided,
  breach_days, eligible_return_date,
  guards:guards ( id, full_name ),
  violation_types:violation_types ( id, label, slug )
`.trim();

const SELECT_NO_VOIDED = `
  id, occurred_at,
  shift, post, lane, status, doc_status,
  breach_days, eligible_return_date,
  guards:guards ( id, full_name ),
  violation_types:violation_types ( id, label, slug )
`.trim();

async function fetchWindow({ fromISO, toISO }) {
  const base = (select) =>
    supabase
      .from("violations")
      .select(select)
      .gte("occurred_at", fromISO)
      .lte("occurred_at", toISO)
      .order("occurred_at", { ascending: true });

  let resp = await base(SELECT_WITH_VOIDED);
  if (resp.error) {
    if (/column .*voided.* does not exist/i.test(resp.error.message)) {
      resp = await base(SELECT_NO_VOIDED);
    } else {
      throw resp.error;
    }
  }
  return stripVoids(resp.data || []);
}

/* ---------------------------------------------------------------------- */
/* Interior Audits — weekly summary (view OR raw fallback)                */
/* ---------------------------------------------------------------------- */
function gradeFromScore(s) {
  if (s == null || Number.isNaN(+s)) return "unknown";
  if (+s >= 90) return "pass";
  if (+s >= 80) return "conditional";
  return "fail";
}

function buildEmpty() {
  return {
    audits_total: 0,
    passes: 0,
    conditionals: 0,
    fails: 0,
    pass_rate: 0,
    avg_score_pct: null,
  };
}
function finalize(rec) {
  const total = rec.audits_total || 0;
  const passRate = total ? Math.round((rec.passes / total) * 100) : 0;
  const avg = rec._sum && rec._n ? Math.round(rec._sum / rec._n) : null;
  delete rec._sum;
  delete rec._n;
  return { ...rec, pass_rate: passRate, avg_score_pct: avg };
}

async function loadInteriorAuditsWeekly(weekStartYMD) {
  // 1) Try the materialized/SQL view if present
  try {
    const { data, error } = await supabase
      .from("interior_audits_weekly")
      .select(
        "bucket, pass_rate, audits_total, passes, conditionals, fails, avg_score_pct"
      )
      .eq("week_start", weekStartYMD);
    if (error) throw error;
    if (data && data.length) {
      const by = new Map(data.map((r) => [r.bucket, r]));
      return {
        all: by.get("all") || null,
        day: by.get("day") || null,
        night: by.get("night") || null,
      };
    }
  } catch (e) {
    // fall through to raw computation
  }

  // 2) Fallback: compute from raw table (handles older schemas)
  const { data: rows, error: rawErr } = await supabase
    .from("interior_post_audits")
    .select("shift, score_pct, score, status, week_start")
    .eq("week_start", weekStartYMD);

  if (rawErr) throw rawErr;

  const buckets = {
    all: buildEmpty(),
    day: buildEmpty(),
    night: buildEmpty(),
  };

  for (const r of rows || []) {
    const s = Number.isFinite(+r.score_pct)
      ? +r.score_pct
      : Number.isFinite(+r.score)
      ? +r.score
      : null;

    const status = (r.status || "").toLowerCase() || gradeFromScore(s);
    const bkeys = ["all"].concat(r.shift === "night" ? ["night"] : ["day"]);

    for (const bk of bkeys) {
      const rec = buckets[bk];
      rec.audits_total += 1;
      if (status === "pass") rec.passes += 1;
      else if (status === "conditional") rec.conditionals += 1;
      else if (status === "fail") rec.fails += 1;
      if (s != null) {
        rec._sum = (rec._sum || 0) + s;
        rec._n = (rec._n || 0) + 1;
      }
    }
  }

  return {
    all: finalize(buckets.all),
    day: finalize(buckets.day),
    night: finalize(buckets.night),
  };
}

/* ---------------------------------------------------------------------- */
/* Page                                                                    */
/* ---------------------------------------------------------------------- */
export default function WeeklyReview() {
  const [searchParams] = useSearchParams();

  /* ------------------------------ Wide mode ----------------------------- */
  const [wide, setWide] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(UI_KEY) || "true");
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (wide) document.body.classList.add("wide-page");
    else document.body.classList.remove("wide-page");
    return () => document.body.classList.remove("wide-page");
  }, [wide]);
  useEffect(() => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify(wide));
    } catch {}
  }, [wide]);

  /* ------------------------------ Dates -------------------------------- */
  const initial = currentWeekRange(new Date(), DEFAULT_TZ);
  const [startD, setStartD] = useState(initial.start);
  const [endD, setEndD] = useState(initial.end);
  const startYMD = formatLocalYMD(startD);
  const endYMD = formatLocalYMD(endD);

  /* ------------------------------ Filters ------------------------------- */
  const [filters, setFilters] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(FILTERS_KEY) || "{}");
    } catch {
      return {};
    }
  });
  const statusFilter = filters.status ?? "all";
  const docsFilter = filters.docs ?? "all";
  const guardFilter = filters.guard ?? "all";
  const typeFilter = filters.type ?? "all";
  const postFilter = filters.post ?? "all";
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {}
  }, [filters]);

  const resetFilters = () =>
    setFilters({
      status: "all",
      docs: "all",
      guard: "all",
      type: "all",
      post: "all",
    });

  /* ------------------------------- Data --------------------------------- */
  const [rowsRaw, setRowsRaw] = useState([]);
  const [rowsPrev, setRowsPrev] = useState([]);
  const [rowsHistory, setRowsHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  // Interior audit weekly summary (all/day/night)
  const [auditsWk, setAuditsWk] = useState({
    all: null,
    day: null,
    night: null,
  });
  const [auditsErr, setAuditsErr] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const curr = await fetchWindow({
        fromISO: startOfDayUTC(startYMD),
        toISO: endOfDayUTC(endYMD),
      });

      const prevStart = new Date(startD);
      prevStart.setDate(prevStart.getDate() - 7);
      const prevEnd = new Date(endD);
      prevEnd.setDate(prevEnd.getDate() - 7);
      const prev = await fetchWindow({
        fromISO: startOfDayUTC(formatLocalYMD(prevStart)),
        toISO: endOfDayUTC(formatLocalYMD(prevEnd)),
      });

      const histStart = new Date(startD);
      histStart.setDate(histStart.getDate() - 7 * RISK.TREND_WEEKS);
      const histEnd = new Date(startD);
      histEnd.setDate(histEnd.getDate() - 1);
      const history = await fetchWindow({
        fromISO: startOfDayUTC(formatLocalYMD(histStart)),
        toISO: endOfDayUTC(formatLocalYMD(histEnd)),
      });

      setRowsRaw(curr);
      setRowsPrev(prev);
      setRowsHistory(history);

      // Interior audits weekly (view or fallback)
      setAuditsErr("");
      try {
        const wk = await loadInteriorAuditsWeekly(startYMD);
        setAuditsWk(wk);
      } catch (e) {
        setAuditsWk({ all: null, day: null, night: null });
        setAuditsErr(e?.message || "Failed loading audits");
      }
    } catch (e) {
      console.error("WeeklyReview fetch error:", e);
      setRowsRaw([]);
      setRowsPrev([]);
      setRowsHistory([]);
    } finally {
      setLoading(false);
    }
  }, [startYMD, endYMD, startD, endD]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* -------------------------- Guard Alerts ------------------------------ */
  const guardAlerts = useMemo(() => {
    const byGuardThis = groupBy(rowsRaw, (r) => r.guards?.full_name || "—");
    const byGuardHist = groupBy(rowsHistory, (r) => r.guards?.full_name || "—");

    const out = [];
    const byGuardMap = new Map();

    for (const [guard, thisList] of byGuardThis.entries()) {
      const week = summarizeGuard(thisList);
      const histList = byGuardHist.get(guard) || [];
      const baselineAvg = histList.length
        ? summarizeGuard(histList).score / RISK.TREND_WEEKS
        : 0;

      const reasons = [];
      const ratio = baselineAvg > 0 ? week.score / baselineAvg : Infinity;

      if (week.callouts >= RISK.HIGH_CALLOUTS)
        reasons.push(`${week.callouts} callouts`);
      if (week.notProvided >= RISK.HIGH_DOCS_NP)
        reasons.push(`${week.notProvided} docs NP/Pending`);
      if (week.score >= RISK.HIGH_SCORE) reasons.push(`score ${week.score}`);
      if (baselineAvg >= 4 && ratio >= RISK.HIGH_TREND)
        reasons.push(`↑ ${Math.round((ratio - 1) * 100)}% vs 4-wk avg`);

      let level = "none";
      if (reasons.length) level = "high";
      else if (
        week.score >= RISK.MOD_SCORE ||
        (baselineAvg >= 4 && ratio >= RISK.MOD_TREND)
      ) {
        level = "moderate";
        if (baselineAvg >= 4 && ratio >= RISK.MOD_TREND)
          reasons.push(`↑ ${Math.round((ratio - 1) * 100)}% vs 4-wk avg`);
        if (week.score >= RISK.MOD_SCORE) reasons.push(`score ${week.score}`);
      }

      if (level !== "none") {
        const item = {
          guard,
          level,
          reasons,
          score: week.score,
          week,
          baselineAvg,
        };
        out.push(item);
        byGuardMap.set(guard, item);
      }
    }

    out.sort((a, b) => {
      const lv = (x) =>
        x.level === "high" ? 2 : x.level === "moderate" ? 1 : 0;
      return (
        lv(b) - lv(a) || b.score - a.score || a.guard.localeCompare(b.guard)
      );
    });

    return { list: out, map: byGuardMap };
  }, [rowsRaw, rowsHistory]);

  const flaggedGuardsSet = useMemo(
    () => new Set(guardAlerts.list.map((g) => g.guard)),
    [guardAlerts.list]
  );

  // URL params (?guard=...&flagged=true)
  useEffect(() => {
    const g = searchParams.get("guard");
    const fl = searchParams.get("flagged");
    if (g) setFilters((f) => ({ ...f, guard: g }));
    if (fl === "true") setFlaggedOnly(true);
  }, [searchParams, setFilters]);

  /* ---------------------------- Filtered rows --------------------------- */
  const rows = useMemo(() => {
    let out = rowsRaw;

    if (statusFilter !== "all")
      out = out.filter((r) => effectiveStatus(r) === statusFilter);

    if (docsFilter !== "all") {
      out = out.filter((r) => {
        const requires = REQUIRES_DOCS.has(r.violation_types?.slug || "");
        if (!requires) return false;
        if (docsFilter === "provided") return r.doc_status === "provided";
        if (docsFilter === "not_provided")
          return r.doc_status === "not_provided";
        if (docsFilter === "pending")
          return !r.doc_status || r.doc_status === "pending";
        if (docsFilter === "np_or_pending")
          return (
            r.doc_status === "not_provided" ||
            !r.doc_status ||
            r.doc_status === "pending"
          );
        return true;
      });
    }
    if (guardFilter !== "all")
      out = out.filter((r) => r.guards?.full_name === guardFilter);
    if (typeFilter !== "all")
      out = out.filter((r) => r.violation_types?.label === typeFilter);
    if (postFilter !== "all") {
      out = out.filter((r) => {
        const p = r.lane ? `${r.post || "—"} • Lane ${r.lane}` : r.post || "—";
        return p === postFilter;
      });
    }
    if (flaggedOnly)
      out = out.filter((r) => flaggedGuardsSet.has(r.guards?.full_name || ""));

    return out;
  }, [
    rowsRaw,
    statusFilter,
    docsFilter,
    guardFilter,
    typeFilter,
    postFilter,
    flaggedOnly,
    flaggedGuardsSet,
  ]);

  /* ------------------------------ Aggregates ---------------------------- */
  const kpis = useMemo(() => kpiFromRows(rows), [rows]);
  const kpisPrev = useMemo(() => kpiFromRows(rowsPrev), [rowsPrev]);

  const deltas = useMemo(() => {
    const diff = (a, b) => (a ?? 0) - (b ?? 0);
    return {
      total: diff(kpis.total, kpisPrev.total),
      open: diff(kpis.open, kpisPrev.open),
      closed: diff(kpis.closed, kpisPrev.closed),
      callouts: diff(kpis.callouts, kpisPrev.callouts),
      early: diff(kpis.early, kpisPrev.early),
      docsProvided: diff(kpis.docsProvided, kpisPrev.docsProvided),
      docsNotProvided: diff(kpis.docsNotProvided, kpisPrev.docsNotProvided),
      docsPending: diff(kpis.docsPending, kpisPrev.docsPending),
      breachTotal: diff(kpis.breachTotal, kpisPrev.breachTotal),
    };
  }, [kpis, kpisPrev]);

  const byType = useMemo(() => {
    const m = groupBy(rows, (r) => r.violation_types?.label || "Other");
    const entries = [...m.entries()].map(([type, list]) => ({
      type,
      count: list.length,
      open: list.filter((r) => effectiveStatus(r) === "open").length,
      docsNP: list.filter(
        (r) =>
          REQUIRES_DOCS.has(r.violation_types?.slug || "") &&
          (r.doc_status === "not_provided" ||
            !r.doc_status ||
            r.doc_status === "pending")
      ).length,
    }));
    entries.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
    return entries;
  }, [rows]);

  const guardScoresAll = useMemo(() => computeGuardScores(rows), [rows]);

  const byPost = useMemo(() => {
    const m = groupBy(rows, (r) =>
      r.lane ? `${r.post || "—"} • Lane ${r.lane}` : r.post || "—"
    );
    const list = [...m.entries()].map(([post, list]) => ({
      post,
      count: list.length,
      callouts: list.filter((r) => r.violation_types?.slug === "callout")
        .length,
      early: list.filter((r) => r.violation_types?.slug === "early_departure")
        .length,
    }));
    list.sort((a, b) => b.count - a.count || a.post.localeCompare(b.post));
    return list;
  }, [rows]);

  const byShift = useMemo(() => {
    const m = groupBy(rows, (r) => r.shift || "—");
    return ["day", "night"].map((s) => ({
      shift: s,
      count: (m.get(s) || []).length,
    }));
  }, [rows]);

  const byDow = useMemo(() => {
    const arr = Array.from({ length: 7 }, () => 0);
    rows.forEach((r) => {
      const d = new Date(r.occurred_at);
      arr[d.getDay()] += 1;
    });
    return arr;
  }, [rows]);

  const statusByDay = useMemo(() => {
    const out = Array.from({ length: 7 }, () => ({
      open: 0,
      closed: 0,
      total: 0,
    }));
    rows.forEach((r) => {
      const idx = new Date(r.occurred_at).getDay();
      const st = effectiveStatus(r);
      if (st === "open") out[idx].open++;
      else if (st === "closed") out[idx].closed++;
      out[idx].total++;
    });
    const maxDaily = Math.max(1, ...out.map((x) => x.total));
    return { rows: out, max: maxDaily };
  }, [rows]);

  /* --------------------------------- Export ------------------------------ */
  const exportCSV = () => {
    if (!rows.length) return;
    const items = rows.map((r) => ({
      occurred_at: new Date(r.occurred_at).toLocaleString(),
      guard: r.guards?.full_name ?? "",
      type: r.violation_types?.label ?? "",
      post: r.lane ? `${r.post ?? ""} • lane ${r.lane}` : r.post ?? "",
      shift: r.shift ?? "",
      status: effectiveStatus(r),
      docs: REQUIRES_DOCS.has(r.violation_types?.slug || "")
        ? r.doc_status ?? "pending"
        : "N/A",
      breach_days: r.breach_days ?? "",
      eligible_return_date: r.eligible_return_date ?? "",
      id: r.id,
    }));
    downloadCSV(
      `weekly_review_${formatLocalYMD(startD)}_to_${formatLocalYMD(endD)}.csv`,
      items
    );
  };

  const exportAlertsCSV = () => {
    if (!guardAlerts.list.length) return;
    const items = guardAlerts.list.map((g) => ({
      guard: g.guard,
      level: g.level,
      score_this_week: g.week.score,
      baseline_4wk_avg: Math.round(g.baselineAvg * 100) / 100,
      reasons: g.reasons.join("; "),
      callouts: g.week.callouts,
      docs_np_or_pending: g.week.notProvided,
      open_cases: g.week.open,
      early_departures: g.week.early,
      breach_days: g.week.breach,
    }));
    downloadCSV(`guard_alerts_${formatLocalYMD(startD)}.csv`, items);
  };

  /* --------------------------------- UI ---------------------------------- */
  const contentWidth = wide ? "max-w-none" : "max-w-[1600px]";
  const contentPad = wide ? "px-4 md:px-6" : "px-2 md:px-4";
  const maxCount = Math.max(1, ...byDow);
  const barW = (n) => `${Math.round((n / maxCount) * 100)}%`;

  const wowBadge = (n) =>
    n === 0 ? (
      <span className="text-xs text-sdg-slate ml-1">±0</span>
    ) : n > 0 ? (
      <span className="text-xs text-emerald-700 dark:text-emerald-300 ml-1">
        ▲{n}
      </span>
    ) : (
      <span className="text-xs text-rose-700 dark:text-rose-300 ml-1">
        ▼{Math.abs(n)}
      </span>
    );

  const AuditsStat = ({ label, rec }) => (
    <div className="panel p-4 text-center">
      <div className="text-xs text-sdg-slate">{label}</div>
      <div className="text-2xl font-semibold">
        {rec?.avg_score_pct != null ? (
          <>
            {Math.round(rec.avg_score_pct)}
            <span className="text-base ml-0.5">%</span>
          </>
        ) : (
          "—"
        )}
      </div>
      <div className="text-xs text-sdg-slate mt-1">
        {rec ? (
          <>
            Pass rate {Math.round(rec.pass_rate ?? 0)}% • Total:{" "}
            {rec.audits_total ?? 0} • P: {rec.passes ?? 0} • C:{" "}
            {rec.conditionals ?? 0} • F: {rec.fails ?? 0}
          </>
        ) : (
          "No audits"
        )}
      </div>
    </div>
  );

  return (
    <div className="py-8">
      {/* --- Dark-mode polish ------------------------------------------------ */}
      <style>{`
        .panel { border-radius: 1rem; border: 1px solid rgba(0,0,0,.08); background: rgba(255,255,255,.6); }
        .dark .panel { border-color: rgba(255,255,255,.10); background: rgba(255,255,255,.05); }
        .frame-accent { height: 3px; background: linear-gradient(90deg, #f6c667, #d29a3d); }

        .wide-page .container, .wide-page .mx-auto, .wide-page [class*="max-w-"] { max-width: 100% !important; }

        /* Inputs (light) */
        select, input[type="text"], input[type="date"] {
          background-color: #ffffff;
          color: #0f172a;
          border-color: rgba(0,0,0,0.12);
        }
        select:focus, input[type="text"]:focus, input[type="date"]:focus {
          outline: none;
          box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.35);
          border-color: rgba(251, 191, 36, 0.8);
        }

        /* Inputs (dark) */
        .dark select, .dark input[type="text"], .dark input[type="date"] {
          background-color: #151a1e !important;
          color: #e5e7eb !important;
          border-color: rgba(255,255,255,0.12) !important;
        }
        .dark select option, .dark select optgroup { background-color: #0f1215; color: #e5e7eb; }
        .dark input[type="date"]::-webkit-calendar-picker-indicator {
          filter: invert(1) brightness(1.2) contrast(1.1);
          opacity: .95;
        }

        /* Custom chevron for selects (light/dark) */
        select {
          appearance: none; -webkit-appearance: none;
          padding-right: 2rem;
          background-position: right .6rem center;
          background-repeat: no-repeat;
          background-size: 1rem;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%230f172a'><path d='M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.25 8.29a.75.75 0 01-.02-1.08z'/></svg>");
        }
        .dark select {
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23e5e7eb'><path d='M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.25 8.29a.75.75 0 01-.02-1.08z'/></svg>");
        }

        /* Sticky tools background for both modes */
        .sticky-tools { position: sticky; top: 0; z-index: 30; backdrop-filter: blur(4px); background: color-mix(in srgb, var(--tool-bg, #ffffff) 72%, transparent); }
        .dark .sticky-tools { --tool-bg: #0f1215; }

        .dot { width: .5rem; height: .5rem; border-radius: 999px; }
        .dot-high { background: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,.15); }
        .dot-mod  { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.15); }

        @media print { .no-print { display: none !important; } body { background: white; } }
      `}</style>

      <div className={`mx-auto ${contentWidth} ${contentPad}`}>
        {/* Header */}
        <header className="mb-4 flex items-start gap-3">
          <div>
            <h1 className="font-heading text-2xl md:text-3xl">Weekly Review</h1>
            <p className="text-sdg-slate dark:text-white/70">
              {longRangeLabel(startD, endD)} &nbsp;•&nbsp; (
              {days[startD.getDay()]}–{days[endD.getDay()]})
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 no-print">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={wide}
                onChange={(e) => setWide(e.target.checked)}
              />
              <span>Wide Mode</span>
            </label>
            <button className="btn btn-ghost" onClick={() => window.print()}>
              Print
            </button>
            <button className="btn btn-ghost" onClick={exportCSV}>
              Export CSV
            </button>
            <button className="btn btn-ghost" onClick={exportAlertsCSV}>
              Export Alerts
            </button>
          </div>
        </header>

        {/* Controls (sticky) */}
        <section className="frame overflow-hidden no-print mb-4 sticky-tools rounded-xl border border-black/10 dark:border-white/10">
          <div className="frame-accent" />
          <div className="p-4 flex flex-wrap items-center gap-3">
            <button
              className="btn btn-ghost"
              onClick={() => {
                const s = new Date(startD);
                s.setDate(s.getDate() - 7);
                const e = new Date(endD);
                e.setDate(e.getDate() - 7);
                setStartD(s);
                setEndD(e);
              }}
            >
              ‹ Prev week
            </button>

            {/* Date range container — fixed dark bg */}
            <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white/60 dark:bg-white/5 p-3.5 flex-1">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="min-w-[16rem] md:max-w-[22rem]">
                  <label className="block text-sm font-medium text-sdg-slate mb-1">
                    Start (Sun)
                  </label>
                  <input
                    type="date"
                    className="w-full rounded-md border px-3 py-2"
                    value={formatLocalYMD(startD)}
                    onChange={(e) => {
                      const d = new Date(e.target.value);
                      const sun = new Date(d);
                      sun.setDate(d.getDate() - d.getDay());
                      const sat = new Date(sun);
                      sat.setDate(sun.getDate() + 6);
                      setStartD(sun);
                      setEndD(sat);
                    }}
                  />
                </div>
                <div className="min-w-[16rem] md:max-w-[22rem]">
                  <label className="block text-sm font-medium text-sdg-slate mb-1">
                    End (Sat)
                  </label>
                  <input
                    type="date"
                    className="w-full rounded-md border px-3 py-2"
                    value={formatLocalYMD(endD)}
                    onChange={(e) => {
                      const d = new Date(e.target.value);
                      const sat = new Date(d);
                      sat.setDate(d.getDate() + (6 - d.getDay()));
                      const sun = new Date(sat);
                      sun.setDate(sat.getDate() - 6);
                      setStartD(sun);
                      setEndD(sat);
                    }}
                  />
                </div>
              </div>
            </div>

            <button
              className="btn btn-ghost"
              onClick={() => {
                const s = new Date(startD);
                s.setDate(s.getDate() + 7);
                const e = new Date(endD);
                e.setDate(e.getDate() + 7);
                setStartD(s);
                setEndD(e);
              }}
            >
              Next week ›
            </button>

            <div className="ml-auto text-sm text-sdg-slate">
              {loading ? "Loading…" : `${rows.length} violations`}
            </div>
          </div>

          {/* Filter row */}
          <div className="px-4 pb-4 grid gap-3 md:grid-cols-6">
            <div>
              <label className="block text-sm font-medium text-sdg-slate mb-1">
                Status
              </label>
              <select
                className="w-full rounded-md border"
                value={statusFilter}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, status: e.target.value }))
                }
              >
                <option value="all">All</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-sdg-slate mb-1">
                Docs
              </label>
              <select
                className="w-full rounded-md border"
                value={docsFilter}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, docs: e.target.value }))
                }
              >
                <option value="all">All</option>
                <option value="provided">Provided</option>
                <option value="not_provided">Not Provided</option>
                <option value="pending">Pending</option>
                <option value="np_or_pending">Not Provided or Pending</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-sdg-slate mb-1">
                Guard
              </label>
              <select
                className="w-full rounded-md border"
                value={guardFilter}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, guard: e.target.value }))
                }
              >
                <option value="all">All</option>
                {[
                  ...new Set(
                    rowsRaw.map((r) => r.guards?.full_name).filter(Boolean)
                  ),
                ]
                  .sort()
                  .map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-sdg-slate mb-1">
                Type
              </label>
              <select
                className="w-full rounded-md border"
                value={typeFilter}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, type: e.target.value }))
                }
              >
                <option value="all">All</option>
                {[
                  ...new Set(
                    rowsRaw.map((r) => r.violation_types?.label).filter(Boolean)
                  ),
                ]
                  .sort()
                  .map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-sdg-slate mb-1">
                Post / Lane
              </label>
              <select
                className="w-full rounded-md border"
                value={postFilter}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, post: e.target.value }))
                }
              >
                <option value="all">All</option>
                {[
                  ...new Set(
                    rowsRaw.map((r) =>
                      r.lane
                        ? `${r.post || "—"} • Lane ${r.lane}`
                        : r.post || "—"
                    )
                  ),
                ]
                  .sort()
                  .map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex items-center gap-3 pt-6">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={flaggedOnly}
                  onChange={(e) => setFlaggedOnly(e.target.checked)}
                />
                <span>Show flagged guards only</span>
              </label>
              <button className="btn btn-ghost ml-auto" onClick={resetFilters}>
                Reset filters
              </button>
            </div>
          </div>
        </section>

        {/* KPI Row */}
        <section className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 mb-4">
          <button
            className="panel p-4 text-left"
            onClick={() => setFilters((f) => ({ ...f }))}
          >
            <div className="text-xs text-sdg-slate">Total Violations</div>
            <div className="text-2xl font-semibold">
              {kpis.total} {wowBadge(deltas.total)}
            </div>
          </button>
          <button
            className="panel p-4 text-left"
            onClick={() => setFilters((f) => ({ ...f, status: "open" }))}
          >
            <div className="text-xs text-sdg-slate">Open</div>
            <div className="text-2xl font-semibold">
              {kpis.open} {wowBadge(deltas.open)}
            </div>
          </button>
          <button
            className="panel p-4 text-left"
            onClick={() => setFilters((f) => ({ ...f, status: "closed" }))}
          >
            <div className="text-xs text-sdg-slate">Closed</div>
            <div className="text-2xl font-semibold">
              {kpis.closed} {wowBadge(deltas.closed)}
            </div>
          </button>
          <button
            className="panel p-4 text-left"
            onClick={() => setFilters((f) => ({ ...f, type: "Callout" }))}
          >
            <div className="text-xs text-sdg-slate">Callouts</div>
            <div className="text-2xl font-semibold">
              {kpis.callouts} {wowBadge(deltas.callouts)}
            </div>
          </button>
          <button
            className="panel p-4 text-left"
            onClick={() =>
              setFilters((f) => ({ ...f, type: "Early Departure from Shift" }))
            }
          >
            <div className="text-xs text-sdg-slate">Early Departs</div>
            <div className="text-2xl font-semibold">
              {kpis.early} {wowBadge(deltas.early)}
            </div>
          </button>
          <div className="panel p-4">
            <div className="text-xs text-sdg-slate">Breach Days (avg)</div>
            <div className="text-2xl font-semibold">
              {kpis.breachTotal}{" "}
              <span className="text-base text-sdg-slate">
                ({kpis.breachAvg})
              </span>
            </div>
          </div>
        </section>

        {/* Interior Audits — WEEKLY summary */}
        <section className="panel p-6 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Interior Audits (Weekly)</h2>
            <div className="text-xs text-sdg-slate">
              Week of {formatLocalYMD(startD)} (Sun–Sat)
            </div>
          </div>

          {auditsErr ? (
            <div className="text-sm text-red-600">
              {auditsErr}. If you use the view{" "}
              <code>interior_audits_weekly</code>, ensure it exists; otherwise
              the page computes this from raw audits.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <AuditsStat label="All Shifts — Avg Score" rec={auditsWk.all} />
                <AuditsStat label="Dayshift — Avg Score" rec={auditsWk.day} />
                <AuditsStat
                  label="Nightshift — Avg Score"
                  rec={auditsWk.night}
                />
              </div>

              <div className="mt-4 text-xs text-sdg-slate">
                Cards show <strong>Average Score</strong>. “Pass rate” counts
                only Pass (Conditionals are excluded from the numerator). Totals
                include Pass / Conditional / Fail.
              </div>
              <div className="mt-3">
                <Link
                  to="/audits/interior"
                  className="rounded-lg border px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
                >
                  Open Interior Audits
                </Link>
              </div>
            </>
          )}
        </section>

        {/* Guard Alerts */}
        <section className="panel p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              className="text-amber-500"
            >
              <path
                fill="currentColor"
                d="M12 7.77L18.39 19H5.61L12 7.77M12 2L1 21h22L12 2m1 14h-2v2h2v-2m0-6h-2v4h2v-4Z"
              />
            </svg>
            <h2 className="font-medium">Guard Alerts</h2>
            <span className="text-sm text-sdg-slate">
              ({guardAlerts.list.length})
            </span>
          </div>
          {!guardAlerts.list.length ? (
            <div className="text-sdg-slate">No alerts for this week.</div>
          ) : (
            <ul className="divide-y">
              {guardAlerts.list.slice(0, 8).map((g) => (
                <li key={g.guard} className="py-2 flex items-start gap-3">
                  <span
                    className={`dot ${
                      g.level === "high" ? "dot-high" : "dot-mod"
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="font-medium">{g.guard}</div>
                    <div className="text-xs text-sdg-slate">
                      {g.reasons.join(" • ")}{" "}
                      <span className="ml-1">
                        (score {g.week.score}, 4-wk avg{" "}
                        {Math.round(g.baselineAvg * 100) / 100})
                      </span>
                    </div>
                  </div>
                  <div className="ml-auto">
                    <Link
                      to={`/hr/violations?guard=${encodeURIComponent(g.guard)}`}
                      className="rounded-lg border px-2.5 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      Review
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Problem Guards + Type Breakdown */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="panel p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-medium">Problem Guards (score)</h2>
              <div className="text-xs text-sdg-slate">
                Highlighted = flagged (High/Moderate)
              </div>
            </div>
            {!rows.length ? (
              <div className="text-sdg-slate">No data.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left">
                    <tr>
                      <Th>Guard</Th>
                      <Th className="text-right">Score</Th>
                      <Th className="text-right">Total</Th>
                      <Th className="text-right">Callouts</Th>
                      <Th className="text-right">Early</Th>
                      <Th className="text-right">Open</Th>
                      <Th className="text-right">Docs NP</Th>
                      <Th className="text-right">Breach</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(flaggedOnly
                      ? guardScoresAll.filter((g) =>
                          flaggedGuardsSet.has(g.guard)
                        )
                      : guardScoresAll
                    )
                      .slice(0, 12)
                      .map((g) => {
                        const alert = guardAlerts.map.get(g.guard);
                        const rowClass =
                          alert?.level === "high"
                            ? "bg-red-50/80 dark:bg-red-900/25"
                            : alert?.level === "moderate"
                            ? "bg-amber-50/80 dark:bg-amber-900/20"
                            : "";
                        return (
                          <tr key={g.guard} className={rowClass}>
                            <Td className="flex items-center gap-2">
                              {alert ? (
                                <span
                                  className={`dot ${
                                    alert.level === "high"
                                      ? "dot-high"
                                      : "dot-mod"
                                  }`}
                                />
                              ) : null}
                              <span>{g.guard}</span>
                            </Td>
                            <Td className="text-right font-medium">
                              {g.score}
                            </Td>
                            <Td className="text-right">{g.count}</Td>
                            <Td className="text-right">{g.callouts}</Td>
                            <Td className="text-right">{g.early}</Td>
                            <Td className="text-right">{g.open}</Td>
                            <Td className="text-right">{g.notProvided}</Td>
                            <Td className="text-right">{g.breach}</Td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel p-6">
            <h2 className="font-medium mb-3">Breakdown by Type</h2>
            {!rows.length ? (
              <div className="text-sdg-slate">No data.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left">
                    <tr>
                      <Th>Type</Th>
                      <Th className="text-right">Count</Th>
                      <Th className="text-right">Open</Th>
                      <Th className="text-right">Docs Not/ Pending</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {byType.map((t) => (
                      <tr key={t.type}>
                        <Td>{t.type}</Td>
                        <Td className="text-right">{t.count}</Td>
                        <Td className="text-right">{t.open}</Td>
                        <Td className="text-right">{t.docsNP}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Post/Lane + Shift */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="panel p-6">
            <h2 className="font-medium mb-3">Top Posts / Lanes</h2>
            {!rows.length ? (
              <div className="text-sdg-slate">No data.</div>
            ) : (
              <ul className="divide-y">
                {byPost.slice(0, 12).map((p) => (
                  <li key={p.post} className="py-2 flex items-center gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.post}</div>
                      <div className="text-xs text-sdg-slate">
                        {p.callouts} callouts • {p.early} early departs
                      </div>
                    </div>
                    <div className="ml-auto font-medium">{p.count}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel p-6">
            <h2 className="font-medium mb-3">By Shift</h2>
            {!rows.length ? (
              <div className="text-sdg-slate">No data.</div>
            ) : (
              <div className="space-y-2">
                {byShift.map((s) => (
                  <div key={s.shift} className="flex items-center gap-3">
                    <div className="w-24 capitalize">{s.shift}</div>
                    <div className="flex-1 h-2 rounded bg-black/10 dark:bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-amber-400/70 dark:bg-amber-300/60"
                        style={{ width: barW(s.count) }}
                      />
                    </div>
                    <div className="w-10 text-right text-sm">{s.count}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Day-of-week + Open/Closed split */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="panel p-6">
            <h2 className="font-medium mb-3">By Day of Week</h2>
            {!rows.length ? (
              <div className="text-sdg-slate">No data.</div>
            ) : (
              <div className="space-y-2">
                {byDow.map((n, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-12">{days[i]}</div>
                    <div className="flex-1 h-2 rounded bg-black/10 dark:bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-amber-400/70 dark:bg-amber-300/60"
                        style={{ width: barW(n) }}
                      />
                    </div>
                    <div className="w-10 text-right text-sm">{n}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel p-6">
            <h2 className="font-medium mb-3">Open vs Closed by Day</h2>
            {!rows.length ? (
              <div className="text-sdg-slate">No data.</div>
            ) : (
              <div className="space-y-3">
                {statusByDay.rows.map((d, i) => {
                  const total = d.total || 1;
                  const trackPct = (d.total / statusByDay.max) * 100;
                  const openPct = (d.open / total) * 100;
                  const closedPct = 100 - openPct;
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-12">{days[i]}</div>
                      <div className="flex-1">
                        <div
                          className="h-2 rounded bg-black/10 dark:bg-white/10 overflow-hidden"
                          style={{ width: `${trackPct}%` }}
                        >
                          <div
                            className="h-full flex"
                            style={{ width: "100%" }}
                          >
                            <div
                              className="h-full"
                              style={{
                                width: `${openPct}%`,
                                background: "rgba(251, 191, 36, .75)",
                              }}
                            />
                            <div
                              className="h-full"
                              style={{
                                width: `${closedPct}%`,
                                background: "rgba(16, 185, 129, .6)",
                              }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="w-16 text-right text-sm tabular-nums">
                        {d.open}/{d.closed}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Raw table */}
        <section className="frame overflow-hidden">
          <div className="frame-accent" />
          <div className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left bg-black/[0.03] dark:bg-white/[0.03]">
                  <tr>
                    <Th>Date/Time</Th>
                    <Th>Guard</Th>
                    <Th>Type</Th>
                    <Th>Post/Lane</Th>
                    <Th>Shift</Th>
                    <Th className="text-center">Docs</Th>
                    <Th className="text-center">Status</Th>
                    <Th className="text-right">Breach/Return</Th>
                    <Th className="text-center">View</Th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loading ? (
                    <tr>
                      <Td colSpan={9} className="p-4 text-sdg-slate">
                        Loading…
                      </Td>
                    </tr>
                  ) : !rows.length ? (
                    <tr>
                      <Td colSpan={9} className="p-4 text-sdg-slate">
                        No violations in this range.
                      </Td>
                    </tr>
                  ) : (
                    rows.map((r) => {
                      const requires = REQUIRES_DOCS.has(
                        r.violation_types?.slug || ""
                      );
                      const st = effectiveStatus(r);
                      const postLane = r.lane
                        ? `${r.post || "—"} • Lane ${r.lane}`
                        : r.post || "—";
                      const alert = guardAlerts.map.get(
                        r.guards?.full_name || ""
                      );
                      const flagged = Boolean(alert);
                      return (
                        <tr
                          key={r.id}
                          className={
                            flagged
                              ? "border-l-4 border-amber-400/70 dark:border-amber-300/60"
                              : ""
                          }
                        >
                          <Td className="whitespace-nowrap">
                            {new Date(r.occurred_at).toLocaleString()}
                          </Td>
                          <Td className="flex items-center gap-2">
                            {flagged ? (
                              <span
                                className={`dot ${
                                  alert.level === "high"
                                    ? "dot-high"
                                    : "dot-mod"
                                }`}
                              />
                            ) : null}
                            {r.guards?.full_name}
                          </Td>
                          <Td>{r.violation_types?.label}</Td>
                          <Td>{postLane}</Td>
                          <Td className="capitalize">{r.shift || "—"}</Td>
                          <Td className="text-center">
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
                                {r.doc_status ?? "pending"}
                              </Badge>
                            ) : (
                              <span className="text-sdg-slate">N/A</span>
                            )}
                          </Td>
                          <Td className="text-center">
                            <Badge
                              tone={
                                st === "open"
                                  ? "amber"
                                  : st === "closed"
                                  ? "green"
                                  : "slate"
                              }
                            >
                              {st}
                            </Badge>
                          </Td>
                          <Td className="text-right">
                            {r.breach_days == null ? (
                              <span className="text-sdg-slate">—</span>
                            ) : (
                              <span>
                                {r.breach_days}d
                                {r.eligible_return_date
                                  ? ` • ${new Date(
                                      r.eligible_return_date
                                    ).toLocaleDateString()}`
                                  : ""}
                              </span>
                            )}
                          </Td>
                          <Td className="text-center">
                            <Link
                              to={`/hr/violations/${r.id}`}
                              className="rounded-lg border px-2.5 py-1 hover:bg-black/5 dark:hover:bg-white/5"
                            >
                              Open
                            </Link>
                          </Td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
