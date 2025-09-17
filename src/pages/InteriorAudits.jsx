// src/pages/InteriorAuditForm.jsx
import React, { useEffect, useMemo, useState } from "react";
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
const POSTS = ["CCTV / Dispatch", "Main Lobby", "B400", "Greenstone", "VMF"];
const DEFAULT_POST = "B400";

/** Shared labels (base checklist) */
const LABEL = {
  // Arrival & Appearance
  arrive_10min: "Arrives within 10 minutes of shift start",
  uniform_proper: "SDG uniform shirt, black BDU pants, and black shoes/boots",
  no_unauthorized_outerwear:
    "No unauthorized sweater/jacket (only black SECURITY jacket is authorized)",

  // Post Setup & Visitor Log
  visitor_log_present: "Visitor log present at this post",
  post_clean: "Post is clean, clutter-free, and trash-free",
  radio_present_ok: "SDG radio present and operational",

  // Access Control — Bag Checks
  greet_professional: "Greets employees/visitors professionally and kindly",
  stand_up_inspect: "Stands up to inspect the bag",
  require_all_compartments:
    "Requires all compartments/zippers of the bag to be opened",
  thorough_bottom_visible:
    "Requests items moved for visibility; inspects the bottom thoroughly",
  hands_off_bag: "Remains hands-off (never physically touches anyone’s bag)",

  // Belfry Tours & Checkpoints
  tours_proper_belfry: "Knows how to conduct proper tours in the Belfry app",
  checkpoints_scan: "Knows how to scan checkpoints (NFC or geofence) correctly",
  tours_on_time: "Completes tours in the required time frames",

  // Professional Conduct & Communications
  radio_checks_hourly: "Conducts hourly radio checks (none missed)",
  posture_professional:
    "Professional posture (not slouched, head up, situationally aware)",
  off_personal_device: "Remains off personal electronic device",

  // Safety & Emergency Readiness
  stolen_item_procedure: "Knows stolen-item procedures and escalation",
  eap_find_on_belfry:
    "Knows where to find the Emergency Action Plan (EAP) on Belfry",
  knows_aed_location: "Knows location of the nearest AED",
  knows_fe_location: "Knows location of the nearest Fire Extinguisher",
};

/** Base sections used for all posts */
const BASE_SECTIONS = [
  {
    title: "Arrival & Appearance",
    items: ["arrive_10min", "uniform_proper", "no_unauthorized_outerwear"],
  },
  {
    title: "Post Setup & Visitor Log",
    items: ["visitor_log_present", "post_clean", "radio_present_ok"],
  },
  {
    title: "Access Control — Bag Check",
    items: [
      "greet_professional",
      "stand_up_inspect",
      "require_all_compartments",
      "thorough_bottom_visible",
      "hands_off_bag",
    ],
  },
  {
    title: "Belfry Tours & Checkpoints",
    items: ["tours_proper_belfry", "checkpoints_scan", "tours_on_time"],
  },
  {
    title: "Professional Conduct & Communications",
    items: [
      "radio_checks_hourly",
      "posture_professional",
      "off_personal_device",
    ],
  },
  {
    title: "Safety & Emergency Readiness",
    items: [
      "stolen_item_procedure",
      "eap_find_on_belfry",
      "knows_aed_location",
      "knows_fe_location",
    ],
  },
];

/* --------- Your EXACT post-specific questions --------- */
const POST_SPECIFIC_LABELS = {
  // CCTV / Dispatch
  cctv_checkin_procedures:
    "Does the guard know the proper BGDC visitor/employee check in procedures?",
  cctv_operate_system: "Does the guard know how to properly operate the CCTV?",
  cctv_audits_conducted: "Does the guard conduct CCTV audits?",
  cctv_promote_access_policy:
    "Does the guard know when/when not to promote access to any gate arm or turnstile?",

  // Main Lobby
  ml_freezer_suit_policy:
    "Does the guard know the proper BGDC Freezer Suit Policy? (Employees are not allowed to leave the facility with their freezer suit)",
};

