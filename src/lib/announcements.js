// src/lib/announcements.js
import { supabase } from "./supabaseClient";

/** -------------------- Announcements (existing) -------------------- **/

/** Ordered, active announcements (from the view) */
export async function fetchAnnouncementsActive() {
  const { data, error } = await supabase
    .from("announcements_active")
    .select("*");
  if (error) throw error;
  return data;
}

/** Realtime subscription; returns an unsubscribe fn */
export function subscribeAnnouncements(onChange) {
  const ch = supabase
    .channel("rt-announcements")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "announcements" },
      onChange
    )
    .subscribe();
  return () => supabase.removeChannel(ch);
}

/** Create */
export async function createAnnouncement(payload) {
  // Payload can include: requires_ack (bool), ack_deadline (ISO), etc.
  const { data, error } = await supabase
    .from("announcements")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Soft delete (sets deleted_at) */
export async function softDeleteAnnouncement(id) {
  const { error } = await supabase
    .from("announcements")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Pin/unpin */
export async function pinAnnouncement(id, pinned = true) {
  const { error } = await supabase
    .from("announcements")
    .update({ pinned })
    .eq("id", id);
  if (error) throw error;
}

/** -------------------- NEW: Acknowledgement helpers -------------------- **/

/**
 * Return list of supervisors (and managers) who should acknowledge.
 * Adjust the roles array if your site uses different role names.
 */
export async function fetchSupervisors() {
  const roles = ["supervisor", "manager"];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .in("role", roles)
    .order("full_name", { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Fetch all acks for one announcement (optionally include names if FK is set). */
export async function fetchAcks(announcementId) {
  const { data, error } = await supabase
    .from("announcements_acks")
    .select("announcement_id, user_id, acknowledged_at")
    .eq("announcement_id", announcementId)
    .order("acknowledged_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Map of { announcementId: true } for the current user,
 * limited to the provided announcement ids.
 */
export async function fetchMyAckMap(announcementIds = []) {
  const ids = Array.from(new Set(announcementIds)).filter(Boolean);
  if (ids.length === 0) return {};
  const { data: userResp } = await supabase.auth.getUser();
  const uid = userResp?.user?.id;
  if (!uid) return {};

  const { data, error } = await supabase
    .from("announcements_acks")
    .select("announcement_id")
    .eq("user_id", uid)
    .in("announcement_id", ids);
  if (error) throw error;

  const map = {};
  (data || []).forEach((r) => {
    map[r.announcement_id] = true;
  });
  return map;
}

/**
 * Return an object { [announcementId]: ack_count }.
 * Uses the `announcements_ack_summary` view if you created it; falls
 * back to counting directly from announcements_acks if the view is missing.
 */
export async function fetchAckCounts(announcementIds = []) {
  const ids = Array.from(new Set(announcementIds)).filter(Boolean);
  if (ids.length === 0) return {};

  // Try the view first
  let map = {};
  try {
    const { data, error } = await supabase
      .from("announcements_ack_summary")
      .select("announcement_id, ack_count")
      .in("announcement_id", ids);
    if (error) throw error;
    (data || []).forEach((r) => {
      map[r.announcement_id] = Number(r.ack_count) || 0;
    });
    return map;
  } catch {
    // Fallback: count acks directly
    const { data, error } = await supabase
      .from("announcements_acks")
      .select("announcement_id")
      .in("announcement_id", ids);
    if (error) throw error;
    (data || []).forEach((r) => {
      map[r.announcement_id] = (map[r.announcement_id] || 0) + 1;
    });
    return map;
  }
}

/**
 * Insert an acknowledgement for the current user.
 * RLS should enforce auth.uid() = user_id (see your policy).
 * Ignores duplicate key errors (already acknowledged).
 */
export async function acknowledgeAnnouncement(announcementId) {
  const { data: userResp } = await supabase.auth.getUser();
  const uid = userResp?.user?.id;
  if (!uid) throw new Error("Not signed in.");

  const { error } = await supabase
    .from("announcements_acks")
    .insert({ announcement_id: announcementId, user_id: uid });
  if (error) {
    // Ignore unique-violation (already acknowledged)
    if (error.code === "23505") return;
    throw error;
  }
}
