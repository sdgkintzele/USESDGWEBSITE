// src/pages/ViolationDetail.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const REQUIRES_DOCS = new Set(["callout", "early_departure"]);

export default function ViolationDetail() {
  const { id } = useParams();
  const nav = useNavigate();

  /* ---------------- Data ---------------- */
  const [row, setRow] = useState(null);
  const [files, setFiles] = useState([]);
  const [links, setLinks] = useState({});
  const [saving, setSaving] = useState(false);
  const [upLoading, setUpLoading] = useState(false);

  // Who am I?
  const [me, setMe] = useState(null); // { id, full_name, role }
  const isManager = String(me?.role || "").toLowerCase() === "manager";

  // Manager notes
  const [managerNote, setManagerNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const noteDirty = useMemo(
    () => (row?.manager_note ?? "") !== managerNote,
    [row, managerNote]
  );

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

  // Load violation row
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("violations")
        .select(
          `
          id, occurred_at, shift, post, lane, status, doc_status, supervisor_note,
          breach_days, eligible_return_date, witness_name, supervisor_signature_name,
          approved_by, manager_note,
          approved_by_profile:profiles!violations_approved_by_fkey ( full_name ),
          guards:guards ( full_name ),
          violation_types:violation_types ( label, slug )
        `
        )
        .eq("id", id)
        .single();
      if (!error) {
        setRow(data);
        setManagerNote(data?.manager_note ?? "");
      }
    })();
  }, [id]);

  // Evidence list
  const refetchFiles = useCallback(async () => {
    const { data } = await supabase
      .from("violation_files")
      .select(`id, file_path, uploaded_at, uploaded_by:profiles(full_name)`)
      .eq("violation_id", id)
      .order("uploaded_at", { ascending: false });
    setFiles(data || []);
  }, [id]);

  useEffect(() => {
    refetchFiles();
  }, [id, refetchFiles]);

  // Signed URLs
  useEffect(() => {
    (async () => {
      const out = {};
      for (const f of files) {
        const { data, error } = await supabase.storage
          .from("evidence")
          .createSignedUrl(f.file_path, 3600);
        out[f.id] = error ? null : data?.signedUrl ?? null;
      }
      setLinks(out);
    })();
  }, [files]);

  const actionsDisabled = useMemo(() => saving || !row, [saving, row]);

  /* ---------------- Mutations ---------------- */
  const updateDoc = async (doc_status) => {
    setSaving(true);
    const { error } = await supabase
      .from("violations")
      .update({ doc_status })
      .eq("id", id);
    setSaving(false);
    if (error) return alert(error.message);
    setRow((r) => ({ ...r, doc_status }));
  };

  const setStatus = async (status) => {
    setSaving(true);
    const { error } = await supabase
      .from("violations")
      .update({ status })
      .eq("id", id);
    setSaving(false);
    if (error) return alert(error.message);

    // Optimistic: reflect approver locally
    setRow((r) => {
      if (!r) return r;
      if (status === "closed") {
        return {
          ...r,
          status,
          approved_by: me?.id ?? r.approved_by,
          approved_by_profile: {
            full_name: me?.full_name ?? r.approved_by_profile?.full_name,
          },
        };
      }
      return { ...r, status, approved_by: null, approved_by_profile: null };
    });
  };

  const handleUpload = async (event) => {
    const filesToUpload = [...event.target.files];
    if (!filesToUpload.length || !row) return;

    setUpLoading(true);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess?.session?.user?.id;
    let didUpload = false;

    for (const file of filesToUpload) {
      const path = `violation_${row.id}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage
        .from("evidence")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (!upErr) {
        didUpload = true;
        await supabase.from("violation_files").insert({
          violation_id: row.id,
          file_path: path,
          uploaded_by: uid,
        });
      }
    }

    if (didUpload) {
      await refetchFiles();
      const needsDocs = REQUIRES_DOCS.has(row.violation_types?.slug);
      if (needsDocs && row.doc_status !== "provided")
        await updateDoc("provided");
    }
    setUpLoading(false);
    event.target.value = "";
  };

  // Manager-only delete
  const [deletingId, setDeletingId] = useState(null);
  const handleDeleteEvidence = async (fileRow) => {
    if (!isManager) return;
    const ok = window.confirm("Delete this evidence file permanently?");
    if (!ok) return;

    setDeletingId(fileRow.id);
    try {
      const { error: removeErr } = await supabase.storage
        .from("evidence")
        .remove([fileRow.file_path]);
      if (removeErr) throw removeErr;

      const { error: delErr } = await supabase
        .from("violation_files")
        .delete()
        .eq("id", fileRow.id);
      if (delErr) throw delErr;

      await refetchFiles();
    } catch (e) {
      console.error(e);
      alert("Could not delete evidence.");
    } finally {
      setDeletingId(null);
    }
  };

  // Save manager note
  const saveManagerNote = async () => {
    if (!isManager || !noteDirty) return;
    setNoteSaving(true);
    const { error } = await supabase
      .from("violations")
      .update({ manager_note: managerNote })
      .eq("id", id);
    setNoteSaving(false);
    if (error) return alert(error.message);
    setRow((r) => ({ ...r, manager_note: managerNote }));
  };

  /* ---------------- UI ---------------- */
  if (!row) {
    return (
      <div className="py-8">
        <div className="mx-auto max-w-3xl rounded-2xl border border-black/10 bg-white/60 p-4 dark:bg-white/5 dark:border-white/10">
          Loading…
        </div>
      </div>
    );
  }

  const needsDocs = REQUIRES_DOCS.has(row.violation_types?.slug);
  const occurredAt = fmtDateTime(row.occurred_at);

  return (
    <div className="py-8">
      <style>{`
        .surface { border-radius: 1rem; border: 1px solid rgba(0,0,0,.08); background: rgba(255,255,255,.7); box-shadow: 0 1px 0 rgba(0,0,0,.02); }
        .dark .surface { border-color: rgba(255,255,255,.12); background: rgba(255,255,255,.06); box-shadow: 0 1px 0 rgba(255,255,255,.35) inset; }
        .accent { height: 3px; background: linear-gradient(90deg,#E4B851,#F59E0B 50%,#E4B851); border-radius: 9999px; opacity:.55; }

        .toolbar { position: sticky; top: 72px; z-index: 30; }

        /* Key Facts grid (auto-fit) */
        .fact-grid { display:grid; gap:.6rem; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
      `}</style>

      <div className="mx-auto max-w-[1920px] px-6 lg:px-8 text-[16px] md:text-[17px] lg:text-[18px]">
        {/* Toolbar (Print / Export PDF only) */}
        <div className="toolbar mb-4 flex items-center gap-2 no-print">
          <button className="underline text-sm" onClick={() => nav(-1)}>
            &larr; Back
          </button>
          <div className="ml-auto flex items-center gap-2">
            <ToolbarBtn onClick={() => window.print()}>Print</ToolbarBtn>
            <ToolbarBtn onClick={() => exportPDF(row, files)}>
              Export PDF
            </ToolbarBtn>
          </div>
        </div>

        {/* ===== Case Summary ===== */}
        <section className="surface p-6 md:p-7 mb-6">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0">
              <h1 className="font-heading text-3xl md:text-4xl leading-tight">
                {row.violation_types?.label}{" "}
                <span className="opacity-70">•</span> {row.guards?.full_name}
              </h1>
              <p className="mt-1 text-sm opacity-80">Case ID: {row.id}</p>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <StatusBadge kind={row.status === "open" ? "open" : "closed"} />
              <DocsBadge needsDocs={needsDocs} docStatus={row.doc_status} />
              {row.breach_days != null && (
                <Badge tone="red">
                  ⚠︎ Breach: {row.breach_days} day
                  {row.breach_days === 1 ? "" : "s"}
                </Badge>
              )}
            </div>
          </div>

          {/* Key Facts */}
          <div className="mt-5 fact-grid">
            <Fact
              label="Violation Type"
              value={row.violation_types?.label || "—"}
            />
            <Fact label="Guard" value={row.guards?.full_name || "—"} />
            <Fact
              label="Date / Time"
              value={
                <>
                  {occurredAt}{" "}
                  <span className="opacity-70">
                    ({timeSince(row.occurred_at)})
                  </span>
                </>
              }
            />
            <Fact label="Post" value={row.post ?? "—"} />
            <Fact
              label="Status"
              value={
                <>
                  {cap(row.status)}{" "}
                  {needsDocs ? (
                    <span className="opacity-80">
                      • Docs: {prettyDocs(row.doc_status)}
                    </span>
                  ) : (
                    <span className="opacity-60">• Docs: N/A</span>
                  )}
                </>
              }
            />
            <Fact label="Shift" value={cap(row.shift)} />
            {row.lane ? <Fact label="Lane" value={row.lane} /> : null}
          </div>

          <p className="mt-4 text-sm opacity-80">
            {needsDocs
              ? "This violation requires documentation. Once appropriate docs are provided, mark them as Provided."
              : "Documentation is not required for this violation type."}
          </p>

          <div className="mt-5 accent" />
        </section>

        {/* ===== Supervisor Note + Actions ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="surface p-6 md:p-7">
            <h2 className="font-heading text-lg md:text-xl mb-3">
              Supervisor Note
            </h2>
            <p className="whitespace-pre-wrap leading-relaxed">
              {row.supervisor_note || "—"}
            </p>

            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wide opacity-70">
                  Signed
                </div>
                <div className="mt-1 font-semibold">
                  {row.supervisor_signature_name ?? "—"}
                </div>
              </div>
              {row.witness_name && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide opacity-70">
                    Witness
                  </div>
                  <div className="mt-1 font-semibold">{row.witness_name}</div>
                </div>
              )}
            </div>
          </section>

          <section className="surface p-6 md:p-7">
            <h2 className="font-heading text-lg md:text-xl mb-3">
              Case Actions
            </h2>

            {/* Documentation review */}
            {REQUIRES_DOCS.has(row.violation_types?.slug) && (
              <div className="mb-5">
                <h3 className="font-semibold mb-2">Documentation Review</h3>
                <div className="flex flex-wrap gap-2">
                  <Btn
                    disabled={actionsDisabled}
                    onClick={() => updateDoc("provided")}
                    title="Marks documents provided (reasonable; no breach)"
                  >
                    Mark Docs Provided
                  </Btn>
                  <Btn
                    disabled={actionsDisabled}
                    onClick={() => updateDoc("not_provided")}
                    title="Marks documents not provided (unreasonable; breach may apply)"
                  >
                    Mark Docs Not Provided
                  </Btn>
                </div>
                <p className="mt-2 text-sm opacity-80">
                  Choose <b>Provided</b> if the guard submitted valid
                  documentation on time. Choose <b>Not Provided</b> if documents
                  were missing or unreasonable (this may trigger a breach per
                  policy).
                </p>
              </div>
            )}

            {/* Case status */}
            <div>
              <h3 className="font-semibold mb-2">Case Status</h3>
              <div className="flex flex-wrap gap-2">
                {row.status === "open" ? (
                  <Btn
                    disabled={actionsDisabled}
                    onClick={() => setStatus("closed")}
                    title="Close this violation"
                  >
                    Close Case
                  </Btn>
                ) : (
                  <Btn
                    disabled={actionsDisabled}
                    onClick={() => setStatus("open")}
                    title="Reopen this violation"
                  >
                    Reopen Case
                  </Btn>
                )}
              </div>
              <p className="mt-2 text-sm opacity-80">
                <b>Close Case</b> finalizes the record and records you as the
                approver. You can{" "}
                {isManager
                  ? "still reopen it later if needed."
                  : "request a manager to reopen it."}
              </p>

              {row.status === "closed" &&
                row.approved_by_profile?.full_name && (
                  <p className="text-sm opacity-80 mt-2">
                    Closed by: <b>{row.approved_by_profile.full_name}</b>
                  </p>
                )}
            </div>
          </section>

          {/* ===== Evidence ===== */}
          <section className="surface p-6 md:p-7 lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-heading text-lg md:text-xl">Evidence</h2>

              {needsDocs ? (
                <label className="inline-flex items-center gap-2 text-sm no-print">
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    multiple
                    onChange={handleUpload}
                    disabled={upLoading}
                    className="hidden"
                    id="evidence-input"
                  />
                  <span
                    className={`rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 cursor-pointer ${
                      upLoading
                        ? "opacity-50 cursor-not-allowed"
                        : "hover:bg-black/5 dark:hover:bg-white/5"
                    }`}
                    onClick={() =>
                      !upLoading &&
                      document.getElementById("evidence-input").click()
                    }
                  >
                    {upLoading ? "Uploading…" : "Upload"}
                  </span>
                </label>
              ) : (
                <span className="text-sm text-sdg-slate dark:text-white/60">
                  Evidence not required
                </span>
              )}
            </div>

            {!files.length ? (
              <p className="mt-3 text-sdg-slate">No files.</p>
            ) : (
              <ul className="mt-4 divide-y divide-black/5 dark:divide-white/10">
                {files.map((f) => {
                  const filename = f.file_path.split("/").pop();
                  const ext = (filename.split(".").pop() || "").toUpperCase();
                  return (
                    <li
                      key={f.id}
                      className="py-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex items-center gap-3">
                        <span className="rounded-md border border-black/10 dark:border-white/10 px-2 py-0.5 text-[11px]">
                          {ext || "FILE"}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{filename}</div>
                          <div className="text-xs text-sdg-slate dark:text-white/70">
                            Uploaded {fmtDateTime(f.uploaded_at)}
                            {f.uploaded_by?.full_name
                              ? ` • by ${f.uploaded_by.full_name}`
                              : ""}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {links[f.id] ? (
                          <a
                            className="underline text-sm"
                            href={links[f.id]}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open
                          </a>
                        ) : (
                          <span className="text-xs">linking…</span>
                        )}

                        {isManager && (
                          <button
                            onClick={() => handleDeleteEvidence(f)}
                            disabled={deletingId === f.id}
                            className="text-sm text-red-600 hover:underline disabled:opacity-50 no-print"
                            title="Delete evidence (manager only)"
                          >
                            {deletingId === f.id ? "Deleting…" : "Delete"}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="mt-3 text-xs text-sdg-slate">
              {needsDocs ? (
                <>
                  Uploads are restricted to supervisors/managers. For Callouts
                  and Early Departure, the first successful upload automatically
                  sets <i>Docs</i> to <b>provided</b>.
                </>
              ) : (
                <>Evidence is not required for this violation type.</>
              )}
            </p>
          </section>

          {/* ===== Manager Notes ===== */}
          <section className="surface p-6 md:p-7 lg:col-span-2">
            <h2 className="font-heading text-lg md:text-xl mb-3">
              Manager Notes
            </h2>
            {isManager ? (
              <>
                <textarea
                  rows={5}
                  value={managerNote}
                  onChange={(e) => setManagerNote(e.target.value)}
                  className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#141a24] px-3 py-2"
                  placeholder="Add private manager notes for this case…"
                />
                <div className="mt-3 flex items-center gap-2">
                  <button
                    className="btn btn-primary"
                    onClick={saveManagerNote}
                    disabled={noteSaving || !noteDirty}
                    title="Save manager notes"
                  >
                    {noteSaving ? "Saving…" : "Save Notes"}
                  </button>
                  {!noteDirty && (
                    <span className="text-sm opacity-70">
                      All changes saved.
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="whitespace-pre-wrap leading-relaxed">
                {row.manager_note ? (
                  row.manager_note
                ) : (
                  <span className="opacity-70">No manager notes.</span>
                )}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Small UI helpers ---------------- */
function ToolbarBtn({ children, ...rest }) {
  return (
    <button
      className="text-sm rounded-lg border border-black/10 dark:border-white/10 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5"
      {...rest}
    >
      {children}
    </button>
  );
}

function Btn({ children, className = "", ...rest }) {
  return (
    <button
      className={`rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

function Badge({ tone = "slate", children }) {
  const theme =
    tone === "green"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200 border-green-200/70 dark:border-green-700/40"
      : tone === "red"
      ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200 border-red-200/70 dark:border-red-700/40"
      : tone === "amber"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 border-amber-200/70 dark:border-amber-700/40"
      : "bg-black/5 text-black/80 dark:bg-white/10 dark:text-white/80 border-black/10 dark:border-white/10";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] ${theme}`}
    >
      {children}
    </span>
  );
}

function StatusBadge({ kind }) {
  if (kind === "open") return <Badge tone="amber">⧗ Open</Badge>;
  return <Badge tone="green">✓ Closed</Badge>;
}
function DocsBadge({ needsDocs, docStatus }) {
  if (!needsDocs) return <Badge>Docs: N/A</Badge>;
  if (docStatus === "provided")
    return <Badge tone="green">Docs: Provided</Badge>;
  if (docStatus === "not_provided")
    return <Badge tone="red">Docs: Not Provided</Badge>;
  return <Badge>Docs: Pending</Badge>;
}

function Fact({ label, value }) {
  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.06] px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide opacity-70">
        {label}
      </div>
      <div className="mt-1 font-semibold truncate">{value}</div>
    </div>
  );
}

function prettyDocs(s) {
  if (!s) return "Pending";
  return s.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase());
}

function fmtDateTime(s) {
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s ?? "—";
  }
}
function cap(s) {
  return String(s ?? "")
    .replace(/_/g, " ")
    .replace(/^\w/, (m) => m.toUpperCase());
}
function timeSince(d) {
  const secs = Math.max(
    1,
    Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  );
  const units = [
    [31536000, "y"],
    [2592000, "mo"],
    [604800, "w"],
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
  ];
  for (const [sec, label] of units)
    if (secs >= sec) return `${Math.floor(secs / sec)}${label} ago`;
  return `${secs}s ago`;
}

/* -------- PDF export -------- */
function exportPDF(row, files) {
  const doc = new jsPDF({ unit: "pt" });
  doc.setFontSize(14);
  doc.text("Salient Defense Group — Violation Report", 40, 40);
  doc.setFontSize(11);
  doc.text(`Case ID: ${row.id}`, 40, 62);

  autoTable(doc, {
    startY: 80,
    head: [["Guard", "Violation", "Occurred", "Shift"]],
    body: [
      [
        row.guards?.full_name || "—",
        row.violation_types?.label || "—",
        new Date(row.occurred_at).toLocaleString(),
        cap(row.shift),
      ],
    ],
    styles: { fontSize: 10 },
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 12,
    head: [["Post", "Lane", "Status", "Docs", "Breach"]],
    body: [
      [
        row.post || "—",
        row.lane ?? "—",
        cap(row.status),
        row.doc_status ? cap(row.doc_status) : "N/A",
        row.breach_days != null
          ? `${row.breach_days} day(s)${
              row.eligible_return_date
                ? ` • return ${row.eligible_return_date}`
                : ""
            }`
          : "—",
      ],
    ],
    styles: { fontSize: 10 },
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 12,
    head: [["Supervisor Note"]],
    body: [[row.supervisor_note || "—"]],
    styles: { fontSize: 10, cellWidth: "wrap" },
  });

  // Include manager note if present
  if (row.manager_note) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 12,
      head: [["Manager Note"]],
      body: [[row.manager_note]],
      styles: { fontSize: 10, cellWidth: "wrap" },
    });
  }

  if (files?.length) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 12,
      head: [["Evidence file", "Uploaded"]],
      body: files.map((f) => [
        f.file_path.split("/").pop(),
        new Date(f.uploaded_at).toLocaleString(),
      ]),
      styles: { fontSize: 10 },
    });
  }

  doc.save(`violation_${row.id}.pdf`);
}
