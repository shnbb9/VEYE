"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiJson, postJson } from "@/lib/api";
import { ModalPortal } from "@/components/member/modal-portal";
import { useModalDialog } from "@/components/use-modal-dialog";

/* Delete my member profile (architecture V2 §6). Deletion is not
   deactivation: it removes the profile and its data for good. The dialog
   shows what goes and what stays BEFORE anything is asked for, then needs the
   current password and the word DELETE. Access closes the moment it is
   confirmed; the purge follows, and the reference shown at the end works on
   the public status page after this session has ended. */

type Preview = { scope: "member_data" | "entire_identity"; removed: string[]; kept: string[]; counts: Record<string, number>; confirm_word: string; note: string };
type Outcome = { request_id: string; state: string; state_label: string; scope: string; requested_at: string; completed_at: string | null };

export function DeleteProfile() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="settings-outline settings-outline--danger" type="button" onClick={() => setOpen(true)} data-testid="delete-profile-open">
        Delete my member profile <span aria-hidden="true">&rarr;</span>
      </button>
      <DeleteDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function DeleteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const card = useRef<HTMLFormElement>(null);
  useModalDialog(open, card, onClose, "#deletePassword");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(""); setPassword(""); setConfirm("");
    apiJson<Preview>("/api/v1/members/me/erasure/preview").then(setPreview)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "This could not be prepared."));
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!preview || confirm.trim() !== preview.confirm_word) { setError(`Type ${preview?.confirm_word ?? "DELETE"} to confirm.`); return; }
    setBusy(true); setError("");
    try {
      const outcome = await postJson<Outcome>("/api/v1/members/me/erasure", { password, confirm: confirm.trim() });
      // The member session ended on the server; leave the app for the public
      // status page rather than leave a dashboard that no longer works.
      window.location.assign(`/account-deleted?ref=${encodeURIComponent(outcome.request_id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your member profile could not be deleted.");
      setBusy(false);
    }
  }

  return (
    <ModalPortal id="deleteProfileModal" open={open} onBackdrop={() => { if (!busy) onClose(); }}>
      {open && (
        <form className="modal-card modal-note delete-card" ref={card} role="dialog" aria-modal="true" aria-labelledby="deleteHeading"
              method="post" onSubmit={(event) => void submit(event)} noValidate data-testid="delete-profile-dialog">
          <button className="modal-close" type="button" aria-label="Close" onClick={onClose} disabled={busy}>&times;</button>
          <span className="modal-eyebrow">Your data</span>
          <h3 id="deleteHeading">Delete my member profile</h3>
          {!preview && !error && <p className="modal-sub">Preparing…</p>}
          {preview && (
            <>
              <p className="modal-sub"><strong>This cannot be undone.</strong> {preview.note}</p>
              <p className="delete-card__label">Deleted</p>
              <ul className="consent__list" data-testid="delete-profile-removed">{preview.removed.map((line) => <li key={line}>{line}</li>)}</ul>
              <p className="delete-card__label">Kept</p>
              <ul className="consent__list" data-testid="delete-profile-kept">{preview.kept.map((line) => <li key={line}>{line}</li>)}</ul>
              <label className="delete-card__field" htmlFor="deletePassword">Your current password</label>
              <input className="delete-card__input" id="deletePassword" type="password" autoComplete="current-password" value={password}
                     onChange={(e) => setPassword(e.target.value)} data-testid="delete-profile-password" />
              <label className="delete-card__field" htmlFor="deleteConfirm">Type <b>{preview.confirm_word}</b> to confirm</label>
              <input className="delete-card__input" id="deleteConfirm" type="text" autoComplete="off" value={confirm}
                     onChange={(e) => setConfirm(e.target.value)} data-testid="delete-profile-confirm" />
            </>
          )}
          {error && <p className="chat-error" role="alert" data-testid="delete-profile-error">{error}</p>}
          <div className="modal-actions">
            <button className="btn-ghost" type="button" onClick={onClose} disabled={busy}>Keep my profile</button>
            <button className="btn-primary delete-card__submit" type="submit" disabled={busy || !preview || !password || confirm.trim() !== preview.confirm_word}
                    data-testid="delete-profile-submit">{busy ? "Deleting…" : "Delete permanently"}</button>
          </div>
        </form>
      )}
    </ModalPortal>
  );
}
