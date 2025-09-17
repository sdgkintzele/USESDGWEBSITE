// src/pages/GateAuditForm.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { createAudit, fetchGuards } from "../lib/audits";

/* ---------------- Local date helpers (no UTC drift) ---------------- */
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

/* ----------------------------- Catalog ------------------------------ */
const GATE_TYPES = ["Inbound", "Outbound"];

/** General (applies to both gate types) */
const LABEL = {
  // General — (exact phrasings requested)
  gen_on_time: "Did the guard arrive within 10 minutes of their shift?",
  gen_uniform: "Is the guard wearing the proper SDG Uniform and Hi-Vis Vest?",
  gen_professional: "Does the guard interact professionally with drivers?",
  gen_attentive: "Is the guard attentive at their truck gate lane?",

  /* Inbound — YMS Data (rephrased to \"Does the guard record ... accurately?\") */
  in_yms_driver_name: "Does the guard record Driver's Names accurately in YMS?",
  in_yms_driver_phone:
    "Does the guard record driver phone numbers accurately in YMS?",
  in_yms_license:
    "Does the guard record Driver's License/Badge Numbers accurately in YMS?",
  in_yms_trailer: "Does the guard record Trailer Numbers accurately in YMS?",
  in_yms_tractor: "Does the guard record Tractor Numbers accurately in YMS?",
  in_yms_scac:
    "Does the guard record the correct SCAC (Carrier Code) accurately in YMS?",
  in_yms_vehicle_type: "Does the guard record Vehicle Type accurately in YMS?",
  in_yms_vehicle_status:
    "Does the guard record Vehicle Status accurately in YMS?",
  in_yms_load_type:
    "Does the guard record Live vs Drop Load accurately in YMS?",
  in_yms_po: "Does the guard record PO Number(s) accurately in YMS?",
  in_yms_seal: "Does the guard record Seal Numbers accurately in YMS?",
  in_yms_origin_dest:
    "Does the guard record Origin/Destination accurately in YMS?",
  in_yms_location:
    "Does the guard record YMS Location on yard accurately in YMS?",

  /* Inbound — Inspection & Verification (kept as-is) */
  in_identify_po_on_bol: "Can locate PO numbers on BOL",
  in_input_pos_multiple: "Inputs single/multiple POs into YMS correctly",
  in_reefer_temp_gauge:
    "Checks reefer temp gauge and references setpoint on BOL",
  in_understand_temp_range: "Understands acceptable temp range vs setpoint",
  in_check_fuel_and_requirements: "Checks fuel level and inbound requirements",
  in_check_seal_matches_bol: "Verifies seal matches BOL",
  in_one_network_accuracy: "Enters all required POs into One Network",
  in_take_required_pics: "Takes all required inbound photos in YMS",
  in_use_cones_or_gate_arms: "Uses cones/gate arms to stop traffic when needed",

  /* Outbound — Automation & YMS */
  out_lane1_automation_utilize: "Understands how to utilize Lane 1 automation",
  out_lane1_only_kroger_delivery:
    "Knows only Kroger Delivery loads use Lane 1 automation",
  out_yms_driver_name: "YMS Gate-Out: Driver Name recorded",
  out_yms_tractor: "YMS Gate-Out: Tractor Number recorded",
  out_yms_seal: "YMS Gate-Out: Seal Number recorded",
  out_yms_setpoint: "YMS Gate-Out: Temperature setpoint recorded",
  out_yms_physical_temp: "YMS Gate-Out: Physical trailer temp recorded",
  out_yms_seal_intact: "YMS Gate-Out: Seal is intact verified",
  out_yms_vehicle_status: "YMS Gate-Out: Vehicle Status recorded",
  out_yms_load_type: "YMS Gate-Out: Load Type (if applicable) recorded",
  out_yms_store_numbers: "YMS Gate-Out: Store Number(s) recorded",
  out_yms_route_number: "YMS Gate-Out: Route Number recorded",
  out_take_required_pics: "Takes all required outbound photos in YMS",

  /* Outbound — Verification & Checks */
  out_check_rear_store_number: "Checks trailer rear for store number",
  out_check_fuel_gauge: "Checks fuel gauge",
  out_fuel_requirements_kroger_jb:
    "Knows fuel requirements to leave for Kroger & JB Hunt",
  out_verify_all_seals_against_trip_sheet:
    "Verifies all seals provided vs Trip Sheet",
  out_no_missed_gate_outs: "No missed gate-outs (no trailers left unprocessed)",
};

