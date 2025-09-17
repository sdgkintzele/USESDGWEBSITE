// src/pages/PatrolFuelLogs.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/* ============================= Time helpers (ET) ============================= */
const ET = "America/New_York";

/** Convert a local ET wall-time (YYYY-MM-DDTHH:mm) to a UTC ISO string. */
function toZonedUTCISO(localIso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localIso || "");
  if (!m) throw new Error("Invalid date/time.");
  const y = +m[1],
    mo = +m[2],
    d = +m[3],
    hh = +m[4],
    mm = +m[5];

  const guess = new Date(Date.UTC(y, mo - 1, d, hh, mm));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const tzn =
    fmt.formatToParts(guess).find((p) => p.type === "timeZoneName")?.value ||
    "GMT+0";
  const mt = /GMT([+-])(\d{1,2})(?::(\d{2}))?/i.exec(tzn);
  const sign = mt?.[1] === "+" ? 1 : -1;
  const oh = mt ? parseInt(mt[2], 10) : 0;
  const om = mt?.[3] ? parseInt(mt[3], 10) : 0;
  const offsetMin = sign * (oh * 60 + om);
  const utcMs = Date.UTC(y, mo - 1, d, hh, mm) - offsetMin * 60 * 1000;
  return new Date(utcMs).toISOString();
}

/** Format a UTC ISO back to ET, user-friendly. */
function formatET(utcStr) {
  if (!utcStr) return "";
  const d = new Date(utcStr);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/* ---------- FIX: anchor calendar math at UTC NOON to avoid ET/UTC slip ---------- */
function ymdToDateUTC(y, m, d) {
  // Using 12:00 UTC ensures ET formatting never rolls the date backward
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
}
function dateUTCToYmd(dt) {
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}
function ymdToStr({ y, m, d }) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function addDaysISO(ymdISO, days) {
  const [y, m, d] = ymdISO.split("-").map((n) => +n);
  const dt = ymdToDateUTC(y, m, d); // anchored at UTC noon
  dt.setUTCDate(dt.getUTCDate() + days);
  return ymdToStr(dateUTCToYmd(dt));
}

/** Get ET calendar parts for a given JS Date (today by default). */
function etParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const p = fmt.formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: +get("year"),
    m: +get("month"),
    d: +get("day"),
    w: wd[get("weekday")] ?? 0,
  };
}

/** Sunday start (ET) for the given anchor date (default: now). */
function etWeekStartLocalISO(anchor = new Date()) {
  const { y, m, d, w } = etParts(anchor);
  const dt = ymdToDateUTC(y, m, d); // noon anchor
  dt.setUTCDate(dt.getUTCDate() - w); // back to Sunday
  return ymdToStr(dateUTCToYmd(dt));
}

/** ET month start (YYYY-MM-01) derived from current ET date. */
function etMonthStartLocalISO(anchor = new Date()) {
  const { y, m } = etParts(anchor);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}
function nextMonthLocalISO(ymdISO) {
  const [y, m] = ymdISO.split("-").map((n) => +n);
  const dt = ymdToDateUTC(y, m, 1); // noon anchor
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  return ymdToStr(dateUTCToYmd(dt));
}
function prevMonthLocalISO(ymdISO) {
  const [y, m] = ymdISO.split("-").map((n) => +n);
  const dt = ymdToDateUTC(y, m, 1); // noon anchor
  dt.setUTCMonth(dt.getUTCMonth() - 1);
  return ymdToStr(dateUTCToYmd(dt));
}

function weekLabel(startISO) {
  const endISO = addDaysISO(startISO, 6);
  const fmtLong = (iso) => {
    const [y, m, d] = iso.split("-").map((n) => +n);
    const utc = ymdToDateUTC(y, m, d); // noon anchor
    return new Intl.DateTimeFormat("en-US", {
      timeZone: ET,
      weekday: "short",
      month: "short",
      day: "2-digit",
      year: "numeric",
    }).format(utc);
  };
  return `${fmtLong(startISO)} — ${fmtLong(endISO)}`;
}
function monthLabel(startISO) {
  const [y, m] = startISO.split("-").map((n) => +n);
  const utc = ymdToDateUTC(y, m, 1); // noon anchor
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    month: "long",
    year: "numeric",
  }).format(utc);
}

