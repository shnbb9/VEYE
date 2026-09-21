"use client";

import { useEffect, useState, type FormEvent } from "react";
import { sendMemberRequest } from "@/lib/member-api";

/* Contact Us from inside the member application: a short message that lands
   in the console's Requests & Inbox under the member's own name and email.
   The support address the console maintains is shown as the alternative. */
export function ContactUsDialog({ open, supportEmail, supportPhone, onClose, onSent }: {
  open: boolean; supportEmail: string; supportPhone: string; onClose: () => void; onSent: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (message.trim().length < 3) { setError("Please write a short message."); return; }
    setBusy(true);
    setError("");
    try {
      await sendMemberRequest({ kind: "contact_us", subject: subject.trim(), message: message.trim(), page: "/app" });
      setSubject("");
      setMessage("");
      onSent();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your message could not be sent.");
    } finally { setBusy(false); }
  }

  return (
    <div className={`modal-overlay${open ? " open" : ""}`} id="contactUsModal" aria-hidden={!open} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      {open && (
        <form className="modal-card modal-note contact-card" role="dialog" aria-modal="true" aria-labelledby="contactHeading" onSubmit={(event) => void submit(event)} data-testid="contact-dialog">
          <button className="modal-close" type="button" aria-label="Close" onClick={onClose}>&times;</button>
          <span className="modal-eyebrow">Contact Us</span>
          <h3 id="contactHeading">Send Veye a message</h3>
          <p className="modal-sub">We reply to the email on your account. You can also write to <a href={`mailto:${supportEmail}`}>{supportEmail}</a>{supportPhone ? ` or call ${supportPhone}` : ""}.</p>
          <label className="contact-label" htmlFor="contactSubject">Subject <small>(optional)</small></label>
          <input className="fdx-input" id="contactSubject" type="text" maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} />
          <label className="contact-label" htmlFor="contactMessage">Your message</label>
          <div className="note-input-wrap">
            <textarea id="contactMessage" rows={4} maxLength={4000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="How can we help?" required />
          </div>
          {error && <p className="chat-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="btn-ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="btn-primary" type="submit" disabled={busy} data-testid="contact-send">{busy ? "Sending…" : "Send message"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
