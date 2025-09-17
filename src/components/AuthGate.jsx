// src/components/AuthGate.jsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  // Always come back to the Log Violation page in this app
  const redirectTo = `${window.location.origin}/hr/violations/new`;

  useEffect(() => {
    let mounted = true;

    // Pick up any existing session (including after redirect)
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session ?? null);
    });

    // React to future auth changes
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      if (mounted) setSession(s ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (session) return children;

  const sendLink = async (e) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo }, // <- force correct return URL
    });

    setLoading(false);
    if (error) alert(error.message);
    else setSent(true);
  };

  return (
    <div
      style={{ maxWidth: 420, margin: "48px auto", fontFamily: "system-ui" }}
    >
      <h2>Sign in to SDG HR</h2>
      {sent ? (
        <p>Check your email for the magic link. Open it on this device.</p>
      ) : (
        <form onSubmit={sendLink}>
          <input
            type="email"
            required
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: "100%", padding: 10, margin: "12px 0" }}
          />
          <button type="submit" disabled={loading}>
            {loading ? "Sending…" : "Send Magic Link"}
          </button>
        </form>
      )}
      <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
        Redirect: <code>{redirectTo}</code>
      </div>
    </div>
  );
}