// Section definitions (IDs only)
const GENERAL = [
  "gen_on_time",
  "gen_uniform",
  "gen_professional",
  "gen_attentive",
];

const INBOUND_SECTIONS = [
  {
    title: "Inbound — YMS Data",
    items: [
      "in_yms_driver_name",
      "in_yms_driver_phone",
      "in_yms_license",
      "in_yms_trailer",
      "in_yms_tractor",
      "in_yms_scac",
      "in_yms_vehicle_type",
      "in_yms_vehicle_status",
      "in_yms_load_type",
      "in_yms_po",
      "in_yms_seal",
      "in_yms_origin_dest",
      "in_yms_location",
    ],
  },
  {
    title: "Inbound — Inspection & Verification",
    items: [
      "in_identify_po_on_bol",
      "in_input_pos_multiple",
      "in_reefer_temp_gauge",
      "in_understand_temp_range",
      "in_check_fuel_and_requirements",
      "in_check_seal_matches_bol",
      "in_one_network_accuracy",
      "in_take_required_pics",
      "in_use_cones_or_gate_arms",
    ],
  },
];

const OUTBOUND_SECTIONS = [
  {
    title: "Outbound — Automation & YMS",
    items: [
      "out_lane1_automation_utilize",
      "out_lane1_only_kroger_delivery",
      "out_yms_driver_name",
      "out_yms_tractor",
      "out_yms_seal",
      "out_yms_setpoint",
      "out_yms_physical_temp",
      "out_yms_seal_intact",
      "out_yms_vehicle_status",
      "out_yms_load_type",
      "out_yms_store_numbers",
      "out_yms_route_number",
      "out_take_required_pics",
    ],
  },
  {
    title: "Outbound — Verification & Checks",
    items: [
      "out_check_rear_store_number",
      "out_check_fuel_gauge",
      "out_fuel_requirements_kroger_jb",
      "out_verify_all_seals_against_trip_sheet",
      "out_no_missed_gate_outs",
    ],
  },
];

