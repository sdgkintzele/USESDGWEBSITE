// src/lib/rollcall.js
import { supabase } from "./supabaseClient";

/* ------------------------------ Auth/Profile ------------------------------ */

export async function getMyProfile() {
  const { data: userResp, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const uid = userResp?.user?.id;
  if (!uid) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, email")
    .eq("id", uid)
    .single();

  if (error) throw error;
  return data || null;
}

/* ----------------------------- Roster Helpers ----------------------------- */

export async function fetchGuardNames() {
  const { data, error } = await supabase
    .from("guards")
    .select("full_name")
    .order("full_name", { ascending: true });

  if (error) throw error;
  return (data || []).map((r) => r.full_name);
}

/* ------------------------------ Date helpers ------------------------------ */

// Normalize UI shift labels to DB text check ('day'|'night')
function normalizeShift(s) {
  const t = (s || "").toLowerCase();
  if (t.includes("night")) return "night";
  return "day";
}

// NOTE: The value coming from <input type="datetime-local"> is an EST wall-time
// string we constructed (YYYY-MM-DDTHH:mm) using America/New_York.
// We do NOT need to do any timezone math for rollcalls.roll_date.
// Just return the YYYY-MM-DD part so the DB stores the correct EST date.
function toESTDateString(whenISO) {
  if (!whenISO || typeof whenISO !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}$/.exec(whenISO.trim());
  return m ? m[1] : null;
}

/* --------------------------- Roll-call persistence ------------------------- */

/**
 * Create a rollcall header row.
 * @param {{ whenISO: string, shift: string, supervisor_id: string, supervisor_name?: string, notes?: string }} args
 */
export async function createRollcall({
  whenISO,
  shift,
  supervisor_id,
  supervisor_name,
  notes,
}) {
  const roll_date = toESTDateString(whenISO);
  const shift_norm = normalizeShift(shift);

  const { data, error } = await supabase
    .from("rollcalls")
    .insert([
      {
        roll_date, // DATE (EST day)
        shift: shift_norm, // 'day' | 'night'
        supervisor_id, // uuid
        supervisor_name: supervisor_name || null,
        notes: notes || null,
      },
    ])
    .select("*")
    .single();

  if (error) throw error;
  return data; // { id, ... }
}

/**
 * Bulk insert rollcall assignments.
 * Row shape:
 * {
 *   rollcall_id,
 *   slot_no,                     // 1 = primary, 2 = replacement, 3+ extras
 *   section,                     // 'Supervision' | 'Interior' | 'Truck Gate' | 'Other'
 *   post_key,                    // 'cctv', 'lane_1', ...
 *   post_label,                  // friendly label
 *   guard_name,                  // string|null
 *   training,                    // boolean
 *   trainer_guard_name,          // string|null
 *   status,                      // 'assigned' | 'callout' | 'no_call_no_show' | 'vacant'
 *   notes                        // optional
 * }
 */
export async function insertAssignments(rows) {
  if (!rows?.length) return;
  const { error } = await supabase.from("rollcall_assignments").insert(rows);
  if (error) throw error;
}

/* -------------------------- Status mapping helper ------------------------- */

export function statusFromFlags({ flagVacant, flagNcns, flagCallout }) {
  if (flagVacant) return "vacant";
  if (flagNcns) return "no_call_no_show";
  if (flagCallout) return "callout";
  return "assigned";
}

/* ------------------------------ Email function ---------------------------- */

/**
 * Send rollcall email via Edge Function.
 * Accepts either:
 *  - sendRollcallEmail({ subject, html, to? })
 *  - sendRollcallEmail(rollcallId) // legacy support
 */
export async function sendRollcallEmail(arg) {
  try {
    const body = typeof arg === "string" ? { rollcallId: arg } : { ...arg };
    const { error } = await supabase.functions.invoke("rollcall-email", {
      body,
    });
    if (error) throw error;
  } catch (e) {
    // Don't block saving on email issues
    console.warn("rollcall-email invoke:", e?.message || e);
  }
}
