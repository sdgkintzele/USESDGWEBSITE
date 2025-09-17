// src/pages/Finances.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/* ========================= Time helpers (Eastern) ========================= */
const ET = "America/New_York";

function ymdToDateUTC(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d, 0, 0));
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
function etParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p = fmt.formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { y: +get("year"), m: +get("month"), d: +get("day") };
}
function etMonthStartLocalISO(anchor = new Date()) {
  const { y, m } = etParts(anchor);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}
function nextMonthLocalISO(ymdISO) {
  const [y, m] = ymdISO.split("-").map(Number);
  const dt = ymdToDateUTC(y, m, 1);
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  return ymdToStr(dateUTCToYmd(dt));
}
function prevMonthLocalISO(ymdISO) {
  const [y, m] = ymdISO.split("-").map(Number);
  const dt = ymdToDateUTC(y, m, 1);
  dt.setUTCMonth(dt.getUTCMonth() - 1);
  return ymdToStr(dateUTCToYmd(dt));
}

/**
 * Convert an ET local date (YYYY-MM-DD, at 00:00 ET) to the correct UTC ISO string.
 * Handles DST by extracting the offset for that calendar date.
 */
function etMidnightToUTCISO(ymdISO) {
  const [y, m, d] = ymdISO.split("-").map(Number);

  // Get the ET offset for that date (use a midday "guess" so we’re safely inside the day)
  const guess = new Date(Date.UTC(y, m - 1, d, 12, 0));
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

  // ET 00:00 -> UTC by subtracting the ET offset
  const utcMs = Date.UTC(y, m - 1, d, 0, 0) - offsetMin * 60 * 1000;
  return new Date(utcMs).toISOString();
}