/* ------------------------------ Small UI bits ----------------------------- */
function Chip({ tone = "slate", children, className = "" }) {
  const map = {
    green:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200",
    red: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200",
    slate: "bg-black/5 text-slate-800 dark:bg-white/10 dark:text-slate-200",
    amber:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-md text-xs font-medium ${map[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

function Pill({ active, tone = "slate", children, ...props }) {
  const base =
    "px-3 h-10 md:h-8 inline-flex items-center rounded-md border text-[15px] md:text-[13px] font-semibold md:font-medium transition focus:outline-none focus:ring-2 focus:ring-amber-300";
  const theme =
    tone === "green"
      ? "border-green-300/70 text-green-800 dark:text-green-200 dark:border-green-700/40"
      : tone === "red"
      ? "border-rose-300/70 text-rose-800 dark:text-rose-200 dark:border-rose-700/40"
      : "border-black/15 dark:border-white/15 text-slate-800 dark:text-slate-200";
  const activeBg =
    tone === "green"
      ? "bg-green-100 dark:bg-green-900/30"
      : tone === "red"
      ? "bg-rose-100 dark:bg-rose-900/30"
      : "bg-black/5 dark:bg-white/10";
  return (
    <button
      {...props}
      className={`${base} ${theme} ${
        active
          ? activeBg
          : "bg-transparent hover:bg-black/5 dark:hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function FieldRow({ id, label, value, onChange, rowRef }) {
  return (
    <div
      ref={rowRef}
      data-item-id={id}
      className="grid grid-cols-[1fr_auto] items-center gap-3 px-2 py-2 md:py-1 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] rounded-md"
    >
      <div className="text-[16px] md:text-sm leading-tight">{label}</div>
      <div className="flex items-center gap-2">
        <Pill
          tone="green"
          active={value === true}
          onClick={() => onChange(id, true)}
        >
          Pass
        </Pill>
        <Pill
          tone="red"
          active={value === false}
          onClick={() => onChange(id, false)}
        >
          Fail
        </Pill>
        <Pill active={value === null} onClick={() => onChange(id, null)}>
          N/A
        </Pill>
      </div>
    </div>
  );
}

/* Bigger, clearer labels for toolbar controls */
function FieldLabel({ children, required = false }) {
  return (
    <label className="iaf-label">
      {children}
      {required && <span className="iaf-req"> *</span>}
    </label>
  );
}

/* ---------------------------- Score UI ---------------------------- */
function statusColor(status) {
  if (status === "pass") return "#16a34a";
  if (status === "conditional") return "#f59e0b";
  return "#dc2626";
}
function ScoreDial({ pct, status, counts }) {
  const color = statusColor(status);
  return (
    <div className="flex items-center gap-4">
      <div
        className="relative w-24 h-24 shrink-0"
        style={{
          "--pct": pct,
          "--col": color,
          background: `conic-gradient(var(--col) calc(var(--pct) * 1%), rgba(0,0,0,0.08) 0)`,
          borderRadius: "9999px",
        }}
      >
        <div className="absolute inset-1.5 rounded-full bg-white dark:bg-[#0f1215]" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-3xl font-extrabold" style={{ color }}>
            {pct}
            <span className="text-base align-top ml-0.5">%</span>
          </div>
        </div>
      </div>
      <div className="grid gap-1 text-right">
        <div className="text-xs uppercase tracking-wide opacity-60">
          Current Score
        </div>
        <div className="flex items-center gap-2 justify-end">
          <Chip tone="green">{counts.pass} Pass</Chip>
          <Chip tone="red">{counts.fail} Fail</Chip>
          <Chip tone="slate">{counts.na} N/A</Chip>
        </div>
      </div>
    </div>
  );
}

function MobileScoreBar({ counts, pct }) {
  return (
    <div className="md:hidden sticky top-0 z-[60] bg-white/90 dark:bg-[#0f1215]/90 backdrop-blur border-b border-black/10 dark:border-white/10 px-4 pt-2 pb-2">
      <div className="text-[13px] font-semibold mb-1">Current Score</div>
      <div className="h-2 w-full rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background:
              "linear-gradient(90deg,#16a34a 0%, #f59e0b 60%, #dc2626 100%)",
          }}
        />
      </div>
      <div className="mt-1.5 flex gap-2">
        <Chip tone="green">{counts.pass} Pass</Chip>
        <Chip tone="red">{counts.fail} Fail</Chip>
        <Chip tone="slate">{counts.na} N/A</Chip>
      </div>
    </div>
  );
}

/* ---------------------------- Modal ---------------------------- */
function ConfirmModal({ open, onClose, onConfirm, summary }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#12161c] p-5 shadow-2xl">
        <div className="text-xl font-semibold mb-1">Confirm Gate Audit</div>
        <div className="text-sm opacity-80 mb-4">
          Please review and confirm the details below.
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text=[15px] mb-5">
          <div className="opacity-60">Supervisor</div>
          <div className="font-medium">{summary.supervisor}</div>
          <div className="opacity-60">Guard</div>
          <div className="font-medium">{summary.guard}</div>
          <div className="opacity-60">Gate</div>
          <div className="font-medium">{summary.gate}</div>
          <div className="opacity-60">Shift</div>
          <div className="font-medium capitalize">{summary.shift}</div>
          <div className="opacity-60">Score</div>
          <div className="font-semibold">
            {summary.pct}% ({summary.pass} pass • {summary.fail} fail •{" "}
            {summary.na} N/A)
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl bg-sdg-gold/90 hover:bg-sdg-gold text-black font-semibold"
          >
            Confirm & Submit
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Page ------------------------------- */
export default function GateAuditForm() {
  useEffect(() => {
    const headerEl =
      document.querySelector("header") ||
      document.querySelector("[data-app-header]");
    if (headerEl) headerEl.classList.add("sdg-header-bleed");
    return () => headerEl && headerEl.classList.remove("sdg-header-bleed");
  }, []);

  const latestWeekStartISO = useMemo(
    () => toISODateLocal(weekStartSunday(new Date())),
    []
  );

  const [gateType, setGateType] = useState("Inbound");
  const [shift, setShift] = useState("day");
  const [myEmail, setMyEmail] = useState("");
  const [lockedSupervisor, setLockedSupervisor] = useState(null);

  const supervisorDisplay = useMemo(() => {
    if (lockedSupervisor?.full_name) {
      const mail = lockedSupervisor.email || lockedSupervisor.work_email || "";
      return mail
        ? `${lockedSupervisor.full_name} (${mail})`
        : lockedSupervisor.full_name;
    }
    return myEmail || "";
  }, [lockedSupervisor, myEmail]);

  const [roster, setRoster] = useState([]);
  const [guardId, setGuardId] = useState("");
  const guardName = useMemo(
    () => roster.find((g) => g.id === guardId)?.full_name || "",
    [guardId, roster]
  );

  // Answers & notes
  const [answers, setAnswers] = useState({}); // id -> true | false | null
  const [sectionNotes, setSectionNotes] = useState({}); // title -> string
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const rowRefs = useRef({});

  /* Resolve supervisor */
  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user || null;
      const userEmail = (user?.email || "").toLowerCase();
      setMyEmail(user?.email || "");

      const shapes = [
        "id, full_name, email, work_email, user_id, employment_type, roster_status, status, is_active, is_supervisor",
        "id, full_name, email, user_id, employment_type, roster_status, status, is_active, is_supervisor",
        "id, full_name, employment_type, roster_status, status, is_supervisor",
        "id, full_name",
      ];

      let rows = [];
      for (const sel of shapes) {
        const resp = await supabase
          .from("guards")
          .select(sel)
          .order("full_name", { ascending: true });
        if (!resp.error) {
          rows = resp.data || [];
          break;
        }
        if (!/does not exist/i.test(resp.error.message)) {
          console.warn("supervisor fetch error:", resp.error.message);
          break;
        }
      }

      const isActive = (r) => {
        const s = String(r.roster_status ?? r.status ?? "").toLowerCase();
        if (s) return s === "active";
        if (typeof r.is_active === "boolean") return r.is_active;
        return true;
      };
      const isSupe = (r) =>
        String(r.employment_type || "").toLowerCase() === "supervisor" ||
        r.is_supervisor === true;

      const supes = rows.filter((r) => isSupe(r) && isActive(r));

      const me = supes.find((r) => {
        const e1 = (r.email || "").toLowerCase();
        const e2 = (r.work_email || "").toLowerCase();
        return e1 === userEmail || e2 === userEmail || r.user_id === user?.id;
      });

      setLockedSupervisor(me || null);
    })();
  }, []);

  /* Guards roster */
  useEffect(() => {
    (async () => setRoster(await fetchGuards()))();
  }, []);

  /* Sections */
  const computedSections = useMemo(() => {
    const base = [{ title: "General", items: GENERAL }];
    return gateType === "Inbound"
      ? [...base, ...INBOUND_SECTIONS]
      : [...base, ...OUTBOUND_SECTIONS];
  }, [gateType]);

  const LABELS_MERGED = useMemo(() => ({ ...LABEL }), []);

  /* Score */
  const allItemIds = useMemo(
    () => computedSections.flatMap((s) => s.items),
    [computedSections]
  );
  const counts = useMemo(() => {
    let pass = 0,
      fail = 0,
      na = 0;
    for (const id of allItemIds) {
      const v = answers[id];
      if (v === true) pass++;
      else if (v === false) fail++;
      else if (v === null) na++;
    }
    const considered = pass + fail;
    const pct = considered ? Math.round((pass / considered) * 100) : 0;
    return { pass, fail, na, considered, pct };
  }, [answers, allItemIds]);
  const status =
    counts.pct >= 90 ? "pass" : counts.pct >= 80 ? "conditional" : "fail";

  const setAns = (key, v) => setAnswers((s) => ({ ...s, [key]: v }));
  const setNote = (key, v) => setSectionNotes((s) => ({ ...s, [key]: v }));

  const canSubmit = !!guardId && !saving;

  function answersWithNA() {
    const filled = { ...answers };
    for (const id of allItemIds) if (!(id in filled)) filled[id] = null;
    return filled;
  }

  async function submitAudit() {
    setSaving(true);
    try {
      await createAudit({
        audit_kind: "gate", // helps distinguish in shared pipeline
        supervisor: supervisorDisplay,
        gate_type: gateType,
        post: gateType, // ✅ fix: satisfy NOT NULL `post` when using interior table
        shift,
        guard_id: guardId,
        guard_name: guardName,
        answers: answersWithNA(),
        section_notes: sectionNotes,
        notes,
        score_pct: counts.pct,
        status,
        week_start: latestWeekStartISO,
        occurred_at: new Date().toISOString(),
      });
      setAnswers({});
      setSectionNotes({});
      setNotes("");
      setGuardId("");
      alert("Gate audit saved.");
    } catch (e) {
      alert(e.message || "Failed to save gate audit.");
    } finally {
      setSaving(false);
    }
  }

  function openConfirm() {
    if (!guardId) {
      alert("Please choose the Guard (required).");
      return;
    }
    setConfirmOpen(true);
  }

  // row refs (future helpers)
  useEffect(() => {
    const next = {};
    for (const id of allItemIds)
      next[id] = rowRefs.current[id] || React.createRef();
    rowRefs.current = next;
  }, [allItemIds]);

  return (
    <div className="py-5 iaf-page">
      <style>{`
        /* Global header full-bleed */
        header.sdg-header-bleed {
          position: relative; left: 50%; right: 50%;
          margin-left: -50vw; margin-right: -50vw; width: 100vw;
          border-radius: 0;
          padding-left: max(env(safe-area-inset-left), 24px);
          padding-right: max(env(safe-area-inset-right), 24px);
        }
        header.sdg-header-bleed .container,
        header.sdg-header-bleed .mx-auto,
        header.sdg-header-bleed [class*="max-w-"] { max-width: none !important; width: 100% !important; }

        /* Page body full width */
        .iaf-page .page-full { max-width: 100% !important; width: 100% !important; }

        /* Frame + inputs */
        .iaf-page .frame { border: 1px solid rgba(255,255,255,.08); border-radius: 14px; background: transparent; }
        .iaf-page .frame-accent { height: 6px; background: var(--sdg-gold, #d4af37); border-top-left-radius: 14px; border-top-right-radius: 14px; }
        input, select, textarea { background-color: #fff; color: #0f172a; border: 1px solid rgba(0,0,0,.10); }
        .dark input, .dark select, .dark textarea { background-color: #151a1e !important; color: #e5e7eb !important; border-color: rgba(255,255,255,.12) !important; }
        input:focus-visible, select:focus-visible, textarea:focus-visible { box-shadow: 0 0 0 3px rgba(212,175,55,.25); border-color: rgba(212,175,55,.45); }
        .dark input:focus-visible, .dark select:focus-visible, .dark textarea:focus-visible { box-shadow: 0 0 0 3px rgba(212,175,55,.30); border-color: rgba(212,175,55,.55); }

        /* Stronger, clearer toolbar labels */
        .iaf-label{ font-size: 1rem; line-height: 1.25rem; font-weight: 700; letter-spacing: .015em; color: #1f2937; }
        @media (min-width: 768px){ .iaf-label{ font-size: 1.05rem; } }
        .dark .iaf-label{ color: #e5e7eb; }
        .iaf-req{ color: #d4af37; margin-left: .2rem; font-weight: 800; }
      `}</style>

      {/* Mobile sticky score bar */}
      <MobileScoreBar counts={counts} pct={counts.pct} />

      <div className="page-full px-4 md:px-6">
        {/* Toolbar (desktop sticky only) */}
        <div className="md:sticky md:top-0 md:z-30 mb-4 w-full">
          <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-[#0f1215]/80 backdrop-blur px-4 py-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-4 items-end">
              <div className="grid gap-1">
                <FieldLabel required>Supervisor Conducting Audit</FieldLabel>
                <input
                  type="text"
                  readOnly
                  value={supervisorDisplay || "Loading…"}
                  className="min-w-[18rem] h-11 rounded-xl border border-black/10 dark:border-white/10 px-3 text-[15px] bg-black/[0.03] dark:bg-white/[0.06]"
                />
              </div>
              <div className="grid gap-1">
                <FieldLabel required>Guard</FieldLabel>
                <select
                  value={guardId}
                  onChange={(e) => setGuardId(e.target.value)}
                  className="min-w-[18rem] h-11 rounded-xl border border-black/10 dark:border-white/10 px-3 text-[15px] bg-white dark:bg-transparent"
                >
                  <option value="">Select a guard…</option>
                  {roster.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.full_name || g.id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <FieldLabel>Gate Type</FieldLabel>
                <div className="inline-flex h-11 items-center rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
                  {GATE_TYPES.map((gt) => (
                    <button
                      key={gt}
                      type="button"
                      onClick={() => setGateType(gt)}
                      className={`px-4 text-[15px] font-medium ${
                        gateType === gt ? "bg-black/5 dark:bg-white/10" : ""
                      }`}
                    >
                      {gt}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-1">
                <FieldLabel>Shift</FieldLabel>
                <div className="inline-flex h-11 items-center rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShift("day")}
                    className={`px-4 text-[15px] font-medium ${
                      shift === "day" ? "bg-black/5 dark:bg-white/10" : ""
                    }`}
                  >
                    Day
                  </button>
                  <div className="h-6 w-px bg-black/10 dark:bg-white/10" />
                  <button
                    type="button"
                    onClick={() => setShift("night")}
                    className={`px-4 text-[15px] font-medium ${
                      shift === "night" ? "bg-black/5 dark:bg-white/10" : ""
                    }`}
                  >
                    Night
                  </button>
                </div>
              </div>

              {/* Score dial (desktop only) */}
              <div className="ml-auto hidden md:block">
                <ScoreDial
                  pct={counts.considered ? counts.pct : 0}
                  status={status}
                  counts={counts}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Sections – all visible */}
        <div className="frame overflow-hidden">
          <div className="frame-accent" />
          <div className="p-4 space-y-3">
            {computedSections.map((sec, i) => (
              <div
                key={`${sec.title}-${i}`}
                className="rounded-xl border border-black/10 dark:border-white/10 p-3 bg-slate-50/60 dark:bg-white/[0.03]"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-[18px] md:text-base">
                    {sec.title}
                  </div>
                </div>
                <div className="divide-y divide-black/5 dark:divide-white/10">
                  {sec.items.map((id) => (
                    <FieldRow
                      key={id}
                      id={id}
                      label={LABELS_MERGED[id] || id}
                      value={answers[id]}
                      onChange={(k, v) => setAns(k, v)}
                      rowRef={rowRefs.current[id]}
                    />
                  ))}
                </div>
                <div className="mt-2">
                  <input
                    type="text"
                    placeholder="Notes for this section (optional)"
                    value={sectionNotes[sec.title] || ""}
                    onChange={(e) => setNote(sec.title, e.target.value)}
                    className="w-full h-10 md:h-9 rounded-md border border-black/10 dark:border-white/10 px-2 bg-white dark:bg-transparent text-[15px] md:text-sm"
                  />
                </div>
              </div>
            ))}

            {/* Overall notes */}
            <div className="rounded-xl border border-black/10 dark:border-white/10 p-3 bg-slate-50/60 dark:bg-white/[0.03]">
              <label className="block text-xs font-medium opacity-70 mb-1">
                Overall Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-black/10 dark:border-white/10 px-2 py-2 bg-white dark:bg-transparent"
              />
            </div>

            {/* Bottom submit */}
            <div className="flex justify-end pt-3 pb-28 md:pb-6">
              <button
                type="button"
                onClick={openConfirm}
                disabled={!canSubmit}
                className={`px-5 h-11 rounded-xl bg-sdg-gold/90 text-black font-semibold ${
                  !canSubmit
                    ? "opacity-60 cursor-not-allowed"
                    : "hover:bg-sdg-gold"
                }`}
                title={canSubmit ? "Submit Gate Audit" : "Choose a Guard first"}
              >
                {saving ? "Saving…" : "Submit Gate Audit"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky mobile submit bar */}
      <div
        className="md:hidden fixed bottom-0 inset-x-0 z-[120] bg-white/95 dark:bg-[#0f1215]/95 backdrop-blur border-t border-black/10 dark:border-white/10 px-4 py-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">Ready to submit?</div>
            <div className="text-[13px] opacity-70 truncate">
              {counts.pass} Pass • {counts.fail} Fail • {counts.na} N/A
            </div>
          </div>
          <button
            type="button"
            onClick={openConfirm}
            disabled={!canSubmit}
            className={`shrink-0 px-4 h-10 rounded-xl bg-sdg-gold/90 text-black font-semibold ${
              !canSubmit ? "opacity-60 cursor-not-allowed" : "hover:bg-sdg-gold"
            }`}
          >
            {saving ? "Saving…" : "Submit"}
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setConfirmOpen(false);
          await submitAudit();
        }}
        summary={{
          supervisor: supervisorDisplay || "—",
          guard: guardName || "—",
          gate: gateType,
          shift,
          pct: counts.considered ? counts.pct : 0,
          pass: counts.pass,
          fail: counts.fail,
          na: counts.na,
        }}
      />
    </div>
  );
}
