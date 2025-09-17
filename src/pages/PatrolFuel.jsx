// src/pages/PatrolFuel.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/* ============================= Time helpers (ET) ============================= */

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
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get(
    "minute"
  )}`;
}

// Convert local ET wall time to UTC ISO for DB storage
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

/* ============================== Small UI bits =============================== */

const inputBase =
  "w-full h-10 px-3 rounded-xl border focus:outline-none " +
  "bg-white text-black border-black/10 " +
  "dark:bg-[#0f1215] dark:text-white dark:border-white/15 focus:ring-2 ring-sdg-gold/50";

function ViSelect(props) {
  return <select className={inputBase} {...props} />;
}
const ViInput = React.forwardRef(function ViInput(props, ref) {
  return <input ref={ref} className={inputBase} {...props} />;
});
const ViTextarea = React.forwardRef(function ViTextarea(
  { rows = 4, ...rest },
  ref
) {
  return (
    <textarea ref={ref} rows={rows} className={inputBase + " py-2"} {...rest} />
  );
});

function Frame({ title, children, className = "" }) {
  return (
    <div className={"frame overflow-hidden flex flex-col " + className}>
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

function Toast({ show, text, onClose }) {
  if (!show) return null;
  return (
    <div
      className="fixed z-[80] bottom-4 right-4 max-w-sm rounded-xl border border-black/10 dark:border-white/10 bg-white/95 dark:bg-[#1E2430]/95 backdrop-blur px-4 py-3 shadow-xl"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">✅</div>
        <div className="text-sm">
          <div className="font-medium">Fuel report saved</div>
          <div className="opacity-80">{text || "Files uploaded."}</div>
        </div>
        <button
          className="ml-2 text-xs rounded-md px-2 py-1 hover:bg-black/5 dark:hover:bg:white/10"
          onClick={onClose}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/* -------------------------- Confirmation Modal ---------------------------- */
function ConfirmModal({
  open,
  onCancel,
  onConfirm,
  sending,
  whenISO,
  vehicleLabel,
  amountUSD,
  requireQuarter,
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
          <h3 className="font-heading text-lg">Confirm Fuel Report</h3>
        </div>

        <div className="px-5 py-4 text-sm space-y-1.5">
          <div>
            <span className="font-medium">Date & Time (ET):</span> {whenISO}
          </div>
          <div>
            <span className="font-medium">Vehicle:</span> {vehicleLabel || "—"}
          </div>
          <div>
            <span className="font-medium">Total:</span> ${amountUSD}
          </div>
          <div>
            <span className="font-medium">Fuel ≤ 1/4 before fill? </span>
            {requireQuarter ? "Yes" : "No"}
          </div>
          <p className="text-sdg-slate dark:text-white/70 mt-2">
            Press <b>Save</b> to submit this fuel report.
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
            onClick={onConfirm}
            disabled={sending}
          >
            {sending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =============================== Component =============================== */

export default function PatrolFuel() {
  // full-bleed header like other pages
  useEffect(() => {
    const headerEl =
      document.querySelector("header") ||
      document.querySelector("[data-app-header]");
    if (headerEl) headerEl.classList.add("sdg-header-bleed");
    return () => {
      if (headerEl) headerEl.classList.remove("sdg-header-bleed");
    };
  }, []);

  // dropdowns
  const [vehicles, setVehicles] = useState([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("patrol_vehicles")
        .select("id,label")
        .order("label", { ascending: true });
      setVehicles(data || []);
    })();
  }, []);

  // me (supervisor)
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
        if (me) {
          display = me.full_name ? `${me.full_name} (${me.email})` : me.email;
        }
      } catch {}
      setMyDisplay(display);
    })();
  }, []);

  /* --------------------------- form state --------------------------- */
  const [occurredAt, setOccurredAt] = useState(() => nowForInput());
  const [vehicleId, setVehicleId] = useState("");
  const [totalUSD, setTotalUSD] = useState("");
  const [fuelBelowQuarter, setFuelBelowQuarter] = useState("yes"); // 'yes'/'no'
  const [notes, setNotes] = useState("");

  // files + previews
  const [gaugeFile, setGaugeFile] = useState(null);
  const [receiptFile, setReceiptFile] = useState(null);
  const [fullFile, setFullFile] = useState(null);
  const [gaugeUrl, setGaugeUrl] = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");
  const [fullUrl, setFullUrl] = useState("");

  useEffect(() => {
    gaugeFile ? setGaugeUrl(URL.createObjectURL(gaugeFile)) : setGaugeUrl("");
    receiptFile
      ? setReceiptUrl(URL.createObjectURL(receiptFile))
      : setReceiptUrl("");
    fullFile ? setFullUrl(URL.createObjectURL(fullFile)) : setFullUrl("");
    return () => {
      if (gaugeUrl) URL.revokeObjectURL(gaugeUrl);
      if (receiptUrl) URL.revokeObjectURL(receiptUrl);
      if (fullUrl) URL.revokeObjectURL(fullUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaugeFile, receiptFile, fullFile]);

  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  /* ----------------------------- validate ---------------------------- */
  function validate() {
    const e = {};
    if (!occurredAt) e.occurredAt = "Enter the date/time.";
    if (!uid) e.supervisor = "No signed-in user.";
    if (!vehicleId) e.vehicle = "Select a vehicle.";
    const amt = Number(String(totalUSD).replace(/[$,\s]/g, ""));
    if (!(amt > 0)) e.total = "Enter a valid amount.";
    if (!gaugeFile) e.gauge = "Required.";
    if (!receiptFile) e.receipt = "Required.";
    if (!fullFile) e.full = "Required.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  /* ------------------------------ save flow ----------------------------- */
  async function actuallySave() {
    setSaving(true);
    try {
      // 1) Upload all three images FIRST so we can insert with NOT NULL paths
      const clientId =
        (window.crypto && window.crypto.randomUUID?.()) ||
        `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const bucket = supabase.storage.from("patrol-fuel");

      const cleanName = (s) => (s || "").replace(/[^\w.\-]+/g, "_");

      async function uploadOne(file, kind) {
        const path = `fuel_${clientId}/${kind}_${Date.now()}_${cleanName(
          file.name
        )}`;
        const { error: upErr } = await bucket.upload(path, file, {
          cacheControl: "3600",
          upsert: false,
        });
        if (upErr) throw upErr;
        return path;
      }

      const [gPath, rPath, fPath] = await Promise.all([
        uploadOne(gaugeFile, "gauge"),
        uploadOne(receiptFile, "receipt"),
        uploadOne(fullFile, "full"),
      ]);

      // 2) Insert row
      const occurredUTC = toZonedUTCISO(occurredAt);
      const amount = Number(String(totalUSD).replace(/[$,\s]/g, "") || 0);

      const payload = {
        occurred_at: occurredUTC,
        vehicle_id: vehicleId,
        supervisor_id: uid,
        supervisor_name: myDisplay,
        total_cost: amount,
        fuel_before_pct: fuelBelowQuarter === "yes" ? 25 : null,
        notes: notes.trim() || null,
        gauge_before_path: gPath,
        receipt_path: rPath,
        tank_full_path: fPath,
      };

      const { error: insErr } = await supabase
        .from("patrol_fuel_logs")
        .insert([payload]);
      if (insErr) throw insErr;

      setToastOpen(true);
      setTimeout(() => setToastOpen(false), 2500);

      // reset form
      setVehicleId("");
      setTotalUSD("");
      setFuelBelowQuarter("yes");
      setNotes("");
      setGaugeFile(null);
      setReceiptFile(null);
      setFullFile(null);
    } catch (err) {
      console.error(err);
      alert(err.message || "Could not save fuel report.");
    } finally {
      setSaving(false);
    }
  }

  function openConfirm(e) {
    e.preventDefault();
    if (!validate()) return;
    setConfirmOpen(true);
  }

  /* ------------------------------ UI -------------------------------- */

  const vehicleLabel = vehicles.find((v) => v.id === vehicleId)?.label || "";

  return (
    <div className="py-8">
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
        .page-full { max-width: 100% !important; width: 100% !important; }
      `}</style>

      <div className="page-full px-4 md:px-6 bg-gradient-to-b from-[#fafbfc] via-[#f7f6f3] to-[#f6f5f2] dark:from-[#2a3040] dark:via-[#262c38] dark:to-[#232835]">
        <header className="mb-5">
          <h1 className="font-heading text-3xl md:text-4xl">
            Patrol Gas Expense Report
          </h1>
          <p className="text-sdg-slate dark:text-white/70 mt-1">
            Log required fuel details and photos. All fields are required.
          </p>
        </header>

        <div className="space-y-5">
          {/* SECTION 1 — Date & Time + Supervisor */}
          <Frame title="Details">
            <div className="grid gap-3 md:grid-cols-12">
              <FieldShell
                label="Date & Time"
                required
                htmlFor="pf-dt"
                error={errors.occurredAt}
                className="md:col-span-6"
              >
                <ViInput
                  id="pf-dt"
                  type="datetime-local"
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
                />
              </FieldShell>

              <FieldShell
                label="Supervisor"
                required
                htmlFor="pf-sup"
                error={errors.supervisor}
                className="md:col-span-6"
              >
                <ViInput id="pf-sup" type="text" value={myDisplay} readOnly />
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300/80">
                  Uses your current login. The record stores your user ID.
                </p>
              </FieldShell>
            </div>
          </Frame>

          {/* SECTION 2 — Vehicle / Total / Fuel / Notes */}
          <Frame title="Fuel Entry">
            <div className="grid gap-3 md:grid-cols-12">
              <FieldShell
                label="Vehicle"
                required
                htmlFor="pf-veh"
                error={errors.vehicle}
                className="md:col-span-3"
              >
                <ViSelect
                  id="pf-veh"
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </ViSelect>
              </FieldShell>

              <FieldShell
                label="Total Gas (USD)"
                required
                htmlFor="pf-total"
                error={errors.total}
                hint="Enter total gas amount."
                className="md:col-span-3"
              >
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 select-none opacity-70">
                    $
                  </span>
                  <ViInput
                    id="pf-total"
                    type="text"
                    inputMode="decimal"
                    placeholder="$ 40.00"
                    value={totalUSD}
                    onChange={(e) => setTotalUSD(e.target.value)}
                    style={{ paddingLeft: 24 }}
                  />
                </div>
              </FieldShell>

              <FieldShell
                label="Fuel ≤ 1/4 before fill?"
                required
                htmlFor="pf-quarter"
                className="md:col-span-3"
              >
                <ViSelect
                  id="pf-quarter"
                  value={fuelBelowQuarter}
                  onChange={(e) => setFuelBelowQuarter(e.target.value)}
                >
                  <option value="yes">Yes (required)</option>
                  <option value="no">No</option>
                </ViSelect>
              </FieldShell>

              <FieldShell
                label="Notes"
                htmlFor="pf-notes"
                className="md:col-span-3"
              >
                <ViTextarea
                  id="pf-notes"
                  rows={2}
                  placeholder="Any context or exceptions…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{ minHeight: 42, resize: "vertical" }}
                />
              </FieldShell>
            </div>
          </Frame>

          {/* SECTION 3 — Pictures */}
          <Frame title="Pictures">
            <div className="grid gap-3 md:grid-cols-3">
              <FieldShell
                label="Photo: Gauge (Before)"
                required
                error={errors.gauge}
              >
                <DropArea
                  accept="image/*"
                  file={gaugeFile}
                  onFile={setGaugeFile}
                  previewUrl={gaugeUrl}
                />
              </FieldShell>

              <FieldShell
                label="Photo: Receipt"
                required
                error={errors.receipt}
              >
                <DropArea
                  accept="image/*"
                  file={receiptFile}
                  onFile={setReceiptFile}
                  previewUrl={receiptUrl}
                />
              </FieldShell>

              <FieldShell label="Photo: Full Tank" required error={errors.full}>
                <DropArea
                  accept="image/*"
                  file={fullFile}
                  onFile={setFullFile}
                  previewUrl={fullUrl}
                />
              </FieldShell>
            </div>

            {/* Centered button -> opens Confirm */}
            <div className="mt-4 flex items-center justify-center">
              <button
                className="btn btn-primary px-6"
                onClick={openConfirm}
                disabled={saving}
              >
                Save Fuel Report
              </button>
            </div>
          </Frame>
        </div>
      </div>

      {/* Confirmation modal */}
      <ConfirmModal
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setConfirmOpen(false);
          await actuallySave();
        }}
        sending={saving}
        whenISO={occurredAt}
        vehicleLabel={vehicleLabel}
        amountUSD={String(totalUSD).replace(/[$,\s]/g, "") || "0.00"}
        requireQuarter={fuelBelowQuarter === "yes"}
      />

      <Toast
        show={toastOpen}
        text="Your Patrol Gas Expense Report has been saved."
        onClose={() => setToastOpen(false)}
      />

      <style>{`
        ::placeholder { color: #64748b; }
        .dark ::placeholder { color: #9aa4b2 !important; }
        .dark input[type="datetime-local"]::-webkit-calendar-picker-indicator {
          filter: invert(1) brightness(1.15);
        }
      `}</style>
    </div>
  );
}

/* ------------------------- DropArea (camera + browse + preview) ------------------------- */

function DropArea({ accept, file, onFile, previewUrl }) {
  const browseRef = useRef(null);
  const cameraRef = useRef(null);

  function validateAndSet(f) {
    if (!f) return;
    const type = f.type || "";
    const isImage =
      type.startsWith("image/") ||
      /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/i.test(f.name || "");
    if (!isImage) {
      alert("Please select an image.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      alert("Max file size is 10MB.");
      return;
    }
    onFile(f);
  }

  function onPick(e) {
    const f = (e.target.files && e.target.files[0]) || null;
    validateAndSet(f);
    // reset value so the same file can be picked again if needed
    e.target.value = "";
  }

  function onDrop(e) {
    e.preventDefault();
    const f = (e.dataTransfer?.files && e.dataTransfer.files[0]) || null;
    validateAndSet(f);
  }

  function onDragOver(e) {
    e.preventDefault();
  }

  return (
    <>
      {/* hidden pickers */}
      <input
        ref={browseRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={onPick}
      />
      <input
        ref={cameraRef}
        type="file"
        accept={accept}
        capture="environment" /* opens rear camera on mobile where supported */
        className="sr-only"
        onChange={onPick}
      />

      <div className="relative">
        {/* action buttons */}
        <div className="absolute right-2 top-2 z-10 flex gap-2">
          <button
            type="button"
            className="text-xs rounded-md border border-black/10 dark:border-white/15 bg-white/80 dark:bg-[#1E2430]/80 backdrop-blur px-2 py-1 hover:bg-white dark:hover:bg-[#252d3d]"
            onClick={(e) => {
              e.stopPropagation();
              cameraRef.current?.click();
            }}
            title="Open camera"
          >
            📷 Take photo
          </button>
          <button
            type="button"
            className="text-xs rounded-md border border-black/10 dark:border-white/15 bg-white/80 dark:bg-[#1E2430]/80 backdrop-blur px-2 py-1 hover:bg-white dark:hover:bg-[#252d3d]"
            onClick={(e) => {
              e.stopPropagation();
              browseRef.current?.click();
            }}
            title="Browse files"
          >
            📁 Browse
          </button>
        </div>

        {/* drop surface */}
        <div
          className="group flex h-44 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-black/20 bg-white/70 px-4 text-center text-slate-700 transition hover:bg-white/90 dark:border-white/15 dark:bg-[#141a24] dark:text-slate-200 dark:hover:bg-[#171d28]"
          onClick={() => browseRef.current?.click()}
          onDrop={onDrop}
          onDragOver={onDragOver}
          title="Click to browse, drag a file, or use Take photo"
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="preview"
              className="h-40 object-contain rounded-md"
            />
          ) : (
            <>
              <svg
                className="h-8 w-8 opacity-70 group-hover:opacity-100"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7 16a5 5 0 0 1 .9-9.9A6 6 0 0 1 20 10.5" />
                <path d="M12 12v7" />
                <path d="m8.5 15.5 3.5-3.5 3.5 3.5" />
              </svg>
              <span className="text-base font-medium">
                Drag & drop image here
              </span>
              <span className="text-xs">
                or <span className="underline">click to browse</span> • or use{" "}
                <span className="underline">Take photo</span> • 10 MB max
              </span>
            </>
          )}
        </div>
      </div>

      {file ? (
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-300/80 truncate">
          {file.name}
        </p>
      ) : null}
    </>
  );
}
