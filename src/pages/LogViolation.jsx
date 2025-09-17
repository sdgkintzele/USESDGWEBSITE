// src/pages/LogViolation.jsx
import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  memo,
  useRef,
  forwardRef,
} from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

/* ----------------------------- Config ----------------------------- */

const SHIFT_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "night", label: "Night" },
];

// Slugs that represent No-Call / No-Show (as stored in violation_types.slug)
const NCNS_SLUGS = new Set(["no_call_no_show", "no-call-no-show", "ncns"]);

// Eastern by default; set to null to use browser TZ.
const DEFAULT_TZ = "America/New_York";

// Normalize shift to what the DB CHECK expects
const normShift = (s) => (s || "night").toLowerCase().trim();

/** Build a value for <input type="datetime-local"> as YYYY-MM-DDTHH:mm */
function nowForInput(tz = DEFAULT_TZ) {
  if (!tz) {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day}T${hh}:${mm}`;
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const hh = get("hour");
  const mm = get("minute");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

/* ---------------- Time helpers (ET display + correct UTC saving) --------- */

// Validate "YYYY-MM-DDTHH:mm"
function isLocalISO(iso) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso || "");
}

// Pretty Eastern time for UI (“Aug 28, 2025, 9:27 PM”)
function formatET(whenISO) {
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

/** Convert a local ISO (treated as wall time in a specific TZ) to UTC ISO. */
function toZonedUTCISO(localIso, tz = DEFAULT_TZ) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localIso || "");
  if (!m) throw new Error("Invalid date/time.");
  const y = +m[1],
    mo = +m[2],
    d = +m[3],
    hh = +m[4],
    mm = +m[5];

  // Get the TZ offset like "GMT-4" at that instant
  const guess = new Date(Date.UTC(y, mo - 1, d, hh, mm));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
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
  const offsetLocalFromUTCmin = sign * (oh * 60 + om);

  // UTC = local - offset
  const utcMs =
    Date.UTC(y, mo - 1, d, hh, mm) - offsetLocalFromUTCmin * 60 * 1000;
  return new Date(utcMs).toISOString();
}

/* ---------------------- Inputs & Frames (match Roll-call) ------------------- */
const inputBase =
  "w-full h-10 px-3 rounded-xl border focus:outline-none " +
  "bg-white text-black border-black/10 " +
  "dark:bg-[#0f1215] dark:text-white dark:border-white/15 focus:ring-2 ring-sdg-gold/50";

function ViSelect(props) {
  return <select className={inputBase} {...props} />;
}
const ViInput = forwardRef(function ViInput(props, ref) {
  return <input ref={ref} className={inputBase} {...props} />;
});
const ViTextarea = forwardRef(function ViTextarea({ rows = 4, ...rest }, ref) {
  return (
    <textarea ref={ref} rows={rows} className={inputBase + " py-2"} {...rest} />
  );
});

function Frame({ title, children }) {
  return (
    <div className="frame overflow-hidden h-full flex flex-col">
      <div
        className="frame-accent h-1.5"
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
function RowBox({ children }) {
  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#141a24] px-3 py-3">
      {children}
    </div>
  );
}

/* ------------------------------ Toast ------------------------------ */
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
          <div className="font-medium">Violation submitted</div>
          <div className="opacity-80">{text || "Opening case…"}</div>
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
  onSend,
  sending,
  occurredAt, // local ISO (ET wall time)
  guardName,
  typeLabel,
  shiftLabel,
  post,
  lane,
  siteName,
  supervisorDisplay,
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
            Confirmation of Violation —{" "}
            <span className="font-normal">Submit to management log</span>
          </h3>
        </div>

        <div className="px-5 py-4 text-sm space-y-1.5">
          <div>
            <span className="font-medium">When (ET):</span>{" "}
            {formatET(occurredAt)}
          </div>
          <div>
            <span className="font-medium">Guard:</span> {guardName || "—"}
          </div>
          <div>
            <span className="font-medium">Type:</span> {typeLabel || "—"}
          </div>
          <div>
            <span className="font-medium">Shift:</span> {shiftLabel || "—"}
          </div>
          <div>
            <span className="font-medium">Post:</span> {post || "—"}
            {lane ? ` • ${lane}` : ""}
          </div>
          <div>
            <span className="font-medium">Site:</span> {siteName || "—"}
          </div>
          <div>
            <span className="font-medium">Supervisor:</span>{" "}
            {supervisorDisplay || "—"}
          </div>
          <p className="text-sdg-slate dark:text-white/70 mt-2">
            Press <b>Send</b> to save this violation to the management log.
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

/* ================================================================== */
/* Component                                                          */
/* ================================================================== */

export default function LogViolation() {
  const nav = useNavigate();

  // Make the global header/tabs full-bleed (same as Roll-call)
  useEffect(() => {
    const headerEl =
      document.querySelector("header") ||
      document.querySelector("[data-app-header]");
    if (headerEl) headerEl.classList.add("sdg-header-bleed");
    return () => {
      if (headerEl) headerEl.classList.remove("sdg-header-bleed");
    };
  }, []);

  /* ---------------- Options ---------------- */
  const [guards, setGuards] = useState([]);
  const [types, setTypes] = useState([]); // { id, label, slug }
  const [posts, setPosts] = useState([]);
  const [sites, setSites] = useState([]); // {id,name}

  /* ---------------- Form (controlled + refs) ---------------- */
  const [guardId, setGuardId] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => nowForInput());
  const [shift, setShift] = useState(""); // required
  const [post, setPost] = useState(""); // required
  const [siteId, setSiteId] = useState(""); // required (UUID)
  const [lane, setLane] = useState("");
  const [typeId, setTypeId] = useState("");

  // Supervisor: auto from signed-in user (no dropdown)
  const [supervisorId, setSupervisorId] = useState(""); // required
  const [supervisorDisplay, setSupervisorDisplay] = useState(""); // "Name (email)" or email

  // Uncontrolled refs
  const noteRef = useRef(null);
  const witnessRef = useRef(null);
  const signRef = useRef(null);

  // files, state
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  // toast
  const [toastOpen, setToastOpen] = useState(false);

  // who am I
  const [uid, setUid] = useState(null);

  // confirm modal
  const [confirmOpen, setConfirmOpen] = useState(false);

  /* ----------------------- Load dropdown data ----------------------- */
  useEffect(() => {
    (async () => {
      const [{ data: g }, { data: t }, { data: p }, { data: s }] =
        await Promise.all([
          supabase
            .from("guards")
            .select("id, full_name")
            .eq("status", "active")
            .order("full_name", { ascending: true }),
          supabase
            .from("violation_types")
            .select("id, label, slug")
            .order("label", { ascending: true }),
          supabase
            .from("posts")
            .select("name")
            .eq("active", true)
            .order("name", { ascending: true }),
          supabase.from("sites").select("id, name").order("name", {
            ascending: true,
          }),
        ]);

      setGuards(g || []);
      setTypes(t || []);
      setPosts(p?.map((x) => x.name) || []);
      setSites(s || []);

      // Default site to BGDC Forest Park if present
      const bgdc = (s || []).find((x) => x.name === "BGDC Forest Park");
      if (bgdc) setSiteId(bgdc.id);
    })();
  }, []);

  // Get the signed-in user, set supervisor (no list / no choice)
  useEffect(() => {
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      const myId = authData?.user?.id || null;
      setUid(myId);

      // Build a friendly display "Full Name (email)" when possible
      let display = authData?.user?.email || "";
      try {
        const { data: me } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .eq("id", myId)
          .maybeSingle();

        if (me) {
          const email = me.email || authData?.user?.email || "";
          display = me.full_name ? `${me.full_name} (${email})` : email;
        }
      } catch {
        // ignore — fall back to auth email
      }

      if (myId) setSupervisorId(myId);
      setSupervisorDisplay(display);
    })();
  }, []);

  /* ----------------------------- Helpers ---------------------------- */
  const requiresDocs = useMemo(() => {
    const vt = types.find((t) => t.id === typeId);
    const slug = vt?.slug || "";
    return slug === "callout" || slug === "early_departure";
  }, [typeId, types]);

  const onPickFiles = useCallback(
    (e) => setFiles(Array.from(e.target.files || [])),
    []
  );

  const validate = useCallback(() => {
    const currentNote = (noteRef.current?.value ?? "").trim();
    const currentSig = (signRef.current?.value ?? "").trim();
    const e = {};
    if (!guardId) e.guardId = "Select a guard.";
    if (!supervisorId)
      e.supervisorId = "Supervisor not detected. Please refresh and sign in.";
    if (!siteId) e.siteId = "Select a site.";
    if (!["day", "night"].includes(normShift(shift)))
      e.shift = "Select a shift.";
    if (!post) e.post = "Select a post.";
    if (!typeId) e.typeId = "Select a violation type.";
    if (!occurredAt || !isLocalISO(occurredAt))
      e.occurredAt = "Enter the date/time.";
    if (!currentNote) e.note = "Please enter a brief supervisor note.";
    if (currentSig.length < 2)
      e.signature = "Type your full name to sign/acknowledge.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }, [guardId, supervisorId, siteId, shift, post, occurredAt, typeId]);

  /* ----------------------------- Submit ----------------------------- */
  const actuallySubmit = useCallback(async () => {
    if (!uid) return;

    const currentNote = (noteRef.current?.value ?? "").trim();
    const currentWitness = (witnessRef.current?.value ?? "").trim();
    const currentSig = (signRef.current?.value ?? "").trim();

    setSubmitting(true);
    try {
      const occurredISO = toZonedUTCISO(occurredAt, DEFAULT_TZ);

      // 1) Create violation (IMPORTANT: site_id, normalized shift, non-null note)
      const payload = {
        site_id: siteId || null,
        guard_id: guardId,
        type_id: typeId, // your DB uses this; adjust if needed
        occurred_at: occurredISO,
        shift: normShift(shift),
        post,
        lane: lane || null,
        supervisor_note: currentNote || "", // primary field
        witness_name: currentWitness || null,
        status: "open",
        supervisor_id: supervisorId || uid,
        created_by: uid,
        supervisor_attested_at: new Date().toISOString(),
        supervisor_signature_name: currentSig,
        // optional nicety: initialize doc_status if this type requires docs
        ...(requiresDocs ? { doc_status: "pending" } : {}),
      };

      const { data: v, error: insErr } = await supabase
        .from("violations")
        .insert([payload])
        .select("id")
        .single();
      if (insErr) throw insErr;

      const violationId = v.id;

      // 1b) 🔁 Compatibility: mirror the note to common alias columns if they exist.
      const aliasCols = ["narrative", "supervisor_notes", "note"];
      for (const col of aliasCols) {
        const { error: aliasErr } = await supabase
          .from("violations")
          .update({ [col]: currentNote })
          .eq("id", violationId);
        if (aliasErr) {
          console.debug(`Skipping alias column "${col}":`, aliasErr?.message);
        }
      }

      // 2) 🔔 invoke email function ONLY for NC/NS types
      const vt = types.find((t) => t.id === typeId);
      const vtSlug = (vt?.slug || "").toLowerCase();
      if (NCNS_SLUGS.has(vtSlug)) {
        try {
          await supabase.functions.invoke("no-call-noshow-webhook", {
            body: { id: violationId, type_slug: vtSlug },
          });
        } catch (fnErr) {
          console.warn("no-call-noshow-webhook failed:", fnErr);
        }
      }

      // 3) Upload evidence (optional)
      if (files.length) {
        const uploads = files.map(async (f) => {
          const path = `violation_${violationId}/${Date.now()}_${f.name}`;
          const { error: upErr } = await supabase.storage
            .from("evidence")
            .upload(path, f, { cacheControl: "3600", upsert: false });
          if (upErr) throw upErr;

          const { error: rowErr } = await supabase
            .from("violation_files")
            .insert({
              violation_id: violationId,
              file_path: path,
              uploaded_by: uid,
            });
          if (rowErr) throw rowErr;
        });
        await Promise.all(uploads);
      }

      // 4) Success toast bubble, then go to detail
      setToastOpen(true);
      setTimeout(() => setToastOpen(false), 2500);
      setTimeout(() => nav(`/hr/violations/${violationId}`), 900);
    } catch (err) {
      console.error(err);
      alert(err.message || "Could not submit violation.");
    } finally {
      setSubmitting(false);
    }
  }, [
    files,
    guardId,
    lane,
    nav,
    occurredAt,
    post,
    shift,
    siteId,
    typeId,
    uid,
    supervisorId,
    types,
    requiresDocs,
  ]);

  const openConfirm = useCallback(
    (e) => {
      e.preventDefault();
      if (!validate()) return;
      setConfirmOpen(true);
    },
    [validate]
  );

  /* ------------------------------ UI -------------------------------- */

  const FieldShell = memo(function FieldShell({
    label,
    required,
    htmlFor,
    hint,
    error,
    children,
  }) {
    return (
      <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#141a24] p-5">
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
  });

  // Lookups for the confirm modal
  const guardName = guards.find((g) => g.id === guardId)?.full_name || "";
  const typeLabel = types.find((t) => t.id === typeId)?.label || "";
  const siteName = sites.find((s) => s.id === siteId)?.name || "";
  const shiftLabel = SHIFT_OPTIONS.find((s) => s.value === shift)?.label || "";

  return (
    <div className="py-8">
      {/* Full-bleed header + full-width page, identical to Roll-call */}
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

      {/* Full-width wrapper with the same gradient as Roll-call */}
      <div className="page-full px-4 md:px-6 bg-gradient-to-b from-[#fafbfc] via-[#f7f6f3] to-[#f6f5f2] dark:from-[#2a3040] dark:via-[#262c38] dark:to-[#232835]">
        <header className="mb-5">
          <h1 className="font-heading text-3xl md:text-4xl">
            Report Violation
          </h1>
          <p className="text-sdg-slate dark:text-white/70 mt-1">
            Record an incident, attach evidence, and sign the attestation.
          </p>
        </header>

        {/* Incident details */}
        <Frame title="Incident Details">
          <div className="grid gap-4 md:grid-cols-2">
            <FieldShell
              label="Guard"
              required
              htmlFor="vi-guard"
              error={errors.guardId}
            >
              <ViSelect
                id="vi-guard"
                value={guardId}
                onChange={(e) => setGuardId(e.target.value)}
              >
                <option value="">Select guard</option>
                {guards.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.full_name}
                  </option>
                ))}
              </ViSelect>
            </FieldShell>

            {/* Supervisor: read-only, current user */}
            <FieldShell
              label="Supervisor"
              required
              htmlFor="vi-supervisor"
              error={errors.supervisorId}
              hint="Defaults to the currently signed-in user."
            >
              <ViInput
                id="vi-supervisor"
                type="text"
                value={supervisorDisplay || ""}
                readOnly
                disabled
              />
            </FieldShell>

            <FieldShell
              label="Date/Time"
              required
              htmlFor="vi-dt"
              error={errors.occurredAt}
            >
              <ViInput
                id="vi-dt"
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </FieldShell>

            <FieldShell
              label="Site"
              required
              htmlFor="vi-site"
              error={errors.siteId}
            >
              <ViSelect
                id="vi-site"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
              >
                <option value="">Select site</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </ViSelect>
            </FieldShell>

            <FieldShell
              label="Shift"
              required
              htmlFor="vi-shift"
              error={errors.shift}
            >
              <ViSelect
                id="vi-shift"
                value={shift}
                onChange={(e) => setShift(e.target.value)}
              >
                <option value="">Select shift</option>
                {SHIFT_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </ViSelect>
            </FieldShell>

            <FieldShell
              label="Post"
              required
              htmlFor="vi-post"
              error={errors.post}
            >
              <ViSelect
                id="vi-post"
                value={post}
                onChange={(e) => setPost(e.target.value)}
              >
                <option value="">Select post</option>
                {posts.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </ViSelect>
            </FieldShell>

            <FieldShell label="Lane" htmlFor="vi-lane" hint="e.g., Lane 3">
              <ViInput
                id="vi-lane"
                type="text"
                placeholder="Lane (optional)"
                value={lane}
                onChange={(e) => setLane(e.target.value)}
              />
            </FieldShell>

            <FieldShell
              label="Violation Type"
              required
              htmlFor="vi-type"
              error={errors.typeId}
              hint={
                requiresDocs
                  ? "Docs required; status will be tracked automatically."
                  : undefined
              }
            >
              <ViSelect
                id="vi-type"
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
              >
                <option value="">Select type</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </ViSelect>
            </FieldShell>
          </div>
        </Frame>

        {/* Narrative + Evidence (equal heights on large screens) */}
        <div className="mt-6 grid gap-6 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-8">
            <Frame title="Narrative">
              <div className="space-y-4">
                <FieldShell
                  label="What happened?"
                  required
                  htmlFor="vi-note"
                  error={errors.note}
                >
                  <ViTextarea
                    id="vi-note"
                    rows={8}
                    placeholder="Provide a brief, factual description…"
                    ref={noteRef}
                    defaultValue=""
                    autoCorrect="off"
                    autoCapitalize="sentences"
                    spellCheck={true}
                    style={{ minHeight: 180, resize: "vertical" }}
                  />
                </FieldShell>

                <FieldShell
                  label="Witness"
                  htmlFor="vi-witness"
                  hint="Name (if any)"
                >
                  <ViInput
                    id="vi-witness"
                    type="text"
                    ref={witnessRef}
                    defaultValue=""
                    autoComplete="off"
                    inputMode="text"
                    maxLength={120}
                    placeholder="Name (optional)"
                  />
                </FieldShell>
              </div>
            </Frame>
          </div>

          <div className="lg:col-span-4">
            <Frame title="Evidence">
              <input
                id="evidence-input"
                type="file"
                multiple
                accept=".pdf,image/*"
                className="sr-only"
                onChange={onPickFiles}
              />
              <label
                htmlFor="evidence-input"
                className="group flex h-40 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-black/20 bg-white/70 px-4 text-center text-slate-700 transition hover:bg-white/90 dark:border-white/15 dark:bg-[#141a24] dark:text-slate-200 dark:hover:bg-[#171d28]"
                title="Click to browse or drag & drop files"
              >
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

                <span className="text-base md:text-lg font-medium">
                  Drag & drop files here
                </span>
                <span className="text-xs">
                  or <span className="underline">click to browse</span> • PDF or
                  images • 10&nbsp;MB max each
                </span>
              </label>

              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300/80">
                {files.length
                  ? `${files.length} file${
                      files.length > 1 ? "s" : ""
                    } selected`
                  : "You can add more evidence later from the violation detail page."}
              </p>

              {requiresDocs && (
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300/80">
                  For Callouts and Early Departure, the first successful upload
                  marks <em>Docs</em> as <strong>Provided</strong>.
                </p>
              )}
            </Frame>
          </div>
        </div>

        {/* Signature */}
        <div className="mt-6">
          <Frame title="Signature">
            <div className="grid gap-4 md:grid-cols-2">
              <FieldShell
                label="Type your name to sign"
                required
                htmlFor="vi-sign"
                error={errors.signature}
                hint="By signing, you acknowledge the information is accurate to the best of your knowledge."
              >
                <ViInput
                  id="vi-sign"
                  type="text"
                  placeholder="Your full name"
                  ref={signRef}
                  defaultValue=""
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={120}
                />
              </FieldShell>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                className="btn btn-primary"
                type="submit"
                disabled={submitting}
                title="Submit violation"
                onClick={openConfirm}
              >
                Submit Violation
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => nav("/hr/violations")}
              >
                Cancel
              </button>
            </div>
          </Frame>
        </div>
      </div>

      {/* Confirmation Modal (ET display) */}
      <ConfirmModal
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onSend={() => {
          setConfirmOpen(false);
          actuallySubmit();
        }}
        sending={submitting}
        occurredAt={occurredAt}
        guardName={guardName}
        typeLabel={typeLabel}
        shiftLabel={shiftLabel}
        post={post}
        lane={lane}
        siteName={siteName}
        supervisorDisplay={supervisorDisplay}
      />

      {/* Toast bubble */}
      <Toast
        show={toastOpen}
        text="Opening case…"
        onClose={() => setToastOpen(false)}
      />

      {/* Subtle input color/placeholder normalization */}
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
