import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function EvidenceBlock({ violationId }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    const { data, error } = await supabase
      .from("violation_files")
      .select("id, file_path, uploaded_at, uploaded_by")
      .eq("violation_id", violationId)
      .order("uploaded_at", { ascending: false });

    if (error) setError(error.message);
    setItems(data ?? []);
  }

  useEffect(() => {
    if (violationId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [violationId]);

  function onPick(e) {
    setSelected([...e.target.files]);
  }

  async function upload() {
    if (!selected.length) return;
    setBusy(true);
    setError("");

    // who’s uploading
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess?.session?.user?.id;

    try {
      for (const file of selected) {
        if (file.size > 10 * 1024 * 1024) {
          throw new Error(`${file.name} is over 10MB`);
        }
        const path = `violation_${violationId}/${Date.now()}_${file.name}`;

        const up = await supabase.storage
          .from("evidence")
          .upload(path, file, { cacheControl: "3600", upsert: false });

        if (up.error) throw up.error;

        const ins = await supabase.from("violation_files").insert({
          violation_id: violationId,
          file_path: path,
          uploaded_by: uid,
        });

        if (ins.error) throw ins.error;
      }

      setSelected([]);
      await load();
      alert("Evidence uploaded.");
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(row) {
    if (!confirm("Delete this evidence file?")) return;
    setBusy(true);
    setError("");
    try {
      // Remove from storage first
      const rm = await supabase.storage
        .from("evidence")
        .remove([row.file_path]);
      if (rm.error) throw rm.error;

      // Then remove DB row
      const del = await supabase
        .from("violation_files")
        .delete()
        .eq("id", row.id);
      if (del.error) throw del.error;

      await load();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  function publicUrl(path) {
    // If your bucket is public you can expose URLs; otherwise keep “Open” link as a signed-url flow.
    const { data } = supabase.storage.from("evidence").getPublicUrl(path);
    return data?.publicUrl || "#";
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          type="file"
          multiple
          accept=".pdf,image/*"
          onChange={onPick}
          disabled={busy}
          className="block"
        />
        <button
          type="button"
          onClick={upload}
          disabled={busy || selected.length === 0}
          className="rounded-xl border px-3 py-2 text-sm bg-black text-white dark:bg-white dark:text-black disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>

      {selected.length > 0 && (
        <div className="text-sm text-sdg-slate">
          {selected.length} file(s) selected
        </div>
      )}

      {error && <div className="text-red-600 text-sm">{error}</div>}

      <ul className="divide-y divide-sdg-dark/10 dark:divide-white/10">
        {items.map((row) => (
          <li key={row.id} className="py-2 flex items-center justify-between">
            <div className="min-w-0">
              <div className="font-mono text-sm truncate">
                {row.file_path.split("/").pop()}
              </div>
              <div className="text-xs text-sdg-slate">
                Uploaded {new Date(row.uploaded_at).toLocaleString()}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <a
                href={publicUrl(row.file_path)}
                target="_blank"
                rel="noreferrer"
                className="underline text-sm"
              >
                Open
              </a>
              <button
                type="button"
                onClick={() => remove(row)}
                disabled={busy}
                className="text-sm text-red-600 hover:underline"
                title="Managers only (per RLS)"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
        {items.length === 0 && (
          <li className="py-2 text-sm text-sdg-slate">No evidence yet.</li>
        )}
      </ul>

      <p className="text-xs text-sdg-slate">
        Tip: uploading files does not automatically change “Docs” status—use
        <em> Mark Docs Provided</em> / <em>Mark Not Provided</em> to set that.
      </p>
    </div>
  );
}
