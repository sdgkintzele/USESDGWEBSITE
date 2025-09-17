// src/pages/Commendations.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/* ===== ET time helpers ===== */
const ET = "America/New_York";
function nowForInput() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t)?.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}
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
  return new Date(
    Date.UTC(y, mo - 1, d, hh, mm) - offsetMin * 60000
  ).toISOString();
}
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
    weekday: "short",
  });
  const p = fmt.formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value;
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: +g("year"),
    m: +g("month"),
    d: +g("day"),
    w: wd[g("weekday")] ?? 0,
  };
}
function addDaysISO(ymdISO, days) {
  const [y, m, d] = ymdISO.split("-").map(Number);
  const dt = ymdToDateUTC(y, m, d);
  dt.setUTCDate(dt.getUTCDate() + days);
  return ymdToStr(dateUTCToYmd(dt));
}
function etWeekStartLocalISO(anchor = new Date()) {
  const { y, m, d, w } = etParts(anchor);
  const dt = ymdToDateUTC(y, m, d);
  dt.setUTCDate(dt.getUTCDate() - w);
  return ymdToStr(dateUTCToYmd(dt));
}
function formatET(utcStr) {
  if (!utcStr) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(utcStr));
}
function currency(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(n || 0));
}

/* ===== Tiny UI bits ===== */
const inputBase =
  "w-full h-10 px-3 rounded-xl border focus:outline-none bg-white text-black border-black/10 dark:bg-[#0f1215] dark:text-white dark:border-white/15 focus:ring-2 ring-sdg-gold/50";
