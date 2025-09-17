// src/pages/UniformLog.jsx
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

/* ---------- Confirm & Toast (same UX as UserDetail) ---------- */
function useConfirm() {
  const [state, setState] = useState(null);
  const confirm = (opts) =>
    new Promise((resolve) => setState({ ...opts, resolve }));
  const onCancel = () => {
    state?.resolve?.(false);
    setState(null);
  };
  const onOk = () => {
    state?.resolve?.(true);
    setState(null);
  };
  const Confirm = () =>
    state
      ? createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
            <div
              role="dialog"
              aria-modal="true"
              className="relative w-[92vw] max-w-md rounded-xl border border-white/10 bg-white text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-slate-100"
            >
              <div
                className="h-1.5 w-full rounded-t-xl"
                style={{ background: "var(--sdg-gold,#d4af37)" }}
              />
              <div className="p-4">
                <h3 className="text-lg font-semibold">
                  {state.title || "Are you sure?"}
                </h3>
                {state.body && (
                  <p className="mt-1 text-sm text-sdg-slate">{state.body}</p>
                )}
                {state.extra && (
                  <div className="mt-3 text-[13px] text-sdg-slate">
                    {state.extra}
                  </div>
                )}
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    className="btn btn-ghost"
                    onClick={onCancel}
                    autoFocus
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={onOk}
                    style={{ background: "rgba(212,175,55,.12)" }}
                  >
                    {state.okLabel || "Confirm"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;
  return { confirm, Confirm };
}
function useToast() {
  const [toasts, setToasts] = useState([]);
  const toast = (msg) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2400);
  };
  const Toasts = () =>
    createPortal(
      <div className="fixed bottom-4 right-4 z-[101] space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="rounded-lg border border-white/10 bg-white/90 px-3 py-2 text-sm shadow-lg backdrop-blur dark:bg-slate-900/90"
          >
            {t.msg}
          </div>
        ))}
      </div>,
      document.body
    );
  return { toast, Toasts };
}

