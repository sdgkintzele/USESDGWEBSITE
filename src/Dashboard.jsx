// src/Dashboard.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import AnnouncementForm from "./components/AnnouncementForm";

// ack helpers
import {
  fetchSupervisors,
  fetchAcks,
  fetchMyAckMap,
  fetchAckCounts,
  acknowledgeAnnouncement,
} from "./lib/announcements";

/* ----------------------------- config ----------------------------- */
const SITE_TARGET = 95; // default site-wide target

// Keep the visual order consistent everywhere
const KPI_CATEGORIES = ["interior", "supervisor", "one_network", "yms"];

const CARD_TITLES = {
  interior: "Interior Guard Tour Performance",
  supervisor: "Supervisor Tour Performance",
  one_network: "One Network Percentage",
  yms: "YMS Performance Percentage",
};

/* ----------------------------- helpers ----------------------------- */
const quickLinks = [
  {
    id: "belfry",
    label: "Belfry",
    url: "https://www.belfrysoftware.com/",
    ext: true,
  },
  { id: "yms", label: "YMS", url: "https://bgdc.ymshub.com/login", ext: true },
];

function fmtDate(d, opts = {}) {
  try {
    return new Date(d).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      ...opts,
    });
  } catch {
    return d ?? "";
  }
}
function parseISODateLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return new Date(s);
  const [, y, mo, d] = m.map(Number);
  return new Date(y, mo - 1, d);
}
function ensureDateLocal(d) {
  return typeof d === "string" ? parseISODateLocal(d) : new Date(d);
}
function fmtDateRange(start, end) {
  const s = ensureDateLocal(start);
  const e = ensureDateLocal(end);
  const sameMonth =
    s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const startStr = s.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    ...(sameMonth ? {} : { year: "numeric" }),
  });
  const endStr = e.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return `${startStr} – ${endStr}`;
}
function previousSunday(d) {
  const x = new Date(d);
  const day = x.getDay();
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function toISODate(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function clamp01(n) {
  if (Number.isNaN(+n)) return 0;
  return Math.max(0, Math.min(100, +n));
}
function zoneColor(pct) {
  if (pct >= 90) return "#10b981";
  if (pct >= 85) return "#fbbf24";
  if (pct > 75) return "#f97316";
  return "#ef4444";
}
function classNames(...xs) {
  return xs.filter(Boolean).join(" ");
}

/* ----------------------------- Generic Modal ----------------------------- */
function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => (document.body.style.overflow = original);
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className={classNames(
          "relative w-full rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1E2430] shadow-2xl",
          wide ? "max-w-5xl" : "max-w-2xl"
        )}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-black/10 dark:border-white/10">
          <h3 className="font-heading text-lg">{title || "Dialog"}</h3>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ----------------------------- Links ----------------------------- */
function LinksList({ query, setQuery, filtered }) {
  return (
    <div className="space-y-3">
      <h2 className="font-heading text-lg">Links</h2>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search links…"
        className="w-full rounded-xl border border-sdg-dark/10 dark:border-white/15 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sdg-dark/20 bg-white dark:bg-[#0f1215]"
      />
      <ul className="divide-y divide-sdg-dark/10 dark:divide-white/10">
        {filtered.map((link) => (
          <li key={link.id} className="py-2 flex items-center justify-between">
            <span className="text-sm">{link.label}</span>
            {link.ext ? (
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium hover:underline"
              >
                Open
              </a>
            ) : (
              <Link
                to={link.url}
                className="text-sm font-medium hover:underline"
              >
                Open
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------- Active Breach Board ------------------------- */
function ActiveBreachBoard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const todayISO = toISODate(new Date());
    const { data, error } = await supabase
      .from("violations")
      .select(
        `
        id, eligible_return_date, breach_days, status,
        guards:guards ( id, full_name ),
        violation_types:violation_types ( label )
      `
      )
      .not("eligible_return_date", "is", null)
      .gte("eligible_return_date", todayISO)
      .order("eligible_return_date", { ascending: true })
      .limit(100);

    if (!error) setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRows();
    const ch = supabase
      .channel("rt-breach")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "violations" },
        fetchRows
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [fetchRows]);

  return (
    <div className="frame overflow-hidden h-full">
      <div className="frame-accent" />
      <div className="p-5 bg-white dark:bg-[#1E2430] border border-black/10 dark:border-white/10 rounded-b-2xl">
        <div className="relative flex items-center justify-center">
          <h2 className="font-heading text-xl md:text-2xl text-center">
            Active Breach Board
          </h2>
          <span className="absolute right-0 text-xs text-sdg-slate dark:text-white/60">
            {rows.length} active
          </span>
        </div>
        <p className="text-xs text-sdg-slate dark:text-white/60 text-center mt-1">
          Anyone listed here should not be called in or permitted on duty until
          the return date.
        </p>

        {loading ? (
          <p className="mt-3 text-sm opacity-70">Loading…</p>
        ) : !rows.length ? (
          <p className="mt-3 text-sm opacity-70">No active breaches.</p>
        ) : (
          <ul className="mt-4 divide-y divide-black/5 dark:divide-white/10">
            {rows.map((r) => {
              const remaining =
                Math.max(
                  0,
                  Math.ceil(
                    (new Date(r.eligible_return_date).getTime() -
                      new Date().setHours(0, 0, 0, 0)) /
                      (24 * 60 * 60 * 1000)
                  )
                ) || 0;

              const tone =
                remaining >= 3
                  ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200"
                  : remaining >= 1
                  ? "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100"
                  : "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100";

              return (
                <li
                  key={r.id}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {r.guards?.full_name || "Unknown guard"}
                    </div>
                    <div className="text-xs text-sdg-slate">
                      {r.violation_types?.label || "Violation"} • Return:{" "}
                      {fmtDate(r.eligible_return_date)}
                    </div>
                  </div>
                  <span
                    className={classNames(
                      "rounded-full border px-2.5 py-0.5 text-[12px]",
                      "border-black/10 dark:border-white/10",
                      tone
                    )}
                  >
                    {remaining === 0 ? "Returns Today" : `${remaining} day(s)`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------- Responsive SPEEDOMETER ------------------------- */
function Speedometer({ value, rangeText, size = 320, showRangeText = false }) {
  const pct = clamp01(value);
  const color = zoneColor(pct);
  const W = size;
  const R = Math.max(120, Math.round(W * 0.42));
  const BAND = Math.max(12, Math.round(W * 0.04));
  const CX = W / 2;
  const CY = R + Math.round(W * 0.08);
  const H = CY + Math.round(W * 0.12);

  const t = (p) => Math.PI * (1 - p / 100);
  const pt = (theta) => ({
    x: CX + R * Math.cos(theta),
    y: CY - R * Math.sin(theta),
  });
  const arc = (t0, t1) => {
    const s = pt(t0),
      e = pt(t1);
    const large = t0 - t1 > Math.PI ? 1 : 0;
    return `M ${s.x} ${s.y} A ${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`;
  };

  const eps = ((2 * Math.PI) / 360) * 0.6;
  const T0 = t(0),
    T75 = t(75),
    T85 = t(85),
    T90 = t(90),
    T100 = t(100);
  const needle = t(pct);

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="auto"
        role="img"
        aria-label={`${pct}%`}
        preserveAspectRatio="xMidYMid meet"
      >
        <path
          d={arc(T0, T75 + eps)}
          stroke="#ef4444"
          strokeWidth={BAND}
          fill="none"
        />
        <path
          d={arc(T75 - eps, T85 + eps)}
          stroke="#f97316"
          strokeWidth={BAND}
          fill="none"
        />
        <path
          d={arc(T85 - eps, T90 + eps)}
          stroke="#fbbf24"
          strokeWidth={BAND}
          fill="none"
        />
        <path
          d={arc(T90 - eps, T100)}
          stroke="#10b981"
          strokeWidth={BAND}
          fill="none"
        />
        <g transform={`rotate(${90 - (needle * 180) / Math.PI} ${CX} ${CY})`}>
          <line
            x1={CX}
            y1={CY}
            x2={CX}
            y2={CY - (R - 10)}
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
          />
          <circle cx={CX} cy={CY} r="6" fill={color} />
        </g>
        <text
          x={CX}
          y={CY - 22}
          textAnchor="middle"
          fontWeight="700"
          fontSize="30"
          fill={color}
        >
          {Number.isFinite(pct) ? `${pct.toFixed(0)}%` : "—"}
        </text>
        {showRangeText && (
          <text
            x={CX}
            y={CY + 18}
            textAnchor="middle"
            fontSize="14"
            fill="currentColor"
            opacity="0.85"
          >
            {rangeText}
          </text>
        )}
      </svg>
    </div>
  );
}

/* ---------------- Manager: BULK modal (edit all 4 KPIs at once) ---------------- */
function ManagerBulkUpdateModal({
  open,
  onClose,
  initialWeekStartISO,
  onSaved,
}) {
  const [weekISO, setWeekISO] = useState(initialWeekStartISO);
  const [form, setForm] = useState(() =>
    KPI_CATEGORIES.reduce(
      (m, c) => ({ ...m, [c]: { score: "", notes: "" } }),
      {}
    )
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) setWeekISO(initialWeekStartISO);
  }, [open, initialWeekStartISO]);

  const load = useCallback(async (targetISO) => {
    setLoading(true);
    setErr("");
    try {
      const { data, error } = await supabase
        .from("tour_performance")
        .select("category, score, notes")
        .eq("week_start", targetISO)
        .in("category", KPI_CATEGORIES);

      if (error) throw error;

      const next = KPI_CATEGORIES.reduce((m, c) => {
        const row = (data || []).find((r) => r.category === c);
        return {
          ...m,
          [c]: { score: row?.score ?? "", notes: row?.notes ?? "" },
        };
      }, {});
      setForm(next);
    } catch (e) {
      setErr(e.message || "Failed to load existing values.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && weekISO) load(weekISO);
  }, [open, weekISO, load]);

  const onChangeField = (cat, key, val) =>
    setForm((f) => ({ ...f, [cat]: { ...f[cat], [key]: val } }));

  const handleSave = async () => {
    setSaving(true);
    setErr("");
    try {
      const ws = parseISODateLocal(weekISO);
      const start = toISODate(previousSunday(ws));
      const end = toISODate(addDays(previousSunday(ws), 6));

      const payload = KPI_CATEGORIES.map((category) => ({
        category,
        week_start: start,
        week_end: end,
        score:
          form[category].score === "" || form[category].score === null
            ? null
            : Number(form[category].score),
        notes: form[category].notes || null,
      }));

      const { error } = await supabase
        .from("tour_performance")
        .upsert(payload, { onConflict: "category,week_start" });
      if (error) throw error;
      onSaved?.();
      onClose();
    } catch (e) {
      setErr(e.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const normalizedISO = toISODate(previousSunday(parseISODateLocal(weekISO)));
  const rangeText = fmtDateRange(
    normalizedISO,
    toISODate(addDays(parseISODateLocal(normalizedISO), 6))
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manager: Update Week (All KPIs)"
      wide
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3 items-end">
          <div className="sm:col-span-1">
            <label className="block text-xs font-medium text-sdg-slate mb-1">
              Week (Sunday start)
            </label>
            <input
              type="date"
              value={normalizedISO}
              onChange={(e) =>
                setWeekISO(toISODate(previousSunday(new Date(e.target.value))))
              }
              className="w-full rounded-md border border-black/10 dark:border-white/10 px-2 py-2 bg-white dark:bg-[#0f1215]"
            />
            <div className="text-[11px] opacity-70 mt-1">
              Stored: {rangeText} (Sun → Sat)
            </div>
          </div>
          <div className="sm:col-span-2">
            <div className="text-xs opacity-80">
              Enter % and optional notes for each KPI below.
            </div>
          </div>
        </div>

        {err && (
          <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-xl px-3 py-2">
            {err}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {KPI_CATEGORIES.map((cat) => (
            <div
              key={cat}
              className="rounded-xl border border-black/10 dark:border-white/10 p-3 bg-slate-50/50 dark:bg-[#141a24]"
            >
              <div className="font-medium text-sm mb-2">{CARD_TITLES[cat]}</div>
              <div className="grid grid-cols-3 gap-2 items-end">
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-sdg-slate mb-1">
                    Score
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={form[cat]?.score}
                      onChange={(e) =>
                        onChangeField(cat, "score", e.target.value)
                      }
                      placeholder="e.g., 95"
                      className="w-full rounded-md border border-black/10 dark:border-white/10 px-2 py-2 pr-8 bg-white dark:bg-[#0f1215]"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs opacity-60">
                      %
                    </span>
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-sdg-slate mb-1">
                    Notes (What changed?)
                  </label>
                  <input
                    type="text"
                    value={form[cat]?.notes}
                    onChange={(e) =>
                      onChangeField(cat, "notes", e.target.value)
                    }
                    placeholder="Optional context"
                    className="w-full rounded-md border border-black/10 dark:border-white/10 px-2 py-2 bg-white dark:bg-[#0f1215]"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="btn btn-primary"
          >
            {saving ? "Saving…" : "Save / Update Week"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------- Performance Gauge Card ------------------------- */
function TourGaugeCard({ category, weekStartISO }) {
  const title = CARD_TITLES[category] || "Performance";
  const [row, setRow] = useState(null);
  const [prevRow, setPrevRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [schemaErr, setSchemaErr] = useState("");

  const load = useCallback(
    async (targetISO) => {
      setLoading(true);
      setSchemaErr("");
      try {
        const prevISO = toISODate(addDays(parseISODateLocal(targetISO), -7));
        const { data, error } = await supabase
          .from("tour_performance")
          .select(
            "id, category, week_start, week_end, score, notes, created_at"
          )
          .eq("category", category)
          .in("week_start", [targetISO, prevISO])
          .order("week_start", { ascending: false });
        if (error) throw error;

        const current =
          (data || []).find((d) => d.week_start === targetISO) || null;
        const previous =
          (data || []).find((d) => d.week_start === prevISO) || null;

        setRow(current);
        setPrevRow(previous);
      } catch (err) {
        setRow(null);
        setPrevRow(null);
        const msg =
          err?.code === "42P01"
            ? "Missing table: public.tour_performance"
            : err?.code === "22P02"
            ? `Category "${category}" is not in your tour_category enum.`
            : err?.message || "Failed to load performance.";
        setSchemaErr(msg);
      } finally {
        setLoading(false);
      }
    },
    [category]
  );

  useEffect(() => {
    if (weekStartISO) load(weekStartISO);
  }, [weekStartISO, load]);

  useEffect(() => {
    const ch = supabase
      .channel(`rt-tours-${category}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tour_performance" },
        () => load(weekStartISO)
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [category, weekStartISO, load]);

  const score = Number.isFinite(row?.score) ? clamp01(row?.score) : 0;
  const prevScore = Number.isFinite(prevRow?.score)
    ? clamp01(prevRow?.score)
    : null;
  const delta =
    prevScore == null || row == null ? null : (row.score ?? 0) - prevScore;

  const weekStartDate = parseISODateLocal(weekStartISO);
  const weekEndISO = toISODate(addDays(weekStartDate, 6));
  const rangeText = row
    ? fmtDateRange(row.week_start, row.week_end)
    : fmtDateRange(weekStartISO, weekEndISO);

  const deltaBadge =
    delta == null ? (
      <span className="opacity-70">No prior week</span>
    ) : delta > 0 ? (
      <span className="inline-flex items-center gap-1 text-emerald-700">
        ▲ {Math.abs(delta).toFixed(1)} pts vs last week
      </span>
    ) : delta < 0 ? (
      <span className="inline-flex items-center gap-1 text-red-700">
        ▼ {Math.abs(delta).toFixed(1)} pts vs last week
      </span>
    ) : (
      <span className="opacity-80">No change vs last week</span>
    );

  const targetStatus =
    row && Number.isFinite(row.score) ? (
      row.score >= SITE_TARGET ? (
        <span className="ml-1 text-emerald-700">— On target</span>
      ) : (
        <span className="ml-1 text-amber-700">— Below target</span>
      )
    ) : null;

  return (
    <div className="flex flex-col h-full p-4 rounded-xl">
      <h3 className="font-heading text-base md:text-lg text-center">{title}</h3>

      {schemaErr && (
        <div className="mt-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-xl px-3 py-2 text-center">
          {schemaErr}
        </div>
      )}

      <div className="mt-2 grow flex flex-col">
        {loading ? (
          <div className="mt-6 text-sm opacity-70 text-center">Loading…</div>
        ) : row ? (
          <>
            <Speedometer
              value={score}
              rangeText={rangeText}
              showRangeText={false}
            />
            <div className="mt-3 space-y-1 text-center">
              <div className="text-sm">
                <span className="font-medium">Trend:</span> {deltaBadge}
              </div>
              <div className="text-xs">
                <span className="font-medium">Site target:</span> {SITE_TARGET}%{" "}
                {targetStatus}
              </div>
              <div className="text-xs">
                <span className="font-medium">What changed?</span>{" "}
                {row?.notes ? (
                  <span className="opacity-90">{row.notes}</span>
                ) : (
                  <span className="opacity-60">—</span>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <Speedometer
              value={0}
              rangeText={rangeText}
              showRangeText={false}
            />
            <div className="mt-2 text-xs text-sdg-slate text-center">
              No data for this week.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------- Ack List (modal body) ------------------------- */
function AckList({ announcement, totalSupervisors }) {
  const [rows, setRows] = useState([]);
  const [supers, setSupers] = useState([]);
  useEffect(() => {
    (async () => {
      const [aRows, sRows] = await Promise.all([
        fetchAcks(announcement.id),
        fetchSupervisors(),
      ]);
      setRows(aRows || []);
      setSupers(sRows || []);
    })();
  }, [announcement.id]);

  const ackIds = new Set(rows.map((r) => r.user_id));
  const pending = supers.filter((s) => !ackIds.has(s.id));

  return (
    <div className="space-y-4">
      <div className="text-sm">
        <span className="font-medium">Summary:</span> {rows.length} /{" "}
        {totalSupervisors} acknowledged
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="border border-black/10 dark:border-white/10 rounded-xl p-3 bg-white dark:bg-[#141a24]">
          <div className="font-medium mb-2 text-sm">Acknowledged</div>
          {rows.length ? (
            <ul className="text-sm space-y-1">
              {rows.map((r) => (
                <li key={r.user_id} className="flex justify-between">
                  <span>{r.profiles?.full_name || r.user_id}</span>
                  <span className="opacity-70">
                    {new Date(r.acknowledged_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm opacity-70">—</div>
          )}
        </div>
        <div className="border border-black/10 dark:border-white/10 rounded-xl p-3 bg-white dark:bg-[#141a24]">
          <div className="font-medium mb-2 text-sm">Pending</div>
          {pending.length ? (
            <ul className="text-sm space-y-1">
              {pending.map((p) => (
                <li key={p.id}>{p.full_name || p.id}</li>
              ))}
            </ul>
          ) : (
            <div className="text-sm opacity-70">—</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------- Bulletin Board Card ------------------------- */
function BulletinBoardCard({
  isManager,
  me,
  posts,
  loadingPosts,
  errPosts,
  onOpenComposer,
  onDelete,
  onTogglePin,
  totalSupervisors,
  ackCounts,
  myAckMap,
  onAck,
  onOpenAckList,
}) {
  return (
    <div className="frame overflow-hidden h-full">
      <div className="frame-accent" />
      <div className="p-5 bg-white dark:bg-[#1E2430] border border-black/10 dark:border-white/10 rounded-b-2xl">
        <div className="relative flex items-center justify-center">
          <h2 className="font-heading text-xl md:text-2xl text-center">
            Bulletin Board
          </h2>
        </div>
        <p className="text-xs text-sdg-slate dark:text-white/60 text-center">
          Keep it brief—quick notifications for the team.
        </p>

        {isManager && (
          <div className="mt-3 text-center">
            <button
              type="button"
              className="text-sm underline hover:opacity-80"
              onClick={onOpenComposer}
            >
              Create a post
            </button>
          </div>
        )}

        <div className="mt-5">
          <div className="mt-3">
            {loadingPosts && <div className="text-sm opacity-70">Loading…</div>}
            {errPosts && (
              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-xl px-3 py-2">
                {errPosts}
              </div>
            )}
            {!loadingPosts && !errPosts && posts.length === 0 && (
              <div className="text-sm opacity-70">No posts yet.</div>
            )}

            <ul className="space-y-4">
              {posts.map((p) => (
                <li
                  key={p.id}
                  className="border border-sdg-dark/10 dark:border-white/10 rounded-xl p-3 bg-white dark:bg-[#141a24]"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex flex-wrap items-center gap-1 mt-0.5">
                      {p.pinned && (
                        <span className="text-[11px] rounded-full border border-black/10 dark:border-white/20 px-2 py-0.5">
                          📌 Pinned
                        </span>
                      )}
                      {p.important && (
                        <span className="text-[11px] rounded-full border border-black/10 dark:border-white/20 px-2 py-0.5">
                          ⚠️ Important
                        </span>
                      )}
                      {p.notify_supervisors && (
                        <span className="text-[11px] rounded-full border border-black/10 dark:border-white/20 px-2 py-0.5">
                          🔔 Notify supervisors
                        </span>
                      )}
                      {p.priority > 0 && (
                        <span className="text-[11px] rounded-full border border-black/10 dark:border-white/20 px-2 py-0.5">
                          Priority:{" "}
                          {["Normal", "High", "Urgent", "Critical"][p.priority]}
                        </span>
                      )}
                    </div>

                    <div className="flex-1">
                      <div className="font-heading">{p.title}</div>
                      <div className="mt-1 text-sm whitespace-pre-line">
                        {p.body}
                      </div>
                      <div className="mt-1 text-xs opacity-70">
                        {fmtDate(p.created_at, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {p.author ? " • " + p.author : ""}
                      </div>

                      {p.requires_ack && (
                        <div className="mt-2 text-xs flex items-center gap-3">
                          {isManager ? (
                            <button
                              type="button"
                              className="underline"
                              onClick={() => onOpenAckList(p)}
                              title="View acknowledgements"
                            >
                              Ack: {ackCounts[p.id] || 0} / {totalSupervisors}
                            </button>
                          ) : myAckMap[p.id] ? (
                            <span className="text-emerald-600">
                              Acknowledged ✓
                            </span>
                          ) : !p.ack_deadline ||
                            new Date(p.ack_deadline) > new Date() ? (
                            <button
                              type="button"
                              className="px-2 py-1 rounded-md border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10"
                              onClick={() => onAck(p)}
                            >
                              Acknowledge
                            </button>
                          ) : (
                            <span className="opacity-70">Deadline passed</span>
                          )}
                        </div>
                      )}
                    </div>

                    {(isManager || p.created_by === me?.id) && (
                      <div className="ml-2 flex flex-col items-end gap-1">
                        <button
                          type="button"
                          className="text-xs text-red-600 hover:underline"
                          onClick={() => onDelete(p.id)}
                          title="Delete"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          className="text-xs hover:underline"
                          onClick={() => onTogglePin(p)}
                          title={p.pinned ? "Unpin" : "Pin"}
                        >
                          {p.pinned ? "Unpin" : "Pin"}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Page Header (full-bleed) ------------------------------- */
function PageHeader() {
  return (
    <div className="px-4 md:px-6 mb-4 border-b border-black/10 dark:border-white/10">
      <div className="flex items-center justify-between py-3">
        <h1 className="font-heading text-2xl md:text-3xl">Dashboard</h1>
        <div
          className="h-1.5 w-24 rounded-full"
          style={{ background: "var(--sdg-gold, #d4af37)" }}
        />
      </div>
    </div>
  );
}

/* ------------------------------- Dashboard (FULL WIDTH) ------------------------------- */
export default function Dashboard() {
  const [me, setMe] = useState(null);
  const isManager = ["manager", "supervisor", "admin"].includes(
    String(me?.role || "").toLowerCase()
  );

  // Make the global header/tabs full-bleed (same as LogViolation)
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

  // Shared performance week state (controls all four gauges)
  const latestCompleteWeekStartISO = useMemo(
    () => toISODate(addDays(previousSunday(new Date()), -7)),
    []
  );
  const [perfWeekISO, setPerfWeekISO] = useState(latestCompleteWeekStartISO);

  const canGoNext =
    new Date(perfWeekISO).getTime() <
    new Date(latestCompleteWeekStartISO).getTime();

  const goPrevWeek = () =>
    setPerfWeekISO((iso) => toISODate(addDays(parseISODateLocal(iso), -7)));
  const goNextWeek = () =>
    setPerfWeekISO((iso) =>
      canGoNext ? toISODate(addDays(parseISODateLocal(iso), 7)) : iso
    );
  const goLatest = () => setPerfWeekISO(latestCompleteWeekStartISO);

  const perfRangeText = fmtDateRange(
    perfWeekISO,
    toISODate(addDays(parseISODateLocal(perfWeekISO), 6))
  );

  // Bulk manager modal state
  const [bulkOpen, setBulkOpen] = useState(false);
  const openBulk = () => setBulkOpen(true);

  /* -------- Bulletin Board: list + live updates + actions -------- */
  const [posts, setPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [errPosts, setErrPosts] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);

  const [totalSupervisors, setTotalSupervisors] = useState(0);
  const [ackCounts, setAckCounts] = useState({});
  const [myAckMap, setMyAckMap] = useState({});
  const [ackListFor, setAckListFor] = useState(null);

  const refreshAnnouncements = useCallback(async () => {
    setLoadingPosts(true);
    setErrPosts("");
    const { data, error } = await supabase
      .from("active_announcements_ranked")
      .select(
        "id,title,body,author,pinned,priority,important,notify_supervisors,requires_ack,ack_deadline,created_at,created_by,rn"
      )
      .order("rn", { ascending: true })
      .limit(25);
    if (error) setErrPosts(error.message);
    setPosts(data ?? []);
    setLoadingPosts(false);
  }, []);

  useEffect(() => {
    let dead = false;
    (async () => {
      if (!dead) await refreshAnnouncements();
    })();
    const ch = supabase
      .channel("rt-announcements-dash")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "announcements" },
        () => {
          if (!dead) refreshAnnouncements();
        }
      )
      .subscribe();
    return () => {
      dead = true;
      supabase.removeChannel(ch);
    };
  }, [refreshAnnouncements]);

  useEffect(() => {
    (async () => {
      const ids = posts.map((p) => p.id);
      const [supers, counts, mine] = await Promise.all([
        fetchSupervisors(),
        fetchAckCounts(ids),
        fetchMyAckMap(ids),
      ]);
      setTotalSupervisors(supers.length);
      setAckCounts(counts);
      setMyAckMap(mine);
    })();
  }, [posts]);

  useEffect(() => {
    const ch = supabase
      .channel("rt-announcements-acks")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "announcements_acks" },
        async () => {
          const ids = posts.map((p) => p.id);
          const [counts, mine] = await Promise.all([
            fetchAckCounts(ids),
            fetchMyAckMap(ids),
          ]);
          setAckCounts(counts);
          setMyAckMap(mine);
        }
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [posts]);

  const handleOpenComposer = () => setComposerOpen(true);
  const handleCloseComposer = () => setComposerOpen(false);
  const handlePosted = async () => {
    await refreshAnnouncements();
    setComposerOpen(false);
  };

  async function handleDelete(id) {
    const ok = window.confirm("Delete this post?");
    if (!ok) return;
    const { error } = await supabase
      .from("announcements")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      alert(error.message || "Could not delete.");
      return;
    }
    await refreshAnnouncements();
  }
  async function handleTogglePin(p) {
    const { error } = await supabase
      .from("announcements")
      .update({ pinned: !p.pinned })
      .eq("id", p.id);
    if (error) {
      alert(error.message || "Could not update pin.");
      return;
    }
    await refreshAnnouncements();
  }
  async function handleAck(post) {
    await acknowledgeAnnouncement(post.id);
    setAckCounts((m) => ({ ...m, [post.id]: (m[post.id] || 0) + 1 }));
    setMyAckMap((m) => ({ ...m, [post.id]: true }));
  }

  // Links filter
  const [query, setQuery] = useState("");
  const filteredLinks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return quickLinks;
    return quickLinks.filter((x) => x.label.toLowerCase().includes(q));
  }, [query]);

  return (
    <main className="w-full bg-white dark:bg-[#0f1215]">
      {/* Make header/tabs bar full-width on this page */}
      <style>{`
        header.sdg-header-bleed {
          position: relative;
          left: 50%;
          right: 50%;
          margin-left: -50vw;
          margin-right: -50vw;
          width: 100vw;
          border-radius: 0;
          padding-left: max(env(safe-area-inset-left), 24px);
          padding-right: max(env(safe-area-inset-right), 24px);
        }
        header.sdg-header-bleed .container,
        header.sdg-header-bleed .mx-auto,
        header.sdg-header-bleed [class*="max-w-"] {
          max-width: none !important;
          width: 100% !important;
        }
      `}</style>

      {/* FULL-BLEED page header (title only) */}
      <PageHeader />

      {/* CONTENT */}
      <section aria-label="Performance" className="mb-6 px-4 md:px-6">
        <div className="frame overflow-hidden">
          <div className="frame-accent" />
          <div className="p-5 bg-white dark:bg-[#1E2430] border border-black/10 dark:border-white/10 rounded-b-2xl">
            <div className="relative flex items-center justify-center">
              <h2 className="font-heading text-xl md:text-2xl text-center">
                Performance
              </h2>
              {isManager && (
                <button
                  type="button"
                  onClick={openBulk}
                  className="absolute right-0 btn btn-primary"
                >
                  Update Week (All KPIs)
                </button>
              )}
            </div>

            <div className="mt-1 text-xs md:text-sm tabular-nums text-center">
              {perfRangeText} <span className="opacity-60">(Sun → Sat)</span>
            </div>

            <div className="mt-2 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={goPrevWeek}
                className="px-2 py-1 text-xs rounded-md border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10"
              >
                ← Prev
              </button>
              <button
                type="button"
                onClick={goNextWeek}
                disabled={!canGoNext}
                className={classNames(
                  "px-2 py-1 text-xs rounded-md border border-black/10 dark:border-white/10",
                  canGoNext
                    ? "hover:bg-black/5 dark:hover:bg-white/10"
                    : "opacity-50 cursor-not-allowed"
                )}
              >
                Next →
              </button>
              {perfWeekISO !== latestCompleteWeekStartISO && (
                <button
                  type="button"
                  onClick={goLatest}
                  className="px-2 py-1 text-[11px] rounded-md border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Latest
                </button>
              )}
            </div>

            <div className="mt-4 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
              {KPI_CATEGORIES.map((cat) => (
                <TourGaugeCard
                  key={cat}
                  category={cat}
                  weekStartISO={perfWeekISO}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Breach + Bulletin */}
      <section className="grid gap-6 lg:grid-cols-2 px-4 md:px-6">
        <ActiveBreachBoard />
        <BulletinBoardCard
          isManager={isManager}
          me={me}
          posts={posts}
          loadingPosts={loadingPosts}
          errPosts={errPosts}
          onOpenComposer={handleOpenComposer}
          onDelete={handleDelete}
          onTogglePin={handleTogglePin}
          totalSupervisors={totalSupervisors}
          ackCounts={ackCounts}
          myAckMap={myAckMap}
          onAck={handleAck}
          onOpenAckList={(p) => setAckListFor(p)}
        />
      </section>

      {/* Links */}
      <section id="links" className="mt-6 px-4 md:px-6">
        <div className="frame overflow-hidden">
          <div className="frame-accent" />
          <div className="p-5 bg-white dark:bg-[#1E2430] border border-black/10 dark:border-white/10 rounded-b-2xl">
            <LinksList
              query={query}
              setQuery={setQuery}
              filtered={filteredLinks}
            />
          </div>
        </div>
      </section>

      {/* Modals */}
      <Modal
        open={composerOpen}
        onClose={handleCloseComposer}
        title="Create a Post"
      >
        <AnnouncementForm
          inModal
          onPosted={handlePosted}
          onCancel={handleCloseComposer}
        />
      </Modal>

      <Modal
        open={!!ackListFor}
        onClose={() => setAckListFor(null)}
        title={
          ackListFor
            ? `Acknowledgements — ${ackListFor.title}`
            : "Acknowledgements"
        }
      >
        {ackListFor && (
          <AckList
            announcement={ackListFor}
            totalSupervisors={totalSupervisors}
          />
        )}
      </Modal>

      <ManagerBulkUpdateModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        initialWeekStartISO={perfWeekISO}
        onSaved={() => {
          /* Gauges auto-refresh via realtime */
        }}
      />
    </main>
  );
}
