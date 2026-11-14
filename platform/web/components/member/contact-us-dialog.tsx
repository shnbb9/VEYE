"use client";

import { useRef, useState, type FormEvent } from "react";
import { useModalDialog } from "@/components/use-modal-dialog";
import { ModalPortal } from "@/components/member/modal-portal";
import { sendMemberRequest, type MemberRequest } from "@/lib/member-api";

/* Contact Us from inside the member application: a short message that lands
   in the console's Requests & Inbox under the member's own name and email.
   The support address the console maintains is shown as the alternative.

   Veye's answers are emailed, and they are also shown here against the
   message they answer — an emailed reply that exists nowhere in the
   application leaves the member with no record of the conversation. */
export function ContactUsDialog({ open, supportEmail, supportPhone, requests, onClose, onSent }: {
  open: boolean; supportEmail: string; supportPhone: string; requests: MemberRequest[] | null;
  onClose: () => void; onSent: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Escape used to be the whole of it, so Tab out of this dialog landed on the
  // dashboard cards behind the scrim. The hook adds the trap, the scroll lock
  // and the return of focus to whatever opened it.
  const card = useRef<HTMLFormElement>(null);
  useModalDialog(open, card, onClose, "#contactSubject");

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

  // What the member wrote in with, plus anything Veye has answered — a Join
  // Beta application is not a message, but its answer must not be hidden.
  const threads = (requests ?? []).filter((r) => r.kind !== "join_beta" || r.replies.length > 0);

  return (
    <ModalPortal id="contactUsModal" open={open} onBackdrop={onClose}>
      {open && (
        <form className="modal-card modal-note contact-card" ref={card} role="dialog" aria-modal="true" aria-labelledby="contactHeading" onSubmit={(event) => void submit(event)} data-testid="contact-dialog">
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
          {threads.length > 0 && (
            <div className="contact-thread" data-testid="contact-history">
              <h4 className="contact-thread__head">Your messages</h4>
              {threads.map((thread) => (
                <div className="cmsg" key={thread.id} data-thread={thread.id}>
                  <div className="cmsg__top">
                    <span className="cmsg__subject">{thread.subject || thread.kind_label}</span>
                    <span className="cmsg__when">{shortDate(thread.created_at)}</span>
                  </div>
                  {thread.replies.length === 0 ? (
                    <p className="cmsg__waiting">
                      {thread.status === "resolved"
                        ? "Veye has closed this one. Nothing was written back here."
                        : "With Veye. The answer comes to the email on your account, and appears here too."}
                    </p>
                  ) : thread.replies.map((reply) => (
                    <div className="cmsg__reply" key={reply.id} data-reply={reply.id}>
                      <span className="cmsg__from">Veye replied &middot; {shortDate(reply.created_at)}</span>
                      <p>{reply.body}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </form>
      )}
    </ModalPortal>
  );
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