/* ---------- tiny helpers ---------- */
const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"];
const ACTIONS = ["INSERT", "UPDATE", "DELETE", "SNAPSHOT"];
const fmtDate = (v) => (!v ? "—" : new Date(v).toLocaleDateString());
const yesNo = (b) => (b ? "Yes" : "No");
function Badge({ tone = "slate", children }) {
  const theme =
    tone === "green"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200 border-green-200/70 dark:border-green-700/40"
      : tone === "red"
      ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-100 border-rose-200/70 dark:border-rose-700/40"
      : "bg-black/5 text-black/80 dark:bg-white/10 dark:text-white/80 border-black/10 dark:border-white/10";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] ${theme}`}
    >
      {children}
    </span>
  );
}

/* ===================================================================== */

export default function UniformLog() {
  const [me, setMe] = useState(null);
  const isManager = String(me?.role || "").toLowerCase() === "manager";

  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [issued, setIssued] = useState([]);

  // filters
  const [q, setQ] = useState("");
  const [size, setSize] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { confirm, Confirm } = useConfirm();
  const { toast, Toasts } = useToast();

  /* --- FORCE THE GLOBAL HEADER TO FULL WIDTH ON THIS PAGE --- */
  useEffect(() => {
    const headerEl =
      document.querySelector("header") ||
      document.querySelector("[data-app-header]"); // fallback if you marked it
    if (headerEl) headerEl.classList.add("sdg-header-bleed");
    return () => {
      if (headerEl) headerEl.classList.remove("sdg-header-bleed");
    };
  }, []);

  /* who am I? */
  useEffect(() => {
    (async () => {
      const { data: userResp } = await supabase.auth.getUser();
      const user = userResp?.user;
      if (!user) return;
      const { data: prof } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      setMe({ role: prof?.role ?? null });
    })();
  }, []);

  /* load */
  useEffect(() => {
    (async () => {
      setLoading(true);

      const { data: rows, error: logErr } = await supabase
        .from("uniform_logs")
        .select(
          `
          id, changed_at, action, shirt_size, shirt_qty, shirt_issued_at,
          hi_vis, agreement_signed, notes, guard_id,
          guard:guard_id ( full_name )
        `
        )
        .order("changed_at", { ascending: false });

      if (logErr) {
        console.warn("uniform_logs error", logErr.message);
        setLogs([]);
      } else {
        setLogs(
          (rows || []).map((r) => ({
            id: r.id,
            when: r.changed_at,
            action: r.action,
            size: r.shirt_size,
            qty: r.shirt_qty,
            issued_at: r.shirt_issued_at,
            hi_vis: r.hi_vis,
            agreement: r.agreement_signed,
            notes: r.notes,
            guard_id: r.guard_id,
            guard_name: r.guard?.full_name || null,
          }))
        );
      }

      const { data: urows, error: uerr } = await supabase
        .from("uniforms")
        .select("guard_id, shirt_size, shirt_qty");
      if (!uerr) setIssued(urows || []);

      setLoading(false);
    })();
  }, []);

  /* derived */
  const issuedBySize = useMemo(() => {
    const acc = Object.fromEntries(SIZES.map((s) => [s, 0]));
    (issued || []).forEach((r) => {
      const s = r.shirt_size || "";
      const n = Number(r.shirt_qty || 0);
      if (s && s in acc) acc[s] += n;
    });
    return acc;
  }, [issued]);

  const totalIssued = useMemo(
    () => Object.values(issuedBySize).reduce((a, b) => a + b, 0),
    [issuedBySize]
  );

  const guardsWithShirts = useMemo(() => {
    const set = new Set();
    (issued || []).forEach((r) => {
      if ((r.shirt_qty || 0) > 0 && r.guard_id) set.add(r.guard_id);
    });
    return set.size;
  }, [issued]);

  /* filtering */
  const filtered = useMemo(() => {
    const fFrom = from ? new Date(from + "T00:00:00") : null;
    const fTo = to ? new Date(to + "T23:59:59") : null;

    return (logs || []).filter((r) => {
      if (size && r.size !== size) return false;
      if (action && r.action !== action) return false;
      if (fFrom && new Date(r.when) < fFrom) return false;
      if (fTo && new Date(r.when) > fTo) return false;
      if (q) {
        const blob = `${r.guard_name || ""} ${r.notes || ""}`.toLowerCase();
        if (!blob.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [logs, size, action, from, to, q]);

  const resetFilters = () => {
    setQ("");
    setSize("");
    setAction("");
    setFrom("");
    setTo("");
    toast("Filters reset.");
  };

  /* actions */
  const removeLog = async (id) => {
    if (!isManager) return alert("Managers only.");
    const ok = await confirm({
      title: "Delete uniform log entry?",
      body: "This action cannot be undone.",
      okLabel: "Delete",
    });
    if (!ok) return;

    const { error } = await supabase.from("uniform_logs").delete().eq("id", id);
    if (error) return alert(error.message);
    setLogs((prev) => prev.filter((x) => x.id !== id));
    toast("Log entry deleted.");
  };

  const exportCsv = () => {
    const rows = filtered.map((r) => ({
      When: new Date(r.when).toLocaleString(),
      Guard: r.guard_name || "—",
      Action: r.action,
      Size: r.size || "—",
      Qty: r.qty ?? 0,
      "Issued (date)": fmtDate(r.issued_at),
      "Hi-vis": yesNo(r.hi_vis),
      "Agreement Signed": yesNo(r.agreement),
      Notes: r.notes || "",
    }));
    const headers = Object.keys(
      rows[0] || {
        When: "",
        Guard: "",
        Action: "",
        Size: "",
        Qty: "",
        "Issued (date)": "",
        "Hi-vis": "",
        "Agreement Signed": "",
        Notes: "",
      }
    );
    const csv =
      headers.join(",") +
      "\n" +
      rows
        .map((r) =>
          headers
            .map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`)
            .join(",")
        )
        .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `uniform-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("CSV exported.");
  };

  return (
    <div className="py-8">
      <style>{`
        /* -------- Full-bleed header just for this page -------- */
        header.sdg-header-bleed {
          position: relative;
          left: 50%;
          right: 50%;
          margin-left: -50vw;
          margin-right: -50vw;
          width: 100vw;
          border-radius: 0;              /* flush with edges */
          padding-left: max(env(safe-area-inset-left), 24px);
          padding-right: max(env(safe-area-inset-right), 24px);
        }
        /* kill typical container clamps inside header */
        header.sdg-header-bleed .container,
        header.sdg-header-bleed .mx-auto,
        header.sdg-header-bleed [class*="max-w-"],
        header.sdg-header-bleed [class*="max\\:w-"],
        header.sdg-header-bleed [class*="max-w\\["] {
          max-width: none !important;
          width: 100% !important;
        }

        .page { max-width: 100%; }
        .card { border: 1px solid rgba(255,255,255,.08); border-radius: 14px; background: transparent; }
        .card-accent { height: 6px; background: var(--sdg-gold, #d4af37); border-top-left-radius: 14px; border-top-right-radius: 14px; }
        .cell { padding: 10px 12px; vertical-align: middle; }
        .muted { color: var(--sdg-slate, #9aa4b2); }
        table { width: 100%; border-collapse: separate; border-spacing: 0; }
        thead th { position: sticky; top: 0; z-index: 5; background: rgba(255,255,255,.02); backdrop-filter: blur(2px); }
        tbody tr:nth-child(odd) { background: rgba(255,255,255,.02); }
        tbody tr:hover { background: rgba(212,175,55,.10); }
        .chip { display:inline-flex; align-items:center; gap:.5rem; height:32px; padding:0 .75rem; border-radius:999px; border:1px solid rgba(255,255,255,.12); background:transparent; cursor:pointer; font-size:12px; font-weight:600; }
        .chip[aria-pressed="true"] { background: rgba(212,175,55,.16); border-color: rgba(212,175,55,.45); }
        .toolbar { gap:.75rem; }
        .toolbar .field { min-width: 220px; }
        .kpi { display:grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap:12px; }
        .kpi .tile { grid-column: span 3 / span 3; padding:14px; border-radius:12px; border:1px solid rgba(255,255,255,.10); }
        .kpi .tile h4 { font-size:12px; letter-spacing:.04em; text-transform:uppercase; color:var(--sdg-slate, #9aa4b2); }
        .kpi .tile .v { font-size:28px; font-weight:700; line-height:1; margin-top:6px; }
        .size-row { display:grid; grid-template-columns: 80px repeat(8, minmax(0,1fr)) 100px; gap:0; }
        .size-row > div, .size-row > span { padding:10px 12px; border-bottom:1px solid rgba(255,255,255,.08); }
        .right { text-align:right; }
      `}</style>

      {/* Main page content */}
      <div className="mx-auto page px-4 md:px-6">
        {/* KPI strip */}
        <div className="kpi mb-6">
          <div className="tile">
            <h4>Total issued</h4>
            <div className="v">{totalIssued}</div>
            <div className="text-xs muted mt-1">All sizes combined</div>
          </div>
          <div className="tile">
            <h4>Guards with shirts</h4>
            <div className="v">{guardsWithShirts}</div>
            <div className="text-xs muted mt-1">Currently assigned</div>
          </div>
          <div className="tile">
            <h4>Log entries</h4>
            <div className="v">{logs.length}</div>
            <div className="text-xs muted mt-1">Lifetime audit rows</div>
          </div>
          <div className="tile">
            <h4>Filtered</h4>
            <div className="v">{filtered.length}</div>
            <div className="text-xs muted mt-1">After active filters</div>
          </div>
        </div>

        {/* Issued by size */}
        <section className="card overflow-hidden mb-6">
          <div className="card-accent" />
          <div className="p-4">
            <h2 className="font-medium mb-3">Currently Issued (by size)</h2>
            {loading ? (
              <div className="muted">Loading…</div>
            ) : (
              <div className="size-row">
                <div className="font-medium">Size</div>
                {SIZES.map((s) => (
                  <div key={`head_${s}`} className="right font-medium">
                    {s}
                  </div>
                ))}
                <div className="right font-medium">Total</div>

                <span className="font-medium">Issued</span>
                {SIZES.map((s) => (
                  <span key={`val_${s}`} className="right">
                    {issuedBySize[s] ?? 0}
                  </span>
                ))}
                <span className="right font-semibold">{totalIssued}</span>
              </div>
            )}
            <div className="text-xs muted mt-2">
              Source: <code>public.uniforms</code> — live totals of shirts
              currently assigned to guards.
            </div>
          </div>
        </section>

        {/* Toolbar */}
        <section className="card overflow-hidden mb-4">
          <div className="p-4 flex flex-wrap toolbar">
            <div className="field grow min-w-[250px]">
              <label className="block text-sm muted mb-1">
                Search (name / notes)
              </label>
              <input
                className="w-full rounded-md px-3 py-2"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Type to filter…"
              />
            </div>

            <div className="field">
              <label className="block text-sm muted mb-1">Size</label>
              <div className="flex flex-wrap gap-2">
                <button
                  className="chip"
                  aria-pressed={size === ""}
                  onClick={() => setSize("")}
                >
                  All
                </button>
                {SIZES.map((s) => (
                  <button
                    key={s}
                    className="chip"
                    aria-pressed={size === s}
                    onClick={() => setSize(size === s ? "" : s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label className="block text-sm muted mb-1">Action</label>
              <div className="flex flex-wrap gap-2">
                <button
                  className="chip"
                  aria-pressed={action === ""}
                  onClick={() => setAction("")}
                >
                  All
                </button>
                {ACTIONS.map((a) => (
                  <button
                    key={a}
                    className="chip"
                    aria-pressed={action === a}
                    onClick={() => setAction(action === a ? "" : a)}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label className="block text-sm muted mb-1">From</label>
              <input
                type="date"
                className="w-full rounded-md px-3 py-2"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="block text-sm muted mb-1">To</label>
              <input
                type="date"
                className="w-full rounded-md px-3 py-2"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Log table */}
        <section className="card overflow-hidden">
          <div className="card-accent" />
          <div className="p-0">
            <table className="text-sm">
              <thead>
                <tr>
                  <th className="cell text-left">When</th>
                  <th className="cell text-left">Guard</th>
                  <th className="cell text-left">Action</th>
                  <th className="cell text-left">Size</th>
                  <th className="cell text-right">Qty</th>
                  <th className="cell text-left">Issued (date)</th>
                  <th className="cell text-left">Hi-vis</th>
                  <th className="cell text-left">Agreement</th>
                  <th className="cell text-left">Notes</th>
                  {isManager && <th className="cell text-center">—</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {loading ? (
                  <tr>
                    <td className="cell muted" colSpan={isManager ? 10 : 9}>
                      Loading…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td className="cell muted" colSpan={isManager ? 10 : 9}>
                      No log entries match your filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.id}>
                      <td className="cell whitespace-nowrap">
                        {new Date(r.when).toLocaleString()}
                      </td>
                      <td className="cell">
                        {r.guard_id ? (
                          <Link
                            to={`/hr/users/${r.guard_id}`}
                            className="underline underline-offset-2"
                          >
                            {r.guard_name || r.guard_id}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="cell">
                        <Badge tone={r.action === "DELETE" ? "red" : "slate"}>
                          {r.action}
                        </Badge>
                      </td>
                      <td className="cell">{r.size || "—"}</td>
                      <td className="cell text-right">{r.qty ?? 0}</td>
                      <td className="cell">{fmtDate(r.issued_at)}</td>
                      <td className="cell">{yesNo(r.hi_vis)}</td>
                      <td className="cell">{yesNo(r.agreement)}</td>
                      <td className="cell">{r.notes || "—"}</td>
                      {isManager && (
                        <td className="cell text-center">
                          <button
                            className="text-rose-500 hover:underline"
                            onClick={() => removeLog(r.id)}
                            title="Delete log entry"
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="text-xs muted px-4 py-3">
            Source: <code>public.uniform_logs</code>. Delete is restricted to
            managers by RLS.
          </div>
        </section>
      </div>

      {/* UI portals */}
      <Confirm />
      <Toasts />
    </div>
  );
}
