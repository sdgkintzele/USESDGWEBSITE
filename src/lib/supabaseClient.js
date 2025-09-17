// src/lib/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing Supabase env vars. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in your .env"
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Storage bucket your app uses for evidence uploads
export const EVIDENCE_BUCKET =
  process.env.REACT_APP_PUBLIC_BUCKET_EVIDENCE || "evidence";

// Small helper to keep evidence paths consistent
export const evidenceKey = (violationId, filename) =>
  `violation_${violationId}/${filename}`;

export default supabase;
