import React, { useEffect, useRef, useState } from "react";
import { createAnnouncement } from "../lib/announcements";

/** Convert <input type="datetime-local"> to ISO string (UTC), or null. */
function dtLocalToISO(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const clampPriority = (n) => Math.min(3, Math.max(0, Number(n) || 0));

export default function AnnouncementForm({ onPosted, onCancel }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [author, setAuthor] = useState(() => {
    try {
      return localStorage.getItem("sdg.lastAuthor") || "";
    } catch {
      return "";
    }
  });

  const [important, setImportant] = useState(false);
  const [notifySup, setNotifySup] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [priority, setPriority] = useState(0);

  const [expiresAt, setExpiresAt] = useState("");
  const [requiresAck, setRequiresAck] = useState(false);
  const [ackDeadline, setAckDeadline] = useState("");

  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");

  const titleRef = useRef(null);
  const bodyRef = useRef(null);

  const TITLE_MAX = 80;
  const BODY_MAX = 1500;

  useEffect(() => {
    try {
      localStorage.setItem("sdg.lastAuthor", author || "");
    } catch {}
  }, [author]);

  const autoGrow = (el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 400) + "px";
  };
  useEffect(() => {
    if (bodyRef.current) autoGrow(bodyRef.current);
  }, []);

  const resetForm = () => {
    setTitle("");
    setBody("");
    setImportant(false);
    setNotifySup(false);
    setPinned(false);
    setPriority(0);
    setExpiresAt("");
    setRequiresAck(false);
    setAckDeadline("");
    setError("");
    titleRef.current?.focus();
  };

  async function submit(e) {
    e.preventDefault();
    setError("");

    const t = title.trim();
    const b = body.trim();
    if (!t || !b) {
      setError("Title and message are required.");
      (!t ? titleRef : bodyRef).current?.focus();
      return;
    }
    if (t.length > TITLE_MAX || b.length > BODY_MAX) {
      setError("Please shorten the title or message.");
      return;
    }

    const expiresISO = dtLocalToISO(expiresAt);
    const ackISO = requiresAck ? dtLocalToISO(ackDeadline) : null;

    if (requiresAck && !ackISO) {
      setError(
        "Acknowledgement deadline is required when 'Require acknowledgement' is on."
      );
      return;
    }
    if (ackISO && new Date(ackISO).getTime() < Date.now() - 1000) {
      setError("Acknowledgement deadline can’t be in the past.");
      return;
    }

    const payload = {
      title: t,
      body: b,
      author: author.trim() || null,
      pinned,
      priority: clampPriority(priority),
      important,
      notify_supervisors: notifySup,
      expires_at: expiresISO,
      requires_ack: requiresAck,
      ack_deadline: ackISO,
    };

    setPosting(true);
    try {
      await createAnnouncement(payload);
      onPosted?.();
      resetForm();
    } catch (err) {
      console.error(err);
      setError(err?.message || "Could not post announcement.");
    } finally {
      setPosting(false);
    }
  }

  const onKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(e);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-sdg-slate mb-1">
          Title
        </label>
        <input
          ref={titleRef}
          type="text"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Short, clear headline"
          className="w-full rounded-xl border border-black/10 dark:border-white/10 px-3 py-2 bg-white dark:bg-transparent focus:outline-none focus:ring-2 focus:ring-sdg-dark/25"
        />
        <div className="mt-1 flex justify-end text-[11px] opacity-70">
          {title.length}/{TITLE_MAX}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-sdg-slate mb-1">
          Message
        </label>
        <textarea
          ref={bodyRef}
          value={body}
          maxLength={BODY_MAX}
          onChange={(e) => {
            setBody(e.target.value);
            autoGrow(e.target);
          }}
          onKeyDown={onKeyDown}
          rows={4}
          placeholder="What do supervisors/guards need to know?"
          className="w-full rounded-xl border border-black/10 dark:border-white/10 px-3 py-2 bg-white dark:bg-transparent focus:outline-none focus:ring-2 focus:ring-sdg-dark/25"
        />
        <div className="mt-1 flex justify-end text-[11px] opacity-70">
          {body.length}/{BODY_MAX}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-3">
          <div>
            <label className="block text-xs font-medium text-sdg-slate mb-1">
              Author (optional)
            </label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="e.g., Tyler"
              onKeyDown={onKeyDown}
              className="w-full rounded-xl border border-black/10 dark:border-white/10 px-3 py-2 bg-white dark:bg-transparent focus:outline-none focus:ring-2 focus:ring-sdg-dark/25"
            />
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-sdg-dark/30 dark:border-white/20"
                checked={important}
                onChange={(e) => setImportant(e.target.checked)}
              />
              <span>⚠️ Mark as important</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-sdg-dark/30 dark:border-white/20"
                checked={notifySup}
                onChange={(e) => setNotifySup(e.target.checked)}
              />
              <span>🔔 Notify supervisors</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-sdg-dark/30 dark:border-white/20"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
              <span>📌 Pin</span>
            </label>
          </div>
        </div>

        <div className="grid gap-3 md:place-content-end">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-sdg-slate mb-1">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(clampPriority(e.target.value))}
                className="w-full rounded-xl border border-black/10 dark:border-white/10 px-3 py-2 bg-white dark:bg-transparent focus:outline-none focus:ring-2 focus:ring-sdg-dark/25"
              >
                <option value={0}>Normal</option>
                <option value={1}>High</option>
                <option value={2}>Urgent</option>
                <option value={3}>Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-sdg-slate mb-1">
                Expires (optional)
              </label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full rounded-xl border border-black/10 dark:border-white/10 px-3 py-2 bg-white dark:bg-transparent focus:outline-none focus:ring-2 focus:ring-sdg-dark/25"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="inline-flex items-center gap-2 text-sm col-span-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-sdg-dark/30 dark:border-white/20"
                checked={requiresAck}
                onChange={(e) => setRequiresAck(e.target.checked)}
              />
              <span>Require acknowledgement</span>
            </label>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-sdg-slate mb-1">
                Ack deadline {requiresAck ? "(required)" : "(optional)"}
              </label>
              <input
                type="datetime-local"
                value={ackDeadline}
                onChange={(e) => setAckDeadline(e.target.value)}
                disabled={!requiresAck}
                className="w-full rounded-xl border border-black/10 dark:border-white/10 px-3 py-2 bg-white dark:bg-transparent disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-sdg-dark/25"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-h-[1.25rem]">
          {error ? (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-lg px-2 py-1">
              {error}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {onCancel && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onCancel}
              disabled={posting}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={resetForm}
            disabled={posting || (!title && !body && !author)}
          >
            Clear
          </button>
          <button
            type="submit"
            disabled={posting}
            className="btn btn-primary"
            title="Post (⌘/Ctrl+Enter)"
          >
            {posting ? "Posting…" : "Post"}
          </button>
        </div>
      </div>
    </form>
  );
}
