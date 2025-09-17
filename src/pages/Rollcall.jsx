// src/pages/Rollcall.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchGuardNames,
  getMyProfile,
  createRollcall,
  insertAssignments,
  statusFromFlags,
  sendRollcallEmail,
} from "../lib/rollcall";

/* --------------------------- Config --------------------------- */
const POSTS = [
  { id: "shift_supervisor", label: "Shift Supervisor", area: "Supervision" },
  { id: "gate_supervisor", label: "Gate Supervisor", area: "Supervision" },
  { id: "cctv", label: "CCTV", area: "Interior" },
  { id: "main_lobby", label: "Main Lobby", area: "Interior" },
  { id: "greenstone", label: "Greenstone", area: "Interior" },
  { id: "vmf", label: "Vehicle Maintenance Facility (VMF)", area: "Interior" },
  { id: "bldg_400", label: "Building 400", area: "Interior" },
  { id: "lane_1", label: "Lane 1", area: "Truck Gate" },
  { id: "lane_2", label: "Lane 2", area: "Truck Gate" },
  { id: "lane_4", label: "Lane 4", area: "Truck Gate" },
  { id: "lane_5", label: "Lane 5", area: "Truck Gate" },
  { id: "lane_6", label: "Lane 6", area: "Truck Gate" },
];
const AREAS = ["Supervision", "Interior", "Truck Gate"];