function Frame({ title, children }) {
  return (
    <div className="frame overflow-hidden">
      <div
        className="h-1.5"
        style={{ background: "linear-gradient(90deg,#d4af37,#c49a2c)" }}
      />
      <div className="p-4 md:p-5 bg-white dark:bg-[#1E2430] border border-black/10 dark:border-white/10 rounded-b-2xl">
        {title ? (
          <h2 className="font-heading text-lg md:text-xl mb-3">{title}</h2>
        ) : null}
        {children}
      </div>
    </div>
  );
}
function FieldShell({ label, required, error, children, className = "" }) {
  return (
    <div
      className={
        "rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#141a24] p-4 " +
        className
      }
    >
      {label ? (
        <div className="block text-base md:text-lg font-semibold text-slate-700 dark:text-slate-200 mb-2">
          {label} {required ? <span className="text-red-500">*</span> : null}
        </div>
      ) : null}
      {children}
      {error ? <p className="mt-1 text-sm text-red-500">{error}</p> : null}
    </div>
  );
}
function Metric({ label, value }) {
  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#141a24] p-4">
      <div className="text-sm text-slate-600 dark:text-slate-300/80">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

/* ===== Centered confirm modal (same pattern as other pages) ===== */
function ConfirmModal({
  open,
  onCancel,
  onConfirm,
  confirming,
  children,
  title = "Confirm & Submit",
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1E2430] p-5 shadow-xl">
        <h3 className="text-lg font-semibold mb-3">{title}</h3>
        <div className="text-sm">{children}</div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="px-4 py-2 rounded-md border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10"
            onClick={onCancel}
            disabled={confirming}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={confirming}
          >
            {confirming ? "Saving…" : "Confirm & Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Commendations() {
  // header bleed
  useEffect(() => {
    const headerEl =
      document.querySelector("header") ||
      document.querySelector("[data-app-header]");
    if (headerEl) headerEl.classList.add("sdg-header-bleed");
    return () => headerEl && headerEl.classList.remove("sdg-header-bleed");
  }, []);

  // current user
  const [uid, setUid] = useState(null);
  const [myDisplay, setMyDisplay] = useState("");
  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const myId = auth?.user?.id || null;
      setUid(myId);
      let display = auth?.user?.email || "";
      try {
        const { data: me } = await supabase
          .from("profiles")
          .select("full_name,email")
          .eq("id", myId)
          .single();
        if (me)
          display = me.full_name ? `${me.full_name} (${me.email})` : me.email;
      } catch {}
      setMyDisplay(display);
    })();
  }, []);

  /* --------- Roster: only active 1099 guards (exclude supervisors) ---------- */
  const [people, setPeople] = useState([]);
  const [guardsCols, setGuardsCols] = useState({
    hasEmploymentType: false,
    hasIsSupervisor: false,
    checked: false,
  });

  // detect guards table columns (like Users.jsx)
  useEffect(() => {
    (async () => {
      const hasCol = async (col) => {
        const { error } = await supabase.from("guards").select(col).limit(1);
        return !error;
      };
      const [hasET, hasIS] = await Promise.all([
        hasCol("employment_type"),
        hasCol("is_supervisor"),
      ]);
      setGuardsCols({
        hasEmploymentType: hasET,
        hasIsSupervisor: hasIS,
        checked: true,
      });
    })();
  }, []);

  useEffect(() => {
    if (!guardsCols.checked) return;
    (async () => {
      try {
        const { data: base } = await supabase
          .from("guard_stats_v")
          .select("guard_id, full_name, roster_status")
          .eq("roster_status", "active")
          .order("full_name", { ascending: true });

        const list = base || [];
        const ids = list.map((r) => r.guard_id).filter(Boolean);

        const supSet = new Set();
        if (ids.length) {
          let sel = "id";
          if (guardsCols.hasEmploymentType) sel += ", employment_type";
          if (guardsCols.hasIsSupervisor) sel += ", is_supervisor";
          const { data: gdata } = await supabase
            .from("guards")
            .select(sel)
            .in("id", ids);
          (gdata || []).forEach((g) => {
            const isSup =
              (guardsCols.hasEmploymentType &&
                String(g.employment_type) === "supervisor") ||
              (guardsCols.hasIsSupervisor && !!g.is_supervisor);
            if (isSup) supSet.add(g.id);
          });
        }

        const contractors = list
          .filter((r) => !supSet.has(r.guard_id))
          .map((r) => ({ id: r.guard_id, full_name: r.full_name }));

        setPeople(contractors);
      } catch (e) {
        console.error(e);
        setPeople([]);
      }
    })();
  }, [
    guardsCols.checked,
    guardsCols.hasEmploymentType,
    guardsCols.hasIsSupervisor,
  ]);

  // form
  const [whenISO, setWhenISO] = useState(() => nowForInput());
  const [employeeId, setEmployeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});

  // confirm modal
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const selectedGuard = useMemo(
    () => people.find((p) => String(p.id) === String(employeeId)) || null,
    [people, employeeId]
  );

  function validate() {
    const e = {};
    if (!whenISO) e.when = "Enter date/time.";
    if (!employeeId) e.emp = "Select a guard.";
    const amt = Number(String(amount).replace(/[$,\s]/g, ""));
    if (!(amt > 0)) e.amount = "Enter a valid amount.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function openConfirm() {
    if (!validate()) return;
    setConfirmOpen(true);
  }

  async function doSave() {
    if (!selectedGuard) return;
    setConfirming(true);
    try {
      const amt = Number(String(amount).replace(/[$,\s]/g, "") || 0);
      const payload = {
        occurred_at: toZonedUTCISO(whenISO),
        employee_id: employeeId,
        employee_name: selectedGuard.full_name,
        bonus_amount: amt,
        reason: reason.trim() || null,
        supervisor_id: uid,
        supervisor_name: myDisplay,
      };
      const { error } = await supabase
        .from("guard_commendations")
        .insert([payload]);
      if (error) throw error;

      // reset
      setEmployeeId("");
      setAmount("");
      setReason("");
      setConfirmOpen(false);
      alert("Commendation saved.");
      refresh();
    } catch (e) {
      console.error(e);
      alert(e.message || "Could not save.");
    } finally {
      setConfirming(false);
    }
  }

  // weekly view
  const [weekStartISO, setWeekStartISO] = useState(() => etWeekStartLocalISO());
  const weekEndISO = useMemo(() => addDaysISO(weekStartISO, 7), [weekStartISO]);
  const [rows, setRows] = useState([]);
  const [weekTotal, setWeekTotal] = useState(0);

  async function refresh() {
    const startUTC = toZonedUTCISO(`${weekStartISO}T00:00`);
    const endUTC = toZonedUTCISO(`${weekEndISO}T00:00`);
    const { data, error } = await supabase
      .from("guard_commendations")
      .select(
        "id, occurred_at, employee_name, bonus_amount, reason, supervisor_name"
      )
      .gte("occurred_at", startUTC)
      .lt("occurred_at", endUTC)
      .order("occurred_at", { ascending: false });
    if (!error) {
      setRows(data || []);
      setWeekTotal(
        (data || []).reduce((s, r) => s + Number(r.bonus_amount || 0), 0)
      );
    }
  }
  useEffect(() => {
    refresh();
  }, [weekStartISO]); // eslint-disable-line

  return (
    <div className="py-8">
      <style>{`
        header.sdg-header-bleed{position:relative;left:50%;right:50%;margin-left:-50vw;margin-right:-50vw;width:100vw;border-radius:0;padding-left:max(env(safe-area-inset-left),24px);padding-right:max(env(safe-area-inset-right),24px);}
        header.sdg-header-bleed .container, header.sdg-header-bleed .mx-auto, header.sdg-header-bleed [class*="max-w-"]{max-width:none!important;width:100%!important;}
        .page-full{max-width:100%!important;width:100%!important;}
      `}</style>

      <div className="page-full px-4 md:px-6 bg-gradient-to-b from-[#fafbfc] via-[#f7f6f3] to-[#f6f5f2] dark:from-[#2a3040] dark:via-[#262c38] dark:to-[#232835]">
        <header className="mb-5">
          <h1 className="font-heading text-3xl md:text-4xl">Commendations</h1>
          <p className="text-sdg-slate dark:text-white/70 mt-1">
            Record bonuses paid for great performance.
          </p>
        </header>

        <Frame title="Add Commendation">
          <div className="grid gap-3 md:grid-cols-12">
            <FieldShell
              label="Date & Time"
              required
              className="md:col-span-3"
              error={errors.when}
            >
              <input
                className={inputBase}
                type="datetime-local"
                value={whenISO}
                onChange={(e) => setWhenISO(e.target.value)}
              />
            </FieldShell>

            <FieldShell
              label="Employee (from roster)"
              required
              className="md:col-span-4"
              error={errors.emp}
            >
              <select
                className={inputBase}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                <option value="">Select…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
              {!people.length ? (
                <p className="mt-1 text-xs text-slate-500">
                  No eligible guards found (active 1099 roster).
                </p>
              ) : null}
            </FieldShell>

            <FieldShell
              label="Amount (USD)"
              required
              className="md:col-span-2"
              error={errors.amount}
            >
              <input
                className={inputBase}
                placeholder="50.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
              />
            </FieldShell>

            <FieldShell label="Reason" className="md:col-span-12">
              <textarea
                className={inputBase + " py-2"}
                rows={2}
                placeholder="What did they do?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </FieldShell>
          </div>

          <div className="mt-3">
            <button className="btn btn-primary" onClick={openConfirm}>
              Save Commendation
            </button>
          </div>
        </Frame>

        <div className="mt-6">
          <Frame title="Commendation Logs (Weekly)">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1.5 rounded-md border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => setWeekStartISO((iso) => addDaysISO(iso, -7))}
                >
                  ← Prev
                </button>
                <div className="font-semibold">
                  {(() => {
                    const endISO = addDaysISO(weekStartISO, 6);
                    const fmt = (iso) => {
                      const [y, m, d] = iso.split("-").map(Number);
                      return new Intl.DateTimeFormat("en-US", {
                        timeZone: ET,
                        weekday: "short",
                        month: "short",
                        day: "2-digit",
                        year: "numeric",
                      }).format(ymdToDateUTC(y, m, d));
                    };
                    return `${fmt(weekStartISO)} — ${fmt(endISO)}`;
                  })()}
                </div>
                <button
                  className="px-3 py-1.5 rounded-md border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => setWeekStartISO((iso) => addDaysISO(iso, +7))}
                >
                  Next →
                </button>
              </div>
              <Metric label="Total (week)" value={currency(weekTotal)} />
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-600 dark:text-slate-300">
                    <th className="py-2 pr-3 font-semibold">When (ET)</th>
                    <th className="py-2 pr-3 font-semibold">Employee</th>
                    <th className="py-2 pr-3 font-semibold">Amount</th>
                    <th className="py-2 pr-3 font-semibold">Reason</th>
                    <th className="py-2 pr-3 font-semibold">Supervisor</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? (
                    rows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-t border-black/5 dark:border-white/10"
                      >
                        <td className="py-2 pr-3">{formatET(r.occurred_at)}</td>
                        <td className="py-2 pr-3">{r.employee_name}</td>
                        <td className="py-2 pr-3 font-medium">
                          {currency(r.bonus_amount)}
                        </td>
                        <td className="py-2 pr-3 max-w-[320px]">
                          <div className="truncate" title={r.reason || ""}>
                            {r.reason || "—"}
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          {r.supervisor_name || "—"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        className="py-6 text-center text-slate-500"
                        colSpan={5}
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

      {/* Confirm & Save modal */}
      <ConfirmModal
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={doSave}
        confirming={confirming}
        title="Confirm Commendation"
      >
        <div className="space-y-1">
          <div>
            <span className="font-medium">When:</span>{" "}
            {formatET(toZonedUTCISO(whenISO))}
          </div>
          <div>
            <span className="font-medium">Employee:</span>{" "}
            {selectedGuard?.full_name || "—"}
          </div>
          <div>
            <span className="font-medium">Amount:</span>{" "}
            {currency(Number(String(amount).replace(/[$,\s]/g, "") || 0))}
          </div>
          {reason ? (
            <div className="mt-2">
              <div className="font-medium">Reason</div>
              <div className="text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
                {reason}
              </div>
            </div>
          ) : null}
        </div>
      </ConfirmModal>
    </div>
  );
}
