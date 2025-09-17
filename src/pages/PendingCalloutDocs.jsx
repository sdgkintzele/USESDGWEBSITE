// src/pages/PendingCalloutDocs.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { downloadCSV } from "../lib/csv";

/* --- Match Violations page: robust type normalizer --- */
function typeKeyFromSlugOrLabel(slug = "", label = "") {
  const s = (slug || label).toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (s.includes("nocallnoshow") || s === "ncns") return "ncns";
  if (s.includes("callout")) return "callout";
  if (
    s.includes("earlydeparture") ||
    s.includes("earlyout") ||
    s.includes("leftpostearly") ||
    s.includes("leftsiteearly")
  )
    return "early_departure";
  return slug || label || "";
}

export default function PendingDocs() {
  const nav = useNavigate();

  // Full-bleed header like Roll-call
  useEffect(() => {
    const headerEl =
      document.querySelector("header") ||
      document.querySelector("[data-app-header]");
    if (headerEl) headerEl.classList.add("sdg-header-bleed");
    return () => headerEl && headerEl.classList.remove("sdg-header-bleed");
  }, []);

  /* ---------------- Data ---------------- */
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "documentation_due_at", dir: "asc" });
  const [typeFilter, setTypeFilter] = useState("all"); // all | callout | early_departure

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("violations")
        .select(
          `
          id, occurred_at, documentation_due_at, doc_status,
          guards:guards(full_name),
          violation_types:violation_types(label, slug)
        `
        )
        .in("doc_status", ["pending"])
        .order("documentation_due_at", { ascending: true });

      if (!error) setRows(data ?? []);
      setLoading(false);
    })();
  }, []);

  /* ---------------- Derived ---------------- */
  const filtered = useMemo(() => {
    let out = rows
      .filter((r) => {
        const key = typeKeyFromSlugOrLabel(
          r.violation_types?.slug || "",
          r.violation_types?.label || ""
        );
        return key === "callout" || key === "early_departure";
      })
      .filter((r) => r.doc_status === "pending")
      .map((r) => {
        const key = typeKeyFromSlugOrLabel(
          r.violation_types?.slug || "",
          r.violation_types?.label || ""
        );
        return {
          id: r.id,
          guard: r.guards?.full_name ?? "—",
          type: r.violation_types?.label ?? "—",
          slug: key, // normalized key
          occurred_at: r.occurred_at,
          due_at: r.documentation_due_at,
          documentation_due_at: r.documentation_due_at, // keep for sorter
          raw: r,
        };
      });

    if (typeFilter !== "all") out = out.filter((r) => r.slug === typeFilter);

    if (q.trim()) {
      const t = q.trim().toLowerCase();
      out = out.filter((r) => `${r.guard} ${r.type}`.toLowerCase().includes(t));
    }

    out.sort((a, b) => {
      const av =
        sort.key === "documentation_due_at"
          ? new Date(a.documentation_due_at || 0).getTime()
          : new Date(a.occurred_at || 0).getTime();
      const bv =
        sort.key === "documentation_due_at"
          ? new Date(b.documentation_due_at || 0).getTime()
          : new Date(b.occurred_at || 0).getTime();
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === "asc" ? cmp : -cmp;
    });

    return out;
  }, [rows, q, sort, typeFilter]);

  /* ---------------- Actions ---------------- */
  // IMPORTANT: No emails are sent from this page. We only update doc_status.
  const mark = async (id, doc_status) => {
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, doc_status } : r)));

    const { error } = await supabase
      .from("violations")
      .update({ doc_status })
      .eq("id", id);

    if (error) {
      setRows(prev);
      console.warn("Update failed:", error);
    }
  };

  const exportCSV = () =>
    downloadCSV(
      `pending_docs_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`,
      filtered.map((r) => ({
        guard: r.guard,
        type: r.type,
        occurred_at: new Date(r.occurred_at).toLocaleString(),
        due_at: r.due_at ? new Date(r.due_at).toLocaleString() : "",
      }))
    );

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
        .surface {
          border-radius: 1rem; border: 1px solid rgba(0,0,0,.08); background: rgba(255,255,255,.7);
        }
        .dark .surface {
          border-color: rgba(255,255,255,.12); background: rgba(255,255,255,.06);
        }
        .accent { height: 3px; background: linear-gradient(90deg,#E4B851,#F59E0B 50%,#E4B851); border-radius: 9999px; opacity: .8; }
        .dark .accent { opacity: .55; }
        input[type="text"] { background-color: #fff; color: #0f172a; }
        .dark input[type="text"] { background-color: #151a1e !important; color:#e5e7eb !important; border-color: rgba(255,255,255,.12) !important; }
        ::placeholder { color:#64748b; }
        .dark ::placeholder { color:#9aa4b2 !important; }
        table th, table td { text-align: center; }
        thead tr { background: rgba(0,0,0,.03); }
        .dark thead tr { background: rgba(255,255,255,.06); }
      `}</style>

      <div className="page-full px-4 md:px-6 bg-gradient-to-b from-[#fafbfc] via-[#f7f6f3] to-[#f6f5f2] dark:from-[#2a3040] dark:via-[#262c38] dark:to-[#232835]">
        {/* Header / controls row */}
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0">
            <h1 className="font-heading text-2xl md:text-3xl">
              Pending Documentation
            </h1>
            <p className="text-sdg-slate dark:text-white/70">
              Callout and Early Departure incidents awaiting required
              documentation.
            </p>
            <p className="text-[12px] mt-1 text-slate-500 dark:text-white/60">
              <strong>Note:</strong> Updating statuses here does not send any
              emails. Use the <em>Violations</em> page to send documentation
              requests or breach notices.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 text-sm"
              title="Filter by type"
            >
              <option value="all">All types</option>
              <option value="callout">Callout</option>
              <option value="early_departure">Early Departure</option>
            </select>

            <button
              onClick={exportCSV}
              className="rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
            >
              Export CSV
            </button>
          </div>
        </div>

        <div className="accent mb-6" />

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-sdg-slate">
            {loading ? "Loading…" : `${filtered.length} pending`}
          </span>
          <div className="ml-auto w-full sm:w-auto">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search guard / type…"
              aria-label="Search pending docs"
              className="w-full sm:w-96 rounded-xl border border-black/10 dark:border-white/10 px-3 py-2"
              type="text"
            />
          </div>
        </div>

        {/* Table */}
        <div className="surface overflow-hidden w-full">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <SortableTh
                    active={sort.key === "documentation_due_at"}
                    dir={sort.dir}
                    onClick={() =>
                      toggleSort(setSort, sort, "documentation_due_at")
                    }
                  >
                    Docs Due
                  </SortableTh>
                  <Th>Guard</Th>
                  <Th>Type</Th>
                  <SortableTh
                    active={sort.key === "occurred_at"}
                    dir={sort.dir}
                    onClick={() => toggleSort(setSort, sort, "occurred_at")}
                  >
                    Occurred
                  </SortableTh>
                  <Th>Actions</Th>
                </tr>
              </thead>

              <tbody className="divide-y divide-black/5 dark:divide-white/10">
                {loading ? (
                  <tr>
                    <Td colSpan={5} className="py-6 text-sdg-slate">
                      Loading…
                    </Td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <Td colSpan={5} className="py-8 text-sdg-slate">
                      Nothing pending right now.
                    </Td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr
                      key={r.id}
                      className="odd:bg-white/40 dark:odd:bg-white/[0.03]"
                    >
                      <Td>
                        <DuePill dt={r.due_at} />
                      </Td>
                      <Td className="font-medium">{r.guard}</Td>
                      <Td>{r.type}</Td>
                      <Td>{new Date(r.occurred_at).toLocaleString()}</Td>
                      <Td>
                        <div className="inline-flex gap-2">
                          <ChipBtn
                            tone="green"
                            onClick={() => mark(r.id, "provided")}
                          >
                            Mark Provided
                          </ChipBtn>
                          <ChipBtn
                            tone="red"
                            onClick={() => mark(r.id, "not_provided")}
                          >
                            Not Provided
                          </ChipBtn>
                          <ChipBtn
                            onClick={() => nav(`/hr/violations/${r.id}`)}
                          >
                            Open
                          </ChipBtn>
                        </div>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Small UI helpers ---------------- */

function Th({ children, className = "", ...props }) {
  return (
    <th
      {...props}
      className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-sdg-slate ${className}`}
    >
      {children}
    </th>
  );
}

function SortableTh({ children, active, dir, onClick, className = "" }) {
  return (
    <Th
      onClick={onClick}
      className={`cursor-pointer select-none ${className}`}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="inline-flex items-center gap-1 justify-center">
        {children}
        {active ? (
          <span>{dir === "asc" ? "▲" : "▼"}</span>
        ) : (
          <span className="opacity-40">↕</span>
        )}
      </span>
    </Th>
  );
}

function Td({ children, className = "", ...props }) {
  return (
    <td {...props} className={`px-4 py-3 align-middle ${className}`}>
      {children}
    </td>
  );
}

function ChipBtn({ tone = "neutral", className = "", children, ...props }) {
  const toneCls =
    tone === "green"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-200 dark:border-emerald-800/40"
      : tone === "red"
      ? "bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100 dark:bg-rose-900/25 dark:text-rose-200 dark:border-rose-800/40"
      : "bg-black/5 text-black/80 border-black/10 hover:bg-black/10 dark:bg-white/10 dark:text-white/80 dark:border-white/10";
  return (
    <button
      className={`rounded-full px-3 py-1.5 text-[12px] font-medium border transition ${toneCls} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function toggleSort(setSort, sort, key) {
  setSort((s) =>
    s.key === key
      ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
      : { key, dir: "asc" }
  );
}

function DuePill({ dt }) {
  const { label, cls } = dueBadge(dt);
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] ${cls}`}
    >
      {label}
    </span>
  );
}

function dueBadge(dt) {
  if (!dt)
    return {
      label: "—",
      cls: "bg-slate-100 text-slate-900 dark:bg-slate-800/50 dark:text-slate-200 border border-black/10 dark:border-white/10",
    };
  const ms = new Date(dt).getTime() - Date.now();
  const past = ms < 0;
  const d = Math.floor(Math.abs(ms) / 86400000);
  const h = Math.floor((Math.abs(ms) % 86400000) / 3600000);

  if (past) {
    return {
      label: "Overdue",
      cls: "bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-900/25 dark:text-rose-200 dark:border-rose-800/40",
    };
  }

  const label =
    d > 0
      ? `Due in ${d} ${d === 1 ? "Day" : "Days"}`
      : `Due in ${h || 1} ${h === 1 ? "Hour" : "Hours"}`;

  return {
    label,
    cls: "bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-900/25 dark:text-amber-100 dark:border-amber-800/40",
  };
}