/* --------------------------- helpers --------------------------- */
function nowESTForDatetimeLocal() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .formatToParts(new Date())
    .reduce((acc, p) => ((acc[p.type] = p.value), acc), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function isValidLocalISO(iso) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso || "");
}
function formatEST(whenISO) {
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
function subjectShiftLabel(s) {
  const t = String(s || "").toLowerCase();
  return t.includes("night") ? "Nightshift" : "Dayshift";
}

const emptyRow = () => ({
  guard: "",
  flagCallout: false,
  flagNcns: false,
  flagVacant: false,
  training: false,
  trainer: "",
  replacement: "",
});
const emptyExtra = () => ({
  post_id: "",
  guard: "",
  flagCallout: false,
  flagNcns: false,
  flagVacant: false,
  training: false,
  trainer: "",
  replacement: "",
});

/* ---------------------- styled inputs ------------------- */
const inputBase =
  "w-full h-10 px-3 rounded-xl border focus:outline-none " +
  "bg-white text-black border-black/10 " +
  "dark:bg-[#0f1215] dark:text-white dark:border-white/15 focus:ring-2 ring-sdg-gold/50";

function RcSelect({ value, onChange, children, invalid, dataKey }) {
  return (
    <select
      className={
        inputBase +
        (invalid
          ? " ring-2 ring-red-400 border-red-400 focus:ring-red-400"
          : "")
      }
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-key={dataKey}
    >
      {children}
    </select>
  );
}
function RcInput({ value, onChange, placeholder }) {
  return (
    <input
      className={inputBase}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
function RcTextarea({ value, onChange, rows = 4, placeholder }) {
  return (
    <textarea
      rows={rows}
      className={inputBase + " py-2"}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/* ------------------------------ Frames ------------------------------ */
function Frame({ title, children }) {
  return (
    <div className="frame overflow-hidden">
      <div className="frame-accent" />
      <div className="p-4 md:p-5 bg-white dark:bg-[#1E2430]">
        {title ? (
          <h2 className="font-heading text-lg md:text-xl mb-3">{title}</h2>
        ) : null}
        {children}
      </div>
    </div>
  );
}
function RowBox({ children }) {
  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#141a24] px-3 py-3">
      {children}
    </div>
  );
}

/* ---------------- payload builder ------------------- */
function buildAssignmentsFromState({ rollcallId, rows, extras }) {
  const out = [];
  const nextSlot = {};
  const getSlot = (postKey) => ((nextSlot[postKey] ??= 1), nextSlot[postKey]++);

  POSTS.forEach((p) => {
    const r = rows[p.id] || {};
    const hasAny =
      r.guard ||
      r.flagCallout ||
      r.flagNcns ||
      r.flagVacant ||
      r.training ||
      r.trainer ||
      r.replacement;
    if (!hasAny) return;

    out.push({
      rollcall_id: rollcallId,
      slot_no: getSlot(p.id),
      section: p.area,
      post_key: p.id,
      post_label: p.label,
      guard_name: r.guard || null,
      training: !!r.training,
      trainer_guard_name: r.trainer || null,
      status: statusFromFlags({
        flagVacant: r.flagVacant,
        flagNcns: r.flagNcns,
        flagCallout: r.flagCallout,
      }),
    });

    if ((r.flagCallout || r.flagNcns) && r.replacement) {
      out.push({
        rollcall_id: rollcallId,
        slot_no: getSlot(p.id),
        section: p.area,
        post_key: p.id,
        post_label: p.label,
        guard_name: r.replacement,
        training: false,
        trainer_guard_name: null,
        status: "assigned",
      });
    }
  });

  (extras || []).forEach((ex) => {
    if (!ex?.post_id) return;
    const post = POSTS.find((p) => p.id === ex.post_id);
    if (!post) return;

    const hasAny =
      ex.guard ||
      ex.flagCallout ||
      ex.flagNcns ||
      ex.flagVacant ||
      ex.training ||
      ex.trainer ||
      ex.replacement;
    if (!hasAny) return;

    out.push({
      rollcall_id: rollcallId,
      slot_no: getSlot(post.id),
      section: post.area,
      post_key: post.id,
      post_label: post.label,
      guard_name: ex.guard || null,
      training: !!ex.training,
      trainer_guard_name: ex.trainer || null,
      status: statusFromFlags({
        flagVacant: ex.flagVacant,
        flagNcns: ex.flagNcns,
        flagCallout: ex.flagCallout,
      }),
    });

    if ((ex.flagCallout || ex.flagNcns) && ex.replacement) {
      out.push({
        rollcall_id: rollcallId,
        slot_no: getSlot(post.id),
        section: post.area,
        post_key: post.id,
        post_label: post.label,
        guard_name: ex.replacement,
        training: false,
        trainer_guard_name: null,
        status: "assigned",
      });
    }
  });

  return out;
}

/* ---------------- Confirmation Modal ---------------- */
function ConfirmModal({
  open,
  onCancel,
  onSend,
  shiftLabel,
  whenISO,
  supervisor,
  sending,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
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
            Confirmation of Rollcall —{" "}
            <span className="font-normal">Send email to management</span>
          </h3>
        </div>
        <div className="px-5 py-4 space-y-2 text-sm">
          <div>
            <span className="font-medium">Shift:</span> {shiftLabel || "—"}
          </div>
          <div>
            <span className="font-medium">When (EST):</span>{" "}
            {formatEST(whenISO)}
          </div>
          <div>
            <span className="font-medium">Supervisor:</span> {supervisor || "—"}
          </div>
          <p className="text-sdg-slate dark:text-white/70 mt-1">
            Press <b>Send</b> to save this roll-call and email management.
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

/* ---------------------------------- Page ----------------------------------- */
export default function Rollcall() {
  const navigate = useNavigate();

  useEffect(() => {
    const headerEl =
      document.querySelector("header") ||
      document.querySelector("[data-app-header]");
    if (headerEl) headerEl.classList.add("sdg-header-bleed");
    return () => {
      if (headerEl) headerEl.classList.remove("sdg-header-bleed");
    };
  }, []);

  const [whenISO, setWhenISO] = useState(nowESTForDatetimeLocal());
  const [shiftLabel, setShiftLabel] = useState("Day");
  const [supervisor, setSupervisor] = useState("");
  const [supervisorId, setSupervisorId] = useState(null);
  const [notes, setNotes] = useState("");
  const [roster, setRoster] = useState([]);
  const [rows, setRows] = useState(() => {
    const m = {};
    POSTS.forEach((p) => (m[p.id] = emptyRow()));
    return m;
  });
  const [extras, setExtras] = useState([]);

  useEffect(() => {
    (async () => {
      const [profile, names] = await Promise.all([
        getMyProfile(),
        fetchGuardNames(),
      ]);
      setSupervisor(profile?.full_name || profile?.email || "");
      setSupervisorId(profile?.id || null);
      setRoster(names || []);
    })();
  }, []);

  const sections = useMemo(() => {
    const map = {};
    AREAS.forEach((a) => (map[a] = POSTS.filter((p) => p.area === a)));
    return map;
  }, []);

  // Dedupe for guard + replacement (trainer is unrestricted)
  const usedGuards = useMemo(() => {
    const s = new Set();
    Object.values(rows).forEach((r) => {
      if (r.guard) s.add(r.guard);
      if (r.replacement) s.add(r.replacement);
    });
    extras.forEach((ex) => {
      if (ex.guard) s.add(ex.guard);
      if (ex.replacement) s.add(ex.replacement);
    });
    return s;
  }, [rows, extras]);
  const guardOptions = (currentValue) =>
    roster.filter((g) => !usedGuards.has(g) || g === currentValue);

  function updateRow(postId, patch) {
    setRows((r) => ({ ...r, [postId]: { ...r[postId], ...patch } }));
  }
  function updateExtra(i, patch) {
    setExtras((xs) => xs.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }

  // --- NEW: mutually exclusive flags (Callout / NCNS / Vacant) ---
  function setExclusiveFlagRow(postId, key, checked) {
    setRows((prev) => {
      const cur = prev[postId];
      const next = { ...cur };
      if (checked) {
        next.flagCallout = key === "flagCallout";
        next.flagNcns = key === "flagNcns";
        next.flagVacant = key === "flagVacant";
      } else {
        next[key] = false; // allow turning all off
      }
      if (!(next.flagCallout || next.flagNcns)) next.replacement = "";
      if (next.flagVacant) next.guard = ""; // vacant means no assigned guard
      return { ...prev, [postId]: next };
    });
  }
  function setExclusiveFlagExtra(i, key, checked) {
    setExtras((prev) => {
      const cur = prev[i];
      const next = { ...cur };
      if (checked) {
        next.flagCallout = key === "flagCallout";
        next.flagNcns = key === "flagNcns";
        next.flagVacant = key === "flagVacant";
      } else {
        next[key] = false;
      }
      if (!(next.flagCallout || next.flagNcns)) next.replacement = "";
      if (next.flagVacant) next.guard = "";
      return prev.map((x, idx) => (idx === i ? next : x));
    });
  }

  function setTrainingRow(postId, checked) {
    setRows((prev) => {
      const cur = prev[postId];
      const next = { ...cur, training: checked };
      if (!checked) next.trainer = "";
      return { ...prev, [postId]: next };
    });
  }
  function setTrainingExtra(i, checked) {
    setExtras((prev) => {
      const cur = prev[i];
      const next = { ...cur, training: checked };
      if (!checked) next.trainer = "";
      return prev.map((x, idx) => (idx === i ? next : x));
    });
  }
  function addExtra() {
    setExtras((xs) => [...xs, emptyExtra()]);
  }
  function removeExtra(i) {
    setExtras((xs) => xs.filter((_, idx) => idx !== i));
  }

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  /* --------------------- Validation --------------------- */
  const [invalidKeys, setInvalidKeys] = useState(() => new Set());
  const isInvalid = (key) => invalidKeys.has(key);

  function validateAll() {
    const nextInvalid = new Set();
    const messages = [];

    if (!supervisorId)
      messages.push("Can't determine your profile/supervisor.");
    if (!isValidLocalISO(whenISO))
      messages.push("Please enter a valid date & time.");

    POSTS.forEach((p) => {
      const r = rows[p.id] || {};
      const baseKey = `rows.${p.id}`;
      if (!r.flagVacant && !r.guard) nextInvalid.add(`${baseKey}.guard`);
      if (r.training && !r.trainer) nextInvalid.add(`${baseKey}.trainer`);
      if ((r.flagCallout || r.flagNcns) && !r.replacement)
        nextInvalid.add(`${baseKey}.replacement`);
    });

    extras.forEach((ex, i) => {
      const baseKey = `extras.${i}`;
      const anyFilled =
        ex.post_id ||
        ex.guard ||
        ex.flagVacant ||
        ex.flagCallout ||
        ex.flagNcns ||
        ex.training ||
        ex.trainer ||
        ex.replacement;

      if (anyFilled) {
        if (!ex.post_id) nextInvalid.add(`${baseKey}.post_id`);
        if (!ex.flagVacant && !ex.guard) nextInvalid.add(`${baseKey}.guard`);
        if (ex.training && !ex.trainer) nextInvalid.add(`${baseKey}.trainer`);
        if ((ex.flagCallout || ex.flagNcns) && !ex.replacement)
          nextInvalid.add(`${baseKey}.replacement`);
      }
    });

    setInvalidKeys(nextInvalid);

    if (nextInvalid.size) {
      const where = [];
      POSTS.forEach((p) => {
        const b = `rows.${p.id}`;
        if (nextInvalid.has(`${b}.guard`))
          where.push(`${p.label}: Guard required (or mark Vacant)`);
        if (nextInvalid.has(`${b}.trainer`))
          where.push(`${p.label}: Trainer required when Training`);
        if (nextInvalid.has(`${b}.replacement`))
          where.push(`${p.label}: Replacement required for Callout/NCNS`);
      });
      extras.forEach((_, i) => {
        const b = `extras.${i}`;
        if (nextInvalid.has(`${b}.post_id`))
          where.push(`Additional Row #${i + 1}: Post required`);
        if (nextInvalid.has(`${b}.guard`))
          where.push(
            `Additional Row #${i + 1}: Guard required (or mark Vacant)`
          );
        if (nextInvalid.has(`${b}.trainer`))
          where.push(
            `Additional Row #${i + 1}: Trainer required when Training`
          );
        if (nextInvalid.has(`${b}.replacement`))
          where.push(
            `Additional Row #${i + 1}: Replacement required for Callout/NCNS`
          );
      });

      const firstKey = nextInvalid.values().next().value;
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-key="${firstKey}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });

      messages.push("Please complete all required selections:");
      messages.push(...where);
    }

    return { ok: nextInvalid.size === 0, messages };
  }

  function openConfirm() {
    setErr("");
    setOk("");
    const { ok: valid, messages } = validateAll();
    if (!valid) {
      setErr(messages.join("\n"));
      return;
    }
    setConfirmOpen(true);
  }

  async function actuallySend() {
    setSaving(true);
    setErr("");
    setOk("");
    try {
      const roll = await createRollcall({
        whenISO,
        shift: shiftLabel,
        supervisor_id: supervisorId,
        supervisor_name: supervisor,
        notes: notes || null,
      });

      const payload = buildAssignmentsFromState({
        rollcallId: roll.id,
        rows,
        extras,
      });
      if (payload.length) await insertAssignments(payload);

      const subject = `Roll-Call — ${subjectShiftLabel(
        shiftLabel
      )} — ${formatEST(whenISO)} (EST)`;
      await sendRollcallEmail({
        subject,
        html: renderEmailHtml({
          whenISO,
          shiftLabel,
          supervisor,
          rows,
          extras,
        }),
      });

      setOk("Roll-call saved and email queued.");
      setConfirmOpen(false);

      navigate(
        `/hr/violations/new?source=rollcall&when=${encodeURIComponent(
          whenISO
        )}`,
        { replace: true }
      );

      setRows(() => {
        const m = {};
        POSTS.forEach((p) => (m[p.id] = emptyRow()));
        return m;
      });
      setExtras([]);
      setNotes("");
      setInvalidKeys(new Set());
    } catch (e1) {
      console.error(e1);
      setErr(e1?.message || "Could not save roll-call.");
    } finally {
      setSaving(false);
    }
  }

  /* ---------------------------------- UI ---------------------------------- */
  return (
    <div className="py-6">
      <style>{`
        header.sdg-header-bleed {
          position: relative; left: 50%; right: 50%;
          margin-left: -50vw; margin-right: -50vw; width: 100vw; border-radius: 0;
          padding-left: max(env(safe-area-inset-left), 24px);
          padding-right: max(env(safe-area-inset-right), 24px);
        }
        header.sdg-header-bleed .container,
        header.sdg-header-bleed .mx-auto,
        header.sdg-header-bleed [class*="max-w-"] {
          max-width: none !important; width: 100% !important;
        }
        .page-full { max-width: 100% !important; width: 100% !important; }
      `}</style>

      <div className="page-full px-4 md:px-6 bg-gradient-to-b from-[#fafbfc] via-[#f7f6f3] to-[#f6f5f2] dark:from-[#2a3040] dark:via-[#262c38] dark:to-[#232835]">
        <header className="mb-5">
          <h1 className="font-heading text-2xl md:text-3xl">Roll-call</h1>
          <p className="text-sdg-slate dark:text-white/70 mt-1">
            Posts, one guard per post, with flags, trainer (only if Training),
            and called-in replacement (only if Callout/NCNS). No duplicates
            across posts.
          </p>
        </header>

        {/* Header frame */}
        <Frame>
          <div className="grid lg:grid-cols-3 gap-4">
            <div>
              <div className="text-sm mb-1">Date &amp; Time (EST)</div>
              <input
                type="datetime-local"
                className={inputBase}
                value={whenISO}
                onChange={(e) => setWhenISO(e.target.value)}
              />
            </div>

            <div>
              <div className="text-sm mb-1">Shift</div>
              <RcSelect value={shiftLabel} onChange={setShiftLabel}>
                <option>Day</option>
                <option>Night</option>
              </RcSelect>
            </div>

            <div>
              <div className="text-sm mb-1">Supervisor</div>
              <RcInput
                value={supervisor}
                onChange={setSupervisor}
                placeholder="Your name"
              />
            </div>
          </div>
        </Frame>

        {/* Sections */}
        <div className="mt-6 space-y-6">
          {AREAS.map((area) => (
            <Frame key={area} title={area}>
              <div className="space-y-3">
                {sections[area].map((p) => {
                  const r = rows[p.id];
                  const primaryOpts = guardOptions(r.guard);
                  const replacementOpts = guardOptions(r.replacement);
                  const showReplacement = r.flagCallout || r.flagNcns;
                  const showTrainer = r.training;

                  return (
                    <RowBox key={p.id}>
                      <div className="grid grid-cols-12 gap-3 items-center">
                        <div className="col-span-12 md:col-span-2 text-sm font-medium">
                          {p.label}
                        </div>

                        <div className="col-span-12 md:col-span-3">
                          <RcSelect
                            value={r.guard}
                            onChange={(v) => updateRow(p.id, { guard: v })}
                            invalid={isInvalid(`rows.${p.id}.guard`)}
                            dataKey={`rows.${p.id}.guard`}
                          >
                            <option value="">Select guard…</option>
                            {primaryOpts.map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </RcSelect>
                        </div>

                        <div
                          className="col-span-12 md:col-span-3 flex flex-wrap items-center gap-4 text-sm"
                          role="group"
                          aria-label="Status flags"
                        >
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={r.flagCallout}
                              onChange={(e) =>
                                setExclusiveFlagRow(
                                  p.id,
                                  "flagCallout",
                                  e.target.checked
                                )
                              }
                            />
                            Callout
                          </label>
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={r.flagNcns}
                              onChange={(e) =>
                                setExclusiveFlagRow(
                                  p.id,
                                  "flagNcns",
                                  e.target.checked
                                )
                              }
                            />
                            NCNS
                          </label>
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={r.flagVacant}
                              onChange={(e) =>
                                setExclusiveFlagRow(
                                  p.id,
                                  "flagVacant",
                                  e.target.checked
                                )
                              }
                            />
                            Vacant
                          </label>
                        </div>

                        <div className="col-span-12 md:col-span-2 flex items-center gap-3">
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={r.training}
                              onChange={(e) =>
                                setTrainingRow(p.id, e.target.checked)
                              }
                            />
                            Training
                          </label>
                        </div>

                        {showTrainer && (
                          <div className="col-span-12 md:col-span-2">
                            <RcSelect
                              value={r.trainer}
                              onChange={(v) => updateRow(p.id, { trainer: v })}
                              invalid={isInvalid(`rows.${p.id}.trainer`)}
                              dataKey={`rows.${p.id}.trainer`}
                            >
                              <option value="">Trainer…</option>
                              {roster.map((g) => (
                                <option key={g} value={g}>
                                  {g}
                                </option>
                              ))}
                            </RcSelect>
                          </div>
                        )}

                        {showReplacement && (
                          <div className="col-span-12 md:col-span-3 md:col-start-6">
                            <RcSelect
                              value={r.replacement}
                              onChange={(v) =>
                                updateRow(p.id, { replacement: v })
                              }
                              invalid={isInvalid(`rows.${p.id}.replacement`)}
                              dataKey={`rows.${p.id}.replacement`}
                            >
                              <option value="">Replacement (called-in)…</option>
                              {replacementOpts.map((g) => (
                                <option key={g} value={g}>
                                  {g}
                                </option>
                              ))}
                            </RcSelect>
                          </div>
                        )}
                      </div>
                    </RowBox>
                  );
                })}
              </div>
            </Frame>
          ))}
        </div>

        {/* Additional Guards */}
        <div className="mt-6">
          <Frame title="Additional Guards">
            <div className="space-y-3">
              {extras.length === 0 ? (
                <div className="text-sm text-sdg-slate dark:text-white/60">
                  None.
                </div>
              ) : null}

              {extras.map((ex, i) => {
                const primaryOpts = guardOptions(ex.guard);
                const replacementOpts = guardOptions(ex.replacement);
                const showReplacement = ex.flagCallout || ex.flagNcns;
                const showTrainer = ex.training;

                return (
                  <RowBox key={i}>
                    <div className="grid grid-cols-12 gap-3 items-center">
                      <div className="col-span-12 md:col-span-2">
                        <RcSelect
                          value={ex.post_id}
                          onChange={(v) => updateExtra(i, { post_id: v })}
                          invalid={isInvalid(`extras.${i}.post_id`)}
                          dataKey={`extras.${i}.post_id`}
                        >
                          <option value="">Select post…</option>
                          {POSTS.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </RcSelect>
                      </div>

                      <div className="col-span-12 md:col-span-3">
                        <RcSelect
                          value={ex.guard}
                          onChange={(v) => updateExtra(i, { guard: v })}
                          invalid={isInvalid(`extras.${i}.guard`)}
                          dataKey={`extras.${i}.guard`}
                        >
                          <option value="">Select guard…</option>
                          {primaryOpts.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </RcSelect>
                      </div>

                      <div
                        className="col-span-12 md:col-span-3 flex flex-wrap items-center gap-4 text-sm"
                        role="group"
                        aria-label="Status flags"
                      >
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={ex.flagCallout}
                            onChange={(e) =>
                              setExclusiveFlagExtra(
                                i,
                                "flagCallout",
                                e.target.checked
                              )
                            }
                          />
                          Callout
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={ex.flagNcns}
                            onChange={(e) =>
                              setExclusiveFlagExtra(
                                i,
                                "flagNcns",
                                e.target.checked
                              )
                            }
                          />
                          NCNS
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={ex.flagVacant}
                            onChange={(e) =>
                              setExclusiveFlagExtra(
                                i,
                                "flagVacant",
                                e.target.checked
                              )
                            }
                          />
                          Vacant
                        </label>
                      </div>

                      <div className="col-span-12 md:col-span-2 flex items-center gap-3">
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={ex.training}
                            onChange={(e) =>
                              setTrainingExtra(i, e.target.checked)
                            }
                          />
                          Training
                        </label>
                      </div>

                      {showTrainer && (
                        <div className="col-span-12 md:col-span-2">
                          <RcSelect
                            value={ex.trainer}
                            onChange={(v) => updateExtra(i, { trainer: v })}
                            invalid={isInvalid(`extras.${i}.trainer`)}
                            dataKey={`extras.${i}.trainer`}
                          >
                            <option value="">Trainer…</option>
                            {roster.map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </RcSelect>
                        </div>
                      )}

                      {showReplacement && (
                        <div className="col-span-12 md:col-span-3 md:col-start-6">
                          <RcSelect
                            value={ex.replacement}
                            onChange={(v) => updateExtra(i, { replacement: v })}
                            invalid={isInvalid(`extras.${i}.replacement`)}
                            dataKey={`extras.${i}.replacement`}
                          >
                            <option value="">Replacement (called-in)…</option>
                            {replacementOpts.map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </RcSelect>
                        </div>
                      )}

                      <div className="col-span-12 flex">
                        <button
                          type="button"
                          className="ml-auto text-sm underline opacity-80 hover:opacity-100"
                          onClick={() => removeExtra(i)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </RowBox>
                );
              })}
            </div>

            <div className="mt-3">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={addExtra}
              >
                + Add guard
              </button>
            </div>
          </Frame>
        </div>

        {/* Notes */}
        <div className="mt-6">
          <Frame title="Notes (optional)">
            <RcTextarea
              value={notes}
              onChange={setNotes}
              placeholder="Anything supervisors should know…"
            />
          </Frame>
        </div>

        {/* Actions + status */}
        <div className="mt-8 flex flex-col items-center gap-3">
          <button
            className="btn btn-primary text-lg px-8 py-3"
            onClick={openConfirm}
            disabled={saving}
          >
            Send roll-call
          </button>

          {err ? (
            <pre className="text-red-500 text-sm whitespace-pre-wrap max-w-[900px] text-center">
              {err}
            </pre>
          ) : null}
          {ok ? <span className="text-emerald-400 text-sm">{ok}</span> : null}
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onSend={actuallySend}
        sending={saving}
        shiftLabel={shiftLabel}
        whenISO={whenISO}
        supervisor={supervisor}
      />
    </div>
  );
}

/* ------------------------------ Email builder ------------------------------ */
function renderEmailHtml({ whenISO, shiftLabel, supervisor, rows, extras }) {
  const dt = formatEST(whenISO);

  const allRows = [
    ...POSTS.map((p) => ({ ...rows[p.id], _postLabel: p.label })),
    ...extras
      .filter((ex) => ex.post_id)
      .map((ex) => ({
        ...ex,
        _postLabel:
          POSTS.find((p) => p.id === ex.post_id)?.label || ex.post_id || "—",
      })),
  ];

  const badge = (text, fg, bg) =>
    `<span style="display:inline-block;padding:2px 6px;margin-right:6px;font-size:12px;line-height:1;border:1px solid ${fg};color:${fg};background:${bg}">${text}</span>`;

  const FLAGS = {
    Callout: { fg: "#B91C1C", bg: "#FEE2E2" },
    NCNS: { fg: "#B45309", bg: "#FFEDD5" },
    Vacant: { fg: "#374151", bg: "#F3F4F6" },
  };

  const bodyRows = allRows
    .map((r, i) => {
      if (!r) return "";
      const zebra = i % 2 ? "#0f172a08" : "#ffffff";

      const flagsArr = [];
      if (r.flagCallout)
        flagsArr.push(badge("Callout", FLAGS.Callout.fg, FLAGS.Callout.bg));
      if (r.flagNcns)
        flagsArr.push(badge("NCNS", FLAGS.NCNS.fg, FLAGS.NCNS.bg));
      if (r.flagVacant)
        flagsArr.push(badge("Vacant", FLAGS.Vacant.fg, FLAGS.Vacant.bg));
      const flagsHTML = flagsArr.length ? flagsArr.join("") : "—";

      const trainerCell = r.training ? r.trainer || "—" : "—";
      const replacementCell =
        r.flagCallout || r.flagNcns ? r.replacement || "—" : "—";
      const trainingHTML = r.training
        ? `<span style="color:#065F46;background:#D1FAE5;border:1px solid #059669;padding:2px 6px;font-size:12px">Yes</span>`
        : "—";

      return `
        <tr style="background:${zebra}">
          <td style="padding:10px;border:1px solid #e5e7eb;">${
            r._postLabel
          }</td>
          <td style="padding:10px;border:1px solid #e5e7eb;">${
            r.guard || "—"
          }</td>
          <td style="padding:10px;border:1px solid #e5e7eb;">${flagsHTML}</td>
          <td style="padding:10px;border:1px solid #e5e7eb;">${trainingHTML}</td>
          <td style="padding:10px;border:1px solid #e5e7eb;">${trainerCell}</td>
          <td style="padding:10px;border:1px solid #e5e7eb;">${replacementCell}</td>
        </tr>`;
    })
    .join("");

  return `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
         style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0b12200a;padding:24px">
    <tr>
      <td>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="720"
               style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
          <tr><td style="height:6px;background:linear-gradient(90deg,#d4af37,#c49a2c)"></td></tr>
          <tr>
            <td style="padding:18px 20px;border-bottom:1px solid #e5e7eb">
              <div style="font-size:18px;font-weight:700;color:#0b1220">Roll-call</div>
              <div style="font-size:13px;color:#475569;margin-top:4px">
                <b>Shift:</b> ${shiftLabel}
                &nbsp; • &nbsp; <b>When:</b> ${dt} (EST)
                &nbsp; • &nbsp; <b>Supervisor:</b> ${supervisor || "—"}
              </div>
              <div style="margin-top:12px;padding:10px 12px;border:1px solid #d97706;background:#fff7ed;color:#92400e;font-size:12px">
                <b>Need to amend the schedule?</b> Please reply to this email with the change, and it will be captured in this thread.
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0">
              <table cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;font-size:14px">
                <thead>
                  <tr style="background:#0f172a0d">
                    <th align="left" style="text-align:left;padding:10px;border:1px solid #e5e7eb;font-weight:600">Post</th>
                    <th align="left" style="text-align:left;padding:10px;border:1px solid #e5e7eb;font-weight:600">Guard</th>
                    <th align="left" style="text-align:left;padding:10px;border:1px solid #e5e7eb;font-weight:600">Flags</th>
                    <th align="left" style="text-align:left;padding:10px;border:1px solid #e5e7eb;font-weight:600">Training</th>
                    <th align="left" style="text-align:left;padding:10px;border:1px solid #e5e7eb;font-weight:600">Trainer</th>
                    <th align="left" style="text-align:left;padding:10px;border:1px solid #e5e7eb;font-weight:600">Replacement</th>
                  </tr>
                </thead>
                <tbody>${bodyRows}</tbody>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 20px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.5">
              Generated automatically by Salient Ops.<br/>To request a change, reply directly to this email so your update stays in this thread.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}
