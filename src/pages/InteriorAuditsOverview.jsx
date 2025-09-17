// src/pages/InteriorAuditsOverview.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { fetchAuditWeeklySummary, isGateAuditRow } from "../lib/audits";

/* ---------------- Local date helpers (no UTC drift) ---------------- */
const fromISODateLocal = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toISODateLocal = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const weekStartSunday = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
};
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  x.setHours(0, 0, 0, 0);
  return x;
};
const fmtRange = (sISO, eISO) =>
  fromISODateLocal(sISO).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
  }) +
  " – " +
  fromISODateLocal(eISO).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

export default function InteriorAuditsOverview() {
  // week controls (Sun→Sat) in local time
  const latestWeekStartISO = useMemo(
    () => toISODateLocal(weekStartSunday(new Date())),
    []
  );
  const [weekStartISO, setWeekStartISO] = useState(latestWeekStartISO);
  const weekEndISO = useMemo(
    () => toISODateLocal(addDays(fromISODateLocal(weekStartISO), 6)),
    [weekStartISO]
  );
  const rangeText = useMemo(
    () => `${fmtRange(weekStartISO, weekEndISO)} (Sun → Sat)`,
    [weekStartISO, weekEndISO]
  );
  const canNext =
    fromISODateLocal(weekStartISO) < fromISODateLocal(latestWeekStartISO);
  const goPrev = () =>
    setWeekStartISO(
      toISODateLocal(addDays(fromISODateLocal(weekStartISO), -7))
    );
  const goNext = () =>
    canNext &&
    setWeekStartISO(
      toISODateLocal(addDays(fromISODateLocal(weekStartISO), +7))
    );
  const goLatest = () => setWeekStartISO(latestWeekStartISO);

  // data
  const [summary, setSummary] = useState([]);
  const [weeklyAudits, setWeeklyAudits] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [listError, setListError] = useState("");

  const refreshWeek = async () => {
    setSummary(await fetchAuditWeeklySummary(weekStartISO));
    setListError("");

    // Try richer shapes first (to pick up audit_kind / gate hints), then fall back
    const shapes = [
      "id, created_at, week_start, supervisor, post, shift, score_pct, status, guard_id, guard_name, audit_kind, gate_type, lane",
      "id, created_at, week_start, supervisor, post, shift, score_pct, status, guard_id, guard_name, audit_kind",
      "id, created_at, week_start, supervisor, post, shift, score_pct, status, guard_id, guard_name",
      "id, created_at, week_start, supervisor, post, shift, score_pct, status, guard_id",
    ];

    let rows = [];
    let lastErr = null;

    for (const sel of shapes) {
      const resp = await supabase
        .from("interior_post_audits")
        .select(sel)
        .eq("week_start", weekStartISO)
        .order("created_at", { ascending: false });

      if (!resp.error) {
        rows = resp.data || [];
        break;
      }
      lastErr = resp.error;
      // keep looping if it's a "column does not exist" error; otherwise stop
      if (!/does not exist/i.test(resp.error.message)) {
        break;
      }
    }

    if (!rows && lastErr) {
      setListError(lastErr.message || "Failed to load audits.");
      rows = [];
    }

    // 🔒 Filter out any gate-looking rows that might have been misfiled in this table
    const filtered = (rows || []).filter((r) => !isGateAuditRow(r));

    setWeeklyAudits(
      filtered.map((r) => ({ ...r, _when: r.created_at || r.week_start }))
    );

    // leaderboard (based on filtered interior-only rows)
    const by = new Map();
    for (const r of filtered) {
      const key = r.supervisor || "—";
      const b = by.get(key) || { supervisor: key, audits: 0, total: 0 };
      b.audits += 1;
      if (typeof r.score_pct === "number") b.total += r.score_pct;
      by.set(key, b);
    }
    const lb = [...by.values()].map((x) => ({
      supervisor: x.supervisor,
      audits: x.audits,
      avg: x.audits ? Math.round((x.total / x.audits) * 10) / 10 : null,
    }));
    lb.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.audits - a.audits);
    setLeaderboard(lb);
  };

  useEffect(() => {
    refreshWeek();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStartISO]);

  return (
    <div className="py-6">
      <style>{`
        .frame { border: 1px solid rgba(255,255,255,.08); border-radius: 14px; background: transparent; }
        .frame-accent { height: 6px; background: var(--sdg-gold, #d4af37); border-top-left-radius: 14px; border-top-right-radius: 14px; }
        table thead { position: sticky; top: 0; z-index: 5; }
        table thead th { background: rgba(255,255,255,.04); }
        .dark table thead th { background: rgba(255,255,255,.035); }
      `}</style>

      <div className="container px-4 md:px-6">
        {/* Header / Week controls */}
        <div className="frame overflow-hidden mb-6">
          <div className="frame-accent" />
          <div className="p-5">
            <div className="text-center">
              <h2 className="font-heading text-xl md:text-2xl">
                Interior Post Audits — Overview
              </h2>
              <div className="text-xs md:text-sm mt-1">{rangeText}</div>
            </div>

            <div className="mt-2 flex items-center justify-center gap-2">
              <button
                onClick={goPrev}
                className="px-2 py-1 text-xs rounded-md border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10"
              >
                ← Prev
              </button>
              <button
                onClick={goNext}
                disabled={!canNext}
                className={
                  "px-2 py-1 text-xs rounded-md border border-black/10 dark:border-white/10 " +
                  (canNext
                    ? "hover:bg-black/5 dark:hover:bg-white/10"
                    : "opacity-50 cursor-not-allowed")
                }
              >
                Next →
              </button>
              {weekStartISO !== latestWeekStartISO && (
                <button
                  onClick={goLatest}
                  className="px-2 py-1 text-[11px] rounded-md border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Latest
                </button>
              )}
            </div>

            {/* KPI cards */}
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {["all", "day", "night"].map((bucket) => {
                const row = summary.find((r) => r.bucket === bucket);
                const avg = row?.avg_score_pct ?? null;
                const pr = row?.pass_rate ?? 0;
                return (
                  <div
                    key={bucket}
                    className="rounded-xl border border-black/10 dark:border-white/10 p-3 text-center"
                  >
                    <div className="text-sm font-medium">
                      {bucket === "all"
                        ? "All Shifts"
                        : bucket === "day"
                        ? "Dayshift"
                        : "Nightshift"}
                    </div>
                    <div className="mt-1 text-2xl font-bold">
                      {avg ?? "—"}
                      {avg != null && (
                        <span className="text-base ml-0.5">%</span>
                      )}
                    </div>
                    <div className="text-xs opacity-70 mt-0.5">
                      Pass rate: {pr}%
                    </div>
                    <div className="text-xs opacity-70 mt-1">
                      Total: {row?.audits_total ?? 0} • Pass: {row?.passes ?? 0}{" "}
                      • Cond: {row?.conditionals ?? 0} • Fail: {row?.fails ?? 0}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* This Week’s Audits */}
        <div className="rounded-xl border border-black/10 dark:border-white/10 p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium">This Week’s Audits</h3>
            <div className="text-xs text-sdg-slate">
              {weeklyAudits.length} audits
            </div>
          </div>
          {listError && (
            <div className="mb-2 text-[12px] rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900 dark:bg-amber-900/20 dark:text-amber-100 dark:border-amber-700/40">
              {listError}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left">Date/Time</th>
                  <th className="px-3 py-2 text-left">Supervisor</th>
                  <th className="px-3 py-2 text-left">Guard</th>
                  <th className="px-3 py-2 text-left">Post</th>
                  <th className="px-3 py-2 text-left">Shift</th>
                  <th className="px-3 py-2 text-left">Score</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/10">
                {weeklyAudits.length === 0 ? (
                  <tr>
                    <td className="px-3 py-2 text-sdg-slate" colSpan={7}>
                      No audits this week yet.
                    </td>
                  </tr>
                ) : (
                  weeklyAudits.map((r) => {
                    const when = r._when
                      ? new Date(r._when).toLocaleString()
                      : "—";
                    return (
                      <tr key={r.id}>
                        <td className="px-3 py-2 whitespace-nowrap">{when}</td>
                        <td className="px-3 py-2">{r.supervisor || "—"}</td>
                        <td className="px-3 py-2">
                          {r.guard_name || r.guard_id}
                        </td>
                        <td className="px-3 py-2">{r.post}</td>
                        <td className="px-3 py-2 capitalize">{r.shift}</td>
                        <td className="px-3 py-2">
                          {r.score_pct == null ? "—" : `${r.score_pct}%`}
                        </td>
                        <td className="px-3 py-2 capitalize">
                          {r.status || "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Supervisor Leaderboard */}
        <div className="rounded-xl border border-black/10 dark:border-white/10 p-3">
          <h3 className="font-medium mb-2">
            Supervisor Leaderboard (This Week)
          </h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left">Supervisor</th>
                  <th className="px-3 py-2 text-left">Audits</th>
                  <th className="px-3 py-2 text-left">Avg Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/10">
                {leaderboard.length === 0 ? (
                  <tr>
                    <td className="px-3 py-2 text-sdg-slate" colSpan={3}>
                      No data yet.
                    </td>
                  </tr>
                ) : (
                  leaderboard.map((r, i) => (
                    <tr key={`${r.supervisor}-${i}`}>
                      <td className="px-3 py-2">{r.supervisor}</td>
                      <td className="px-3 py-2">{r.audits}</td>
                      <td className="px-3 py-2">
                        {r.avg == null ? "—" : `${r.avg}%`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