const POST_SPECIFIC_SECTIONS = {
  CCTV: [
    {
      title: "CCTV / Dispatch — Site Procedures",
      items: [
        "cctv_checkin_procedures",
        "cctv_operate_system",
        "cctv_audits_conducted",
        "cctv_promote_access_policy",
      ],
    },
  ],
  MAIN_LOBBY: [
    {
      title: "Main Lobby — Site Policies",
      items: ["ml_freezer_suit_policy"],
    },
  ],
};

/* ------------------------------ Small UI bits ----------------------------- */
function Pill({ active, tone = "slate", children, ...props }) {
  const base =
    "px-3 h-8 inline-flex items-center rounded-md border text-[13px] font-medium transition focus:outline-none focus:ring-2 focus:ring-amber-300";
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

function FieldRow({ id, label, value, onChange }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-2 py-1 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] rounded-md">
      <div className="text-sm leading-tight">{label}</div>
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

/* ---------------------------- Score Dial ---------------------------- */
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
        <div className="text-xs opacity-70">
          {counts.pass} Pass • {counts.fail} Fail • {counts.na} N/A
        </div>
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
        <div className="text-xl font-semibold mb-1">
          Confirm Audit Submission
        </div>
        <div className="text-sm opacity-80 mb-4">
          Please review and confirm the details below.
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[15px] mb-5">
          <div className="opacity-60">Supervisor</div>
          <div className="font-medium">{summary.supervisor}</div>
          <div className="opacity-60">Guard</div>
          <div className="font-medium">{summary.guard}</div>
          <div className="opacity-60">Post</div>
          <div className="font-medium">{summary.post}</div>
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
export default function InteriorAuditForm() {
  /* Make global header/tabs full width on this page */
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

  const [post, setPost] = useState(DEFAULT_POST);
  const [shift, setShift] = useState("day");

  // Locked supervisor (from session)
  const [lockedSupervisor, setLockedSupervisor] = useState(null);
  const supervisorName = lockedSupervisor?.full_name || "";

  // Guard roster
  const [roster, setRoster] = useState([]);
  const [guardId, setGuardId] = useState("");
  const guardName = useMemo(
    () => roster.find((g) => g.id === guardId)?.full_name || "",
    [guardId, roster]
  );

  // Form state
  const [answers, setAnswers] = useState({});
  const [sectionNotes, setSectionNotes] = useState({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  /* Resolve the logged-in supervisor and LOCK it (like Violation page) */
  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user || null;
      const userEmail = (user?.email || "").toLowerCase();

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

  /* Canonicalize post to attach the right extra questions */
  const canonicalPost = useMemo(() => {
    const p = (post || "").toLowerCase();
    if (p.includes("cctv") || p.includes("dispatch")) return "CCTV";
    if (p.includes("main lobby") || p.includes("lobby")) return "MAIN_LOBBY";
    return "BASE";
  }, [post]);

  /* Merge base + post-specific */
  const computedSections = useMemo(() => {
    const extra =
      canonicalPost === "CCTV"
        ? POST_SPECIFIC_SECTIONS.CCTV
        : canonicalPost === "MAIN_LOBBY"
        ? POST_SPECIFIC_SECTIONS.MAIN_LOBBY
        : [];
    return [...BASE_SECTIONS, ...extra];
  }, [canonicalPost]);

  /* Expand labels with post-specific ones so FieldRow can read them */
  const LABELS_MERGED = useMemo(
    () => ({ ...LABEL, ...POST_SPECIFIC_LABELS }),
    []
  );

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

  /* Submit */
  async function submitAudit() {
    if (!lockedSupervisor) {
      alert(
        "We couldn’t link your login to a supervisor profile. Please contact admin."
      );
      return;
    }
    if (!guardId) {
      alert("Please choose the Guard (required).");
      return;
    }
    setSaving(true);
    try {
      await createAudit({
        supervisor: supervisorName, // locked to current login's guard profile
        post,
        shift,
        guard_id: guardId,
        guard_name: guardName,
        answers,
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
      alert("Audit saved.");
    } catch (e) {
      alert(e.message || "Failed to save audit.");
    } finally {
      setSaving(false);
    }
  }

  function openConfirm() {
    if (!lockedSupervisor) {
      alert(
        "We couldn’t link your login to a supervisor profile. Please contact admin."
      );
      return;
    }
    if (!guardId) return alert("Please choose the Guard (required).");
    setConfirmOpen(true);
  }

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
      `}</style>

      <div className="page-full px-4 md:px-6">
        {/* Sticky toolbar */}
        <div className="sticky top-0 z-30 mb-4 w-full">
          <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-[#0f1215]/80 backdrop-blur px-4 py-3">
            <div className="flex flex-wrap gap-4 items-end">
              {/* Supervisor – LOCKED to session */}
              <div className="grid gap-1">
                <label className="text-xs font-medium opacity-70">
                  Supervisor *
                </label>
                <input
                  type="text"
                  readOnly
                  value={supervisorName || "Not linked to a supervisor profile"}
                  className="min-w-[18rem] h-11 rounded-xl border border-black/10 dark:border-white/10 px-3 text-[15px] bg-black/[0.03] dark:bg-white/[0.06]"
                />
              </div>

              {/* Guard */}
              <div className="grid gap-1">
                <label className="text-xs font-medium opacity-70">
                  Guard *
                </label>
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

              {/* Post */}
              <div className="grid gap-1">
                <label className="text-xs font-medium opacity-70">Post</label>
                <select
                  value={post}
                  onChange={(e) => setPost(e.target.value)}
                  className="h-11 rounded-xl border border-black/10 dark:border-white/10 px-3 text-[15px] bg-white dark:bg-transparent min-w-[12rem]"
                >
                  {POSTS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              {/* Shift */}
              <div className="grid gap-1">
                <label className="text-xs font-medium opacity-70">Shift</label>
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

              {/* Score dial */}
              <div className="ml-auto">
                <ScoreDial
                  pct={counts.considered ? counts.pct : 0}
                  status={status}
                  counts={counts}
                />
              </div>

              {/* Submit */}
              <div className="ml-auto md:ml-0">
                <button
                  onClick={openConfirm}
                  disabled={saving || !lockedSupervisor}
                  className={`px-5 h-11 rounded-xl bg-sdg-gold/90 hover:bg-sdg-gold text-black font-semibold ${
                    saving || !lockedSupervisor
                      ? "opacity-60 cursor-not-allowed"
                      : ""
                  }`}
                  type="button"
                  title={
                    lockedSupervisor
                      ? "Submit Audit"
                      : "Your login isn’t mapped to a supervisor profile"
                  }
                >
                  {saving ? "Saving…" : "Submit Audit"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Sections — base + extras for CCTV / Main Lobby */}
        <div className="frame overflow-hidden">
          <div className="frame-accent" />
          <div className="p-4 space-y-3">
            {computedSections.map((sec, i) => (
              <div
                key={`${sec.title}-${i}`}
                className="rounded-xl border border-black/10 dark:border-white/10 p-3 bg-slate-50/60 dark:bg-white/[0.03]"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">{sec.title}</div>
                </div>
                <div className="divide-y divide-black/5 dark:divide-white/10">
                  {sec.items.map((id) => (
                    <FieldRow
                      key={id}
                      id={id}
                      label={LABELS_MERGED[id] || id}
                      value={answers[id]}
                      onChange={(k, v) => setAns(k, v)}
                    />
                  ))}
                </div>
                <div className="mt-2">
                  <input
                    type="text"
                    placeholder="Notes for this section (optional)"
                    value={sectionNotes[sec.title] || ""}
                    onChange={(e) => setNote(sec.title, e.target.value)}
                    className="w-full h-9 rounded-md border border-black/10 dark:border-white/10 px-2 bg-white dark:bg-transparent text-sm"
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
          </div>
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
          supervisor: supervisorName || "—",
          guard: guardName || "—",
          post,
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