function currency(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(n || 0));
}
function monthLabelFromISO(ymdISO) {
  const [y, m] = ymdISO.split("-").map(Number);
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${months[m - 1]} ${y}`;
}

/* =============================== UI bits =============================== */
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

/* ================================ Page ================================ */
export default function Finances() {
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

  // Month anchor (ET)
  const [monthStartISO, setMonthStartISO] = useState(() =>
    etMonthStartLocalISO()
  );
  const nextISO = useMemo(
    () => nextMonthLocalISO(monthStartISO),
    [monthStartISO]
  );

  // Display label that doesn’t drift across months
  const monthLabel = useMemo(
    () => monthLabelFromISO(monthStartISO),
    [monthStartISO]
  );

  // Totals
  const [fuel, setFuel] = useState(0);
  const [vm, setVm] = useState(0);
  const [ops, setOps] = useState(0);
  const [comms, setComms] = useState(0);
  const grandTotal = useMemo(
    () => fuel + vm + ops + comms,
    [fuel, vm, ops, comms]
  );

  // Recent combined feed
  const [feed, setFeed] = useState([]);

  useEffect(() => {
    (async () => {
      // ET month window -> true UTC boundaries
      const startUTC = etMidnightToUTCISO(monthStartISO);
      const endUTC = etMidnightToUTCISO(nextISO);

      const q1 = supabase
        .from("patrol_fuel_logs")
        .select("total_cost, occurred_at")
        .gte("occurred_at", startUTC)
        .lt("occurred_at", endUTC);

      const q2 = supabase
        .from("vehicle_maintenance_logs")
        .select("amount_usd, occurred_at")
        .gte("occurred_at", startUTC)
        .lt("occurred_at", endUTC);

      const q3 = supabase
        .from("operational_expense_logs")
        .select("amount_usd, occurred_at")
        .gte("occurred_at", startUTC)
        .lt("occurred_at", endUTC);

      const q4 = supabase
        .from("guard_commendations")
        .select("bonus_amount, occurred_at")
        .gte("occurred_at", startUTC)
        .lt("occurred_at", endUTC);

      const [{ data: d1 }, { data: d2 }, { data: d3 }, { data: d4 }] =
        await Promise.all([q1, q2, q3, q4]);

      setFuel((d1 || []).reduce((s, r) => s + Number(r.total_cost || 0), 0));
      setVm((d2 || []).reduce((s, r) => s + Number(r.amount_usd || 0), 0));
      setOps((d3 || []).reduce((s, r) => s + Number(r.amount_usd || 0), 0));
      setComms((d4 || []).reduce((s, r) => s + Number(r.bonus_amount || 0), 0));

      const fFeed = (d1 || []).map((r) => ({
        type: "Fuel",
        amount: r.total_cost,
        occurred_at: r.occurred_at,
      }));
      const vmFeed = (d2 || []).map((r) => ({
        type: "Vehicle Maintenance",
        amount: r.amount_usd,
        occurred_at: r.occurred_at,
      }));
      const opFeed = (d3 || []).map((r) => ({
        type: "Operations",
        amount: r.amount_usd,
        occurred_at: r.occurred_at,
      }));
      const cmFeed = (d4 || []).map((r) => ({
        type: "Commendation",
        amount: r.bonus_amount,
        occurred_at: r.occurred_at,
      }));

      const all = [...fFeed, ...vmFeed, ...opFeed, ...cmFeed].sort(
        (a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)
      );
      setFeed(all.slice(0, 25));
    })().catch((e) => console.error(e));
  }, [monthStartISO, nextISO]);

  return (
    <div className="py-8">
      <style>{`
        header.sdg-header-bleed{position:relative;left:50%;right:50%;margin-left:-50vw;margin-right:-50vw;width:100vw;border-radius:0;padding-left:max(env(safe-area-inset-left),24px);padding-right:max(env(safe-area-inset-right),24px);}
        header.sdg-header-bleed .container, header.sdg-header-bleed .mx-auto, header.sdg-header-bleed [class*="max-w-"]{max-width:none!important;width:100%!important;}
        .page-full{max-width:100%!important;width:100%!important;}
      `}</style>

      <div className="page-full px-4 md:px-6 bg-gradient-to-b from-[#fafbfc] via-[#f7f6f3] to-[#f6f5f2] dark:from-[#2a3040] dark:via-[#262c38] dark:to-[#232835]">
        <header className="mb-5">
          <h1 className="font-heading text-3xl md:text-4xl">
            Company Finances
          </h1>
          <p className="text-sdg-slate dark:text-white/70 mt-1">
            Overview and detailed logs for fuel, maintenance, operations, and
            commendations.
          </p>
        </header>

        <Frame title="Monthly Overview">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div className="flex items-center gap-2">
              <button
                className="px-3 py-1.5 rounded-md border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() =>
                  setMonthStartISO((iso) => prevMonthLocalISO(iso))
                }
              >
                ← Prev
              </button>
              <div className="font-semibold">{monthLabel}</div>
              <button
                className="px-3 py-1.5 rounded-md border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg:white/10"
                onClick={() =>
                  setMonthStartISO((iso) => nextMonthLocalISO(iso))
                }
              >
                Next →
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-5">
            <Metric label="Fuel (month)" value={currency(fuel)} />
            <Metric label="Vehicle Maintenance (month)" value={currency(vm)} />
            <Metric label="Operations (month)" value={currency(ops)} />
            <Metric label="Commendations (month)" value={currency(comms)} />
            <Metric label="Total (month)" value={currency(grandTotal)} />
          </div>
        </Frame>

        <div className="mt-6">
          <Frame title="Recent Activity (month)">
            <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
              <table className="min-w-full text-sm">
                <thead className="bg-black/[0.03] dark:bg-white/[0.06] text-slate-700 dark:text-slate-200">
                  <tr className="text-left">
                    <th className="py-2.5 pl-3 pr-3 font-semibold">When</th>
                    <th className="py-2.5 pr-3 font-semibold">Type</th>
                    <th className="py-2.5 pr-3 font-semibold text-right">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="[&>tr:nth-child(even)]:bg-black/[0.015] dark:[&>tr:nth-child(even)]:bg-white/[0.04]">
                  {feed.length ? (
                    feed.map((r, i) => (
                      <tr
                        key={i}
                        className="border-t border-black/5 dark:border-white/10 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
                      >
                        <td className="py-2.5 pl-3 pr-3">
                          {new Intl.DateTimeFormat("en-US", {
                            timeZone: ET,
                            month: "short",
                            day: "2-digit",
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(r.occurred_at))}
                        </td>
                        <td className="py-2.5 pr-3">{r.type}</td>
                        <td className="py-2.5 pr-3 font-medium text-right">
                          {currency(r.amount)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        className="py-6 text-center text-slate-500"
                        colSpan={3}
                      >
                        No activity this month.
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
