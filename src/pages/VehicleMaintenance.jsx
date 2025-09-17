// src/pages/VehicleMaintenance.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/* ================== Config ================== */
const ET = "America/New_York";
const BUCKET_NAME = "vehicle-maintenance";

/* ================== Time helpers (ET) ================== */
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
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get(
    "minute"
  )}`;
}

// Robust ET wall-time -> UTC ISO (matches your fuel pages behavior incl. DST)
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
  const get = (t) => p.find((x) => x.type === t)?.value;
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: +get("year"),
    m: +get("month"),
    d: +get("day"),
    w: wd[get("weekday")] ?? 0,
  };
}
function addDaysISO(ymdISO, days) {
  const [y, m, d] = ymdISO.split("-").map((n) => +n);
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
// Pretty ET for UI from the local input value (“YYYY-MM-DDTHH:mm”)
function formatETLocal(whenISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(whenISO || "");
  if (!m) return String(whenISO || "");
  const y = +m[1],
    mo = +m[2],
    d = +m[3],
    hh = +m[4],
    mm = +m[5];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const h12 = ((hh + 11) % 12) + 1;
  const ampm = hh >= 12 ? "PM" : "AM";
  return `${months[mo - 1]} ${d}, ${y}, ${h12}:${String(mm).padStart(
    2,
    "0"
  )} ${ampm}`;
}

function currency(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(n || 0));
}

/* ================== Tiny UI bits ================== */
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

function FieldShell({
  label,
  required,
  htmlFor,
  hint,
  error,
  children,
  className = "",
}) {
  return (
    <div
      className={
        "rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#141a24] p-4 " +
        className
      }
    >
      {label ? (
        <label
          htmlFor={htmlFor}
          className="block text-base md:text-lg font-semibold text-slate-700 dark:text-slate-200 mb-2"
        >
          {label} {required ? <span className="text-red-500">*</span> : null}
        </label>
      ) : null}
      {children}
      {hint ? (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300/80">
          {hint}
        </p>
      ) : null}
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

/* ============ Centered Success Popup ============ */
function SentPopup({ message, onClose }) {
  if (!message) return null;
  return (
    <div className="fixed inset-0 z-[90]">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[1.5px]"
        onClick={onClose}
      />
      <div className="relative h-full w-full flex items-center justify-center p-4">
        <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#0f1215] shadow-2xl px-6 py-5 text-center max-w-sm w-full">
          <div className="text-base font-semibold">
            Maintenance expense saved
          </div>
          <div className="text-sdg-slate mt-1">
            Your entry has been recorded.
          </div>
          <button className="btn btn-primary mt-3" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============ Centered Confirm & Send Modal ============ */
function ConfirmModal({
  open,
  onCancel,
  onSend,
  sending,
  whenISO,
  vehicleLabel,
  vendor,
  amountDisplay,
  desc,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[1.5px]"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-lg rounded-2xl overflow-hidden border border-black/10 dark:border-white/10 bg-white dark:bg-[#1E2430] shadow-2xl">
        <div
          className="h-1.5"
          style={{ background: "linear-gradient(90deg,#d4af37,#c49a2c)" }}
        />
        <div className="px-5 py-4 border-b border-black/10 dark:border-white/10">
          <h3 className="font-heading text-lg">
            Confirm Maintenance Expense —{" "}
            <span className="font-normal">Send to log</span>
          </h3>
        </div>

        <div className="px-5 py-4 text-sm space-y-1.5">
          <div>
            <span className="font-medium">When (ET):</span>{" "}
            {formatETLocal(whenISO)}
          </div>
          <div>
            <span className="font-medium">Vehicle:</span> {vehicleLabel || "—"}
          </div>
          <div>
            <span className="font-medium">Vendor:</span> {vendor || "—"}
          </div>
          <div>
            <span className="font-medium">Amount:</span> {amountDisplay || "—"}
          </div>
          <div>
            <span className="font-medium">Description:</span> {desc || "—"}
          </div>
          <p className="text-sdg-slate dark:text-white/70 mt-2">
            Press <b>Send</b> to save this maintenance expense.
          </p>
        </div>

        <div className="px-5 py-4 flex items-center justify-end gap-2">
          <button
            className="px-3 py-1.5 text-sm rounded-md border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10"
            onClick={onCancel}
            disabled={sending}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary px-4 py-1.5"
            onClick={onSend}
            disabled={sending}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============ Camera/Browse with preview ============ */
function DropPhoto({ file, onFile, accept = "image/*" }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState("");

  useEffect(() => {
    if (file) {
      const u = URL.createObjectURL(file);
      setPreview(u);
      return () => URL.revokeObjectURL(u);
    } else setPreview("");
  }, [file]);

  function onPick(e) {
    const f = (e.target.files && e.target.files[0]) || null;
    if (!f) return;
    if (
      !/^image\//i.test(f.type) &&
      !/\.(png|jpe?g|webp|gif|heic|heif|bmp|tiff?)$/i.test(f.name)
    ) {
      alert("Please select an image.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      alert("Max file size is 10MB.");
      return;
    }
    onFile(f);
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={onPick}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            const el = document.createElement("input");
            el.type = "file";
            el.accept = accept;
            el.capture = "environment";
            el.onchange = onPick;
            el.click();
          }}
        >
          Take photo
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => inputRef.current?.click()}
        >
          Browse…
        </button>
      </div>
      {preview ? (
        <img
          src={preview}
          alt="preview"
          className="mt-2 h-40 object-contain rounded-md"
        />
      ) : null}
      {file ? (
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300/80 truncate">
          {file.name}
        </p>
      ) : null}
    </>
  );
}

/* ================== Component ================== */
export default function VehicleMaintenance() {
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

  // vehicles
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

  // me
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

  // form state
  const [whenISO, setWhenISO] = useState(() => nowForInput());
  const [vehicleId, setVehicleId] = useState("");
  const [vendor, setVendor] = useState("");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // modal/popup state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sentPopup, setSentPopup] = useState(null);

  function validate() {
    const e = {};
    if (!whenISO) e.when = "Enter date/time.";
    if (!vehicleId) e.vehicle = "Select a vehicle.";
    if (!vendor.trim()) e.vendor = "Enter vendor.";
    const amt = Number(String(amount).replace(/[$,\s]/g, ""));
    if (!(amt > 0)) e.amount = "Enter a valid amount.";
    if (!receipt) e.receipt = "Receipt required.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function openConfirm(e) {
    e?.preventDefault?.();
    if (!validate()) return;
    setConfirmOpen(true);
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    try {
      // upload receipt to vehicle-maintenance bucket
      const bucket = supabase.storage.from(BUCKET_NAME);
      const safeName = (s) => (s || "").replace(/[^\w.\-]+/g, "_");
      const path = `vm/${Date.now()}_${safeName(receipt.name)}`;
      const { error: upErr } = await bucket.upload(path, receipt, {
        cacheControl: "3600",
        upsert: false,
      });
      if (upErr) throw upErr;

      const amt = Number(String(amount).replace(/[$,\s]/g, "") || 0);
      const payload = {
        occurred_at: toZonedUTCISO(whenISO),
        vehicle_id: vehicleId,
        vendor: vendor.trim(),
        description: desc.trim() || null,
        amount_usd: amt, // <-- correct column
        receipt_path: path,
        supervisor_id: uid,
        supervisor_name: myDisplay,
      };

      const { error: insErr } = await supabase
        .from("vehicle_maintenance_logs")
        .insert([payload]);
      if (insErr) throw insErr;

      // reset minimal
      setVendor("");
      setDesc("");
      setAmount("");
      setReceipt(null);

      // centered success popup instead of alert
      setSentPopup("Maintenance expense saved.");
      setTimeout(() => setSentPopup(null), 1600);

      // reload list
      refresh();
    } catch (e) {
      console.error(e);
      alert(e.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  // weekly logs
  const [weekStartISO, setWeekStartISO] = useState(() => etWeekStartLocalISO());
  const weekEndISO = useMemo(() => addDaysISO(weekStartISO, 7), [weekStartISO]);
  const [rows, setRows] = useState([]);
  const [weekTotal, setWeekTotal] = useState(0);

  async function refresh() {
    const startUTC = toZonedUTCISO(`${weekStartISO}T00:00`);
    const endUTC = toZonedUTCISO(`${weekEndISO}T00:00`);
    const { data, error } = await supabase
      .from("vehicle_maintenance_logs")
      .select(
        "id, occurred_at, vehicle_id, vendor, description, amount_usd, receipt_path, supervisor_name"
      )
      .gte("occurred_at", startUTC)
      .lt("occurred_at", endUTC)
      .order("occurred_at", { ascending: false });
    if (!error) {
      setRows(data || []);
      setWeekTotal(
        (data || []).reduce((s, r) => s + Number(r.amount_usd || 0), 0)
      );
    }
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStartISO]);

  // signed URL for receipt
  function ReceiptLink({ path }) {
    const [url, setUrl] = useState("");
    useEffect(() => {
      (async () => {
        if (!path) return setUrl("");
        const { data } = await supabase.storage
          .from(BUCKET_NAME)
          .createSignedUrl(path, 3600);
        setUrl(data?.signedUrl || "");
      })();
    }, [path]);
    return url ? (
      <a
        className="underline underline-offset-2"
        href={url}
        target="_blank"
        rel="noreferrer"
      >
        Receipt
      </a>
    ) : (
      <span className="text-slate-400">Receipt</span>
    );
  }

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
            Vehicle Maintenance
          </h1>
          <p className="text-sdg-slate dark:text-white/70 mt-1">
            Track all maintenance expenses by vehicle.
          </p>
        </header>

        <Frame title="Add Vehicle Maintenance Expense">
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
              label="Vehicle"
              required
              className="md:col-span-3"
              error={errors.vehicle}
            >
              <select
                className={inputBase}
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
              >
                <option value="">Select…</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </FieldShell>

            <FieldShell
              label="Vendor"
              required
              className="md:col-span-3"
              error={errors.vendor}
            >
              <input
                className={inputBase}
                placeholder="AutoZone, Shop…"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
              />
            </FieldShell>

            <FieldShell
              label="Amount (USD)"
              required
              className="md:col-span-3"
              error={errors.amount}
            >
              <input
                className={inputBase}
                placeholder="125.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
              />
            </FieldShell>

            <FieldShell label="Description" className="md:col-span-12">
              <textarea
                className={inputBase + " py-2"}
                rows={2}
                placeholder="Oil change, tires, wipers…"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />
            </FieldShell>

            <FieldShell
              label="Receipt / Photo"
              required
              className="md:col-span-12"
              error={errors.receipt}
            >
              <DropPhoto file={receipt} onFile={setReceipt} />
            </FieldShell>
          </div>

          <div className="mt-3">
            <button
              className="btn btn-primary"
              onClick={openConfirm}
              disabled={saving}
            >
              Save Maintenance Expense
            </button>
          </div>
        </Frame>

        <div className="mt-6">
          <Frame title="Maintenance Logs (Weekly)">
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
                      const [y, m, d] = iso.split("-").map((n) => +n);
                      const utc = ymdToDateUTC(y, m, d);
                      return new Intl.DateTimeFormat("en-US", {
                        timeZone: ET,
                        weekday: "short",
                        month: "short",
                        day: "2-digit",
                        year: "numeric",
                      }).format(utc);
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
                    <th className="py-2 pr-3 font-semibold">Vehicle</th>
                    <th className="py-2 pr-3 font-semibold">Vendor</th>
                    <th className="py-2 pr-3 font-semibold">Amount</th>
                    <th className="py-2 pr-3 font-semibold">Receipt</th>
                    <th className="py-2 pr-3 font-semibold">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? (
                    rows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-top border-black/5 dark:border-white/10"
                      >
                        <td className="py-2 pr-3">{formatET(r.occurred_at)}</td>
                        <td className="py-2 pr-3">{vLabel(r.vehicle_id)}</td>
                        <td className="py-2 pr-3">{r.vendor || "—"}</td>
                        <td className="py-2 pr-3 font-medium">
                          {currency(r.amount_usd)}
                        </td>
                        <td className="py-2 pr-3">
                          <ReceiptLink path={r.receipt_path} />
                        </td>
                        <td className="py-2 pr-3 max-w-[320px]">
                          <div className="truncate" title={r.description || ""}>
                            {r.description || "—"}
                          </div>
                        </td>
                      </tr>
                    ))
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

        {/* Confirm & Send modal */}
        <ConfirmModal
          open={confirmOpen}
          onCancel={() => setConfirmOpen(false)}
          onSend={() => {
            setConfirmOpen(false);
            save();
          }}
          sending={saving}
          whenISO={whenISO}
          vehicleLabel={vLabel(vehicleId)}
          vendor={vendor}
          amountDisplay={
            amount
              ? currency(Number(String(amount).replace(/[$,\s]/g, "")))
              : ""
          }
          desc={desc}
        />

        {/* Centered success popup */}
        <SentPopup message={sentPopup} onClose={() => setSentPopup(null)} />
      </div>
    </div>
  );
}