/* ============================ UI bits ============================ */
function Frame({ title, children }) {
  return (
    <div className="frame overflow-hidden h-full flex flex-col">
      <div
        className="h-1.5"
        style={{ background: "linear-gradient(90deg,#d4af37,#c49a2c)" }}
      />
      <div className="flex-1 p-4 md:p-5 bg-white dark:bg-[#1E2430] border border-black/10 dark:border-white/10 rounded-b-2xl">
        {title ? (
          <h2 className="font-heading text-lg md:text-xl mb-3">{title}</h2>
        ) : null}
        {children}
      </div>
    </div>
  );
}
function Metric({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#141a24] p-4">
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
function currency(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

/* ============================== Photo Links (pills) ============================== */
function PhotoLinks({ gauge, receipt, full }) {
  const [gURL, setG] = useState("");
  const [rURL, setR] = useState("");
  const [fURL, setF] = useState("");

  useEffect(() => {
    (async () => {
      async function sign(path, setter) {
        if (!path) return setter("");
        const { data, error } = await supabase.storage
          .from("patrol-fuel")
          .createSignedUrl(path, 3600);
        if (!error) setter(data?.signedUrl || "");
      }
      await Promise.all([
        sign(gauge, setG),
        sign(receipt, setR),
        sign(full, setF),
      ]);
    })();
  }, [gauge, receipt, full]);

  const Pill = ({ href, label }) =>
    href ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-block px-2.5 py-1 rounded-full border border-black/10 dark:border-white/15 bg-black/[0.03] dark:bg-white/[0.06] hover:bg-black/[0.06] dark:hover:bg-white/[0.1] text-xs font-medium mr-2"
      >
        {label}
      </a>
    ) : (
      <span className="inline-block px-2.5 py-1 rounded-full border border-black/5 dark:border-white/10 text-xs text-slate-400 mr-2">
        {label}
      </span>
    );

  return (
    <div className="flex flex-wrap items-center">
      <Pill href={gURL} label="Gauge" />
      <Pill href={rURL} label="Receipt" />
      <Pill href={fURL} label="Full" />
    </div>
  );
}

/* =============================== Component =============================== */
export default function PatrolFuelLogs() {
  // full-bleed header
  useEffect(() => {
    const headerEl =
      document.querySelector("header") ||
      document.querySelector("[data-app-header]");
    if (headerEl) headerEl.classList.add("sdg-header-bleed");
    return () => {
      if (headerEl) headerEl.classList.remove("sdg-header-bleed");
    };
  }, []);

  // vehicles lookup (for labels)
  const [vehicles, setVehicles] = useState([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("patrol_vehicles")
        .select("id,label")
        .order("label");
      setVehicles(data || []);
    })();
  }, []);
  const vLabel = (id) => vehicles.find((v) => v.id === id)?.label || "—";

  /* --------------------------- Anchors (ET) --------------------------- */
  // Weekly view: Sunday start of current ET week; end is +7 days (open bound)
  const [weekStartISO, setWeekStartISO] = useState(() => etWeekStartLocalISO());
  const weekEndISO = useMemo(() => addDaysISO(weekStartISO, 7), [weekStartISO]);
  const weekLabelText = useMemo(() => weekLabel(weekStartISO), [weekStartISO]);

  // Monthly totals: ET current month start; next month is the open bound
  const [monthStartISO, setMonthStartISO] = useState(() =>
    etMonthStartLocalISO()
  );
  const nextMonthISO = useMemo(
    () => nextMonthLocalISO(monthStartISO),
    [monthStartISO]
  );
  const monthLabelText = useMemo(
    () => monthLabel(monthStartISO),
    [monthStartISO]
  );

  /* ------------------------------ Data ------------------------------ */
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // Weekly fetch
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const startUTC = toZonedUTCISO(`${weekStartISO}T00:00`);
        const endUTC = toZonedUTCISO(`${weekEndISO}T00:00`);
        const { data, error } = await supabase
          .from("patrol_fuel_logs")
          .select(
            "id, occurred_at, supervisor_name, vehicle_id, total_cost, notes, gauge_before_path, receipt_path, tank_full_path"
          )
          .gte("occurred_at", startUTC)
          .lt("occurred_at", endUTC)
          .order("occurred_at", { ascending: false });
        if (error) throw error;
        setRows(data || []);
      } catch (e) {
        console.error(e);
        alert(e.message || "Could not load fuel logs.");
      } finally {
        setLoading(false);
      }
    })();
  }, [weekStartISO, weekEndISO]);

  const weekCount = rows.length;
  const weekTotal = rows.reduce((s, r) => s + Number(r.total_cost || 0), 0);

  // Monthly totals
  const [monthCount, setMonthCount] = useState(0);
  const [monthTotal, setMonthTotal] = useState(0);
  useEffect(() => {
    (async () => {
      const startUTC = toZonedUTCISO(`${monthStartISO}T00:00`);
      const endUTC = toZonedUTCISO(`${nextMonthISO}T00:00`);
      const { data, error } = await supabase
        .from("patrol_fuel_logs")
        .select("total_cost")
        .gte("occurred_at", startUTC)
        .lt("occurred_at", endUTC);
      if (!error) {
        setMonthCount(data?.length || 0);
        setMonthTotal(
          (data || []).reduce((s, r) => s + Number(r.total_cost || 0), 0)
        );
      }
    })();
  }, [monthStartISO, nextMonthISO]);

  function Row({ r }) {
    return (
      <tr>
        <td className="py-2 pr-3">{formatET(r.occurred_at)}</td>
        <td className="py-2 pr-3">{r.supervisor_name || "—"}</td>
        <td className="py-2 pr-3">{vLabel(r.vehicle_id)}</td>
        <td className="py-2 pr-3 font-medium text-right">
          {currency(r.total_cost)}
        </td>
        <td className="py-2 pr-3">
          <PhotoLinks
            gauge={r.gauge_before_path}
            receipt={r.receipt_path}
            full={r.tank_full_path}
          />
        </td>
        <td className="py-2 pr-3 max-w-[320px]">
          <div className="truncate" title={r.notes || ""}>
            {r.notes || "—"}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="py-8">
      <style>{`
        header.sdg-header-bleed{
          position:relative;left:50%;right:50%;margin-left:-50vw;margin-right:-50vw;width:100vw;border-radius:0;
          padding-left:max(env(safe-area-inset-left),24px);padding-right:max(env(safe-area-inset-right),24px);
        }
        header.sdg-header-bleed .container, header.sdg-header-bleed .mx-auto, header.sdg-header-bleed [class*="max-w-"]{
          max-width:none!important;width:100%!important;
        }
        .page-full{max-width:100%!important;width:100%!important;}

        /* Table look */
        .sdg-table tbody tr + tr { border-top: 1px solid rgba(0,0,0,0.05); }
        .dark .sdg-table tbody tr + tr { border-top-color: rgba(255,255,255,0.10); }
        .sdg-table tbody tr:hover { background: rgba(0,0,0,0.03); }
        .dark .sdg-table tbody tr:hover { background: rgba(255,255,255,0.06); }
      `}</style>

      <div className="page-full px-4 md:px-6 bg-gradient-to-b from-[#fafbfc] via-[#f7f6f3] to-[#f6f5f2] dark:from-[#2a3040] dark:via-[#262c38] dark:to-[#232835]">
        <header className="mb-5">
          <h1 className="font-heading text-3xl md:text-4xl">
            Patrol Gas Fuel Logs
          </h1>
          <p className="text-sdg-slate dark:text-white/70 mt-1">
            View weekly fuel reports and monthly totals (Eastern Time).
          </p>
        </header>

        {/* Weekly + Monthly side-by-side */}
        <div className="grid gap-6 md:grid-cols-2">
          <Frame title="Weekly View">
            <div className="flex flex-col items-center justify-center text-center gap-4 w-full">
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1.5 rounded-md border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => setWeekStartISO((iso) => addDaysISO(iso, -7))}
                >
                  ← Prev
                </button>
                <div className="font-semibold">{weekLabelText}</div>
                <button
                  className="px-3 py-1.5 rounded-md border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => setWeekStartISO((iso) => addDaysISO(iso, +7))}
                >
                  Next →
                </button>
              </div>
              <div className="flex gap-3 justify-center w-full">
                <Metric label="Reports (week)" value={weekCount} />
                <Metric
                  label="Total Spent (week)"
                  value={currency(weekTotal)}
                />
              </div>
            </div>
          </Frame>

          <Frame title="Monthly Totals">
            <div className="flex flex-col items-center justify-center text-center gap-4 w-full">
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1.5 rounded-md border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() =>
                    setMonthStartISO((iso) => prevMonthLocalISO(iso))
                  }
                >
                  ← Prev
                </button>
                <div className="font-semibold">{monthLabelText}</div>
                <button
                  className="px-3 py-1.5 rounded-md border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() =>
                    setMonthStartISO((iso) => nextMonthLocalISO(iso))
                  }
                >
                  Next →
                </button>
              </div>
              <div className="flex gap-3 justify-center w-full">
                <Metric label="Reports (month)" value={monthCount} />
                <Metric
                  label="Total Spent (month)"
                  value={currency(monthTotal)}
                />
              </div>
            </div>
          </Frame>
        </div>

        {/* Table */}
        <div className="mt-6">
          <Frame title="Fuel Logs (Selected Week)">
            <div className="overflow-x-auto">
              <table className="sdg-table min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-600 dark:text-slate-300">
                    <th className="py-2 pr-3 font-semibold">When (ET)</th>
                    <th className="py-2 pr-3 font-semibold">Supervisor</th>
                    <th className="py-2 pr-3 font-semibold">Vehicle</th>
                    <th className="py-2 pr-3 font-semibold text-right">
                      Total
                    </th>
                    <th className="py-2 pr-3 font-semibold">Photos</th>
                    <th className="py-2 pr-3 font-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td
                        className="py-6 text-center text-slate-500"
                        colSpan={6}
                      >
                        Loading…
                      </td>
                    </tr>
                  ) : rows.length ? (
                    rows.map((r) => <Row key={r.id} r={r} />)
                  ) : (
                    <tr>
                      <td
                        className="py-6 text-center text-slate-500"
                        colSpan={6}
                      >
                        No logs in this week.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Frame>
        </div>
      </div>
    </div>
  );
}
