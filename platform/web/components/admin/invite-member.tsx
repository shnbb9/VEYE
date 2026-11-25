"use client";

import { useState, type FormEvent } from "react";
import { Drawer } from "@/components/admin/drawer";
import { inviteMember, type MemberInvitation } from "@/lib/admin-console-api";

/* Add a member (Cara, 15 Nov): an address and, if known, a name. It sends an
   invitation — it never creates an account, chooses a password or decides
   anything about health sharing. */
export function InviteMember({ onClose, onSent }: { onClose: () => void; onSent: (invitation: MemberInvitation) => void }) {
  const [form, setForm] = useState({ email: "", first_name: "", last_name: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      onSent(await inviteMember({ email: form.email.trim(), first_name: form.first_name.trim(), last_name: form.last_name.trim() }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The invitation could not be sent.");
      setBusy(false);
    }
  }

  return (
    <Drawer eyebrow="Members" title="Add a member" onClose={busy ? () => undefined : onClose}
            desc="They get an email with a link that works once, choose their own password and open their own dashboard. They can take the Health Number quiz then or later."
            foot={<>
              <button className="btn btn--ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn btn--primary" type="submit" form="inviteMemberForm" disabled={busy || !form.email.trim()} data-testid="invite-member-send">{busy ? "Sending…" : "Send invitation"}</button>
            </>}>
      <form id="inviteMemberForm" method="post" className="stack gap-4" onSubmit={(event) => void submit(event)} data-testid="invite-member-form">
        {error && <p className="errorbar" role="alert">{error}</p>}
        <div className="field">
          <label htmlFor="imEmail">Email address <span className="t-muted">(required)</span></label>
          <input className="input" id="imEmail" type="email" required maxLength={320} autoComplete="off" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="imFirst">First name</label>
          <input className="input" id="imFirst" maxLength={120} autoComplete="off" value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="imLast">Last name</label>
          <input className="input" id="imLast" maxLength={120} autoComplete="off" value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} />
        </div>
        <p className="t-support">Nothing is created until they accept. Accepting does not share any health information with the team, and it is not a paid plan.</p>
      </form>
    </Drawer>
  );
}
