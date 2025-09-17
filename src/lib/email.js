import { supabase } from "../lib/supabaseClient";

export async function sendRollcallEmail({ subject, html, to }) {
  const { data, error } = await supabase.functions.invoke("rollcall-email", {
    body: { subject, html, ...(to ? { to } : {}) },
  });
  if (error) throw error;
  return data;
}
